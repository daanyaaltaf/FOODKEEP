'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { db, q, withTransaction } = require('../db');
const { seedGuestData } = require('../seed');

const router = express.Router();

const SESSION_TTL_DAYS = Number(process.env.FOODKEEP_SESSION_DAYS || 30);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST_EMAIL = 'guest@foodkeep.local';

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sessionExpiry() {
  const d = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  return d.toISOString().replace('T', ' ').slice(0, 19); // "YYYY-MM-DD HH:MM:SS" (UTC)
}

function setSessionCookie(res, token) {
  // Not `secure` so it works on plain http://localhost. Set secure:true behind HTTPS in prod.
  res.setHeader(
    'Set-Cookie',
    `foodkeep_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_DAYS * 86400}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'foodkeep_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function createSession(res, userRow) {
  const token = newSessionToken();
  q.session.insert.run(token, userRow.id, sessionExpiry());
  setSessionCookie(res, token);
  return { id: userRow.id, name: userRow.name, email: userRow.email, isGuest: !!userRow.is_guest };
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, isGuest: !!row.is_guest };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function requireAuth(req, res, next) {
  const token = parseCookie(req.headers.cookie || '').foodkeep_session;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });

  const row = q.session.byToken.get(token);
  if (!row) { clearSessionCookie(res); return res.status(401).json({ error: 'Session expired. Log in again.' }); }

  req.sessionToken = token;
  req.user = publicUser(row);
  req.userId = row.user_id;
  next();
}

function parseCookie(header) {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/signup  { name, email, password }
 */
router.post('/signup', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || name.length > 80) return res.status(400).json({ error: 'Please enter your name (max 80 chars).' });
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'That email doesn\'t look right.' });
  if (password.length < 4 || password.length > 200) return res.status(400).json({ error: 'Password must be 4–200 characters.' });

  if (q.user.byEmail.get(email)) {
    return res.status(409).json({ error: 'An account already exists with that email. Try logging in instead.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = q.user.insert.run(email, name, hash, 0);
  const user = q.user.byId.get(info.lastInsertRowid);
  createSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

/**
 * POST /api/auth/login  { email, password }
 */
router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = q.user.byEmail.get(email);
  // Compare against a dummy hash when the user is missing to keep timing uniform.
  const hash = user ? user.password_hash : '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpUuUPYtRXbGJEcFvKGTkFvLGc0Sa';
  if (!bcrypt.compareSync(password, hash) || !user) {
    return res.status(401).json({ error: "We don't recognize that email and password combo. Try again, or create an account." });
  }

  createSession(res, user);
  res.json({ user: publicUser(user) });
});

/**
 * POST /api/auth/guest — creates (once) and logs into the shared guest account,
 * seeding it with the demo dataset on first use.
 */
router.post('/guest', (req, res) => {
  let user = q.user.byEmail.get(GUEST_EMAIL);
  if (!user) {
    const info = q.user.insert.run(GUEST_EMAIL, 'Guest', bcrypt.hashSync(crypto.randomUUID(), 10), 1);
    user = q.user.byId.get(info.lastInsertRowid);

    const seed = seedGuestData(() => crypto.randomBytes(5).toString('hex'));
    withTransaction(() => {
      for (const p of seed.pantry) {
        q.pantry.insert.run(
          crypto.randomBytes(5).toString('hex'), user.id,
          p.name, p.category, p.qty, p.unit, p.cost, p.purchaseDate, p.expiryDate
        );
      }
      for (const w of seed.waste) {
        q.waste.insert.run(
          crypto.randomBytes(5).toString('hex'), user.id,
          w.name, w.category, w.reason, w.qty, w.unit, w.cost, w.date, w.note
        );
      }
      for (const s of seed.saved) {
        q.saved.insert.run(crypto.randomBytes(5).toString('hex'), user.id, s.name, s.cost, s.date);
      }
    });
  }

  createSession(res, user);
  res.json({ user: publicUser(user) });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  const token = parseCookie(req.headers.cookie || '').foodkeep_session;
  if (token) q.session.delete.run(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/**
 * GET /api/auth/me
 */
router.get('/me', (req, res) => {
  const token = parseCookie(req.headers.cookie || '').foodkeep_session;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  const row = q.session.byToken.get(token);
  if (!row) { clearSessionCookie(res); return res.status(401).json({ error: 'Session expired. Log in again.' }); }
  res.json({ user: publicUser(row) });
});

module.exports = { router, requireAuth, clearSessionCookie };
