'use strict';

/**
 * Foodkeep database layer.
 *
 * Uses node:sqlite (built into Node.js 22.5+/24). Zero native deps.
 * The DB file lives at ./data/foodkeep.db (or DB_PATH env var).
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.FOODKEEP_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.FOODKEEP_DB_PATH || path.join(DATA_DIR, 'foodkeep.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_guest      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pantry_items (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,
    qty           REAL NOT NULL CHECK (qty >= 0),
    unit          TEXT NOT NULL,
    cost          REAL NOT NULL CHECK (cost >= 0),
    purchase_date TEXT NOT NULL,
    expiry_date   TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_pantry_user ON pantry_items(user_id);

  CREATE TABLE IF NOT EXISTS waste_entries (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL,
    reason     TEXT NOT NULL,
    qty        REAL NOT NULL CHECK (qty >= 0),
    unit       TEXT NOT NULL DEFAULT '',
    cost       REAL NOT NULL CHECK (cost >= 0),
    date       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_waste_user ON waste_entries(user_id);

  CREATE TABLE IF NOT EXISTS saved_items (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    cost       REAL NOT NULL CHECK (cost >= 0),
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_items(user_id);
`);

// --- lightweight migrations -------------------------------------------------

function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
}
addColumnIfMissing('users', 'is_guest', 'is_guest INTEGER NOT NULL DEFAULT 0');

// ---------------------------------------------------------------------------
// Row <-> API mappers
// ---------------------------------------------------------------------------

const rowToItem = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  qty: r.qty,
  unit: r.unit,
  cost: r.cost,
  purchaseDate: r.purchase_date,
  expiryDate: r.expiry_date,
  createdAt: r.created_at,
});

const rowToWaste = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  reason: r.reason,
  qty: r.qty,
  unit: r.unit,
  cost: r.cost,
  date: r.date,
  note: r.note,
  createdAt: r.created_at,
});

const rowToSaved = (r) => ({
  id: r.id,
  name: r.name,
  cost: r.cost,
  date: r.date,
  createdAt: r.created_at,
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const q = {
  user: {
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    insert: db.prepare(
      'INSERT INTO users (email, name, password_hash, is_guest) VALUES (?, ?, ?, ?)'
    ),
  },
  session: {
    byToken: db.prepare(
      `SELECT s.*, u.email, u.name, u.is_guest
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now')`
    ),
    insert: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
    delete: db.prepare('DELETE FROM sessions WHERE token = ?'),
    deleteExpired: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
  },
  pantry: {
    listByUser: db.prepare(
      'SELECT * FROM pantry_items WHERE user_id = ? ORDER BY expiry_date ASC, created_at ASC'
    ),
    byId: db.prepare('SELECT * FROM pantry_items WHERE id = ? AND user_id = ?'),
    insert: db.prepare(
      `INSERT INTO pantry_items (id, user_id, name, category, qty, unit, cost, purchase_date, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    updateQtyCost: db.prepare('UPDATE pantry_items SET qty = ?, cost = ? WHERE id = ? AND user_id = ?'),
    delete: db.prepare('DELETE FROM pantry_items WHERE id = ? AND user_id = ?'),
  },
  waste: {
    listByUser: db.prepare('SELECT * FROM waste_entries WHERE user_id = ? ORDER BY date DESC, created_at DESC'),
    insert: db.prepare(
      `INSERT INTO waste_entries (id, user_id, name, category, reason, qty, unit, cost, date, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    delete: db.prepare('DELETE FROM waste_entries WHERE id = ? AND user_id = ?'),
  },
  saved: {
    listByUser: db.prepare('SELECT * FROM saved_items WHERE user_id = ? ORDER BY date DESC, created_at DESC'),
    insert: db.prepare('INSERT INTO saved_items (id, user_id, name, cost, date) VALUES (?, ?, ?, ?, ?)'),
  },
};

/**
 * Run `fn` inside a SQLite transaction (node:sqlite has no built-in helper).
 * Synchronous by design — statements can't interleave on the single connection.
 */
function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

// Clean up expired sessions roughly every hour of server life.
setInterval(() => {
  try { q.session.deleteExpired.run(); } catch { /* non-fatal */ }
}, 60 * 60 * 1000).unref();

module.exports = { db, q, withTransaction, rowToItem, rowToWaste, rowToSaved, DB_PATH };
