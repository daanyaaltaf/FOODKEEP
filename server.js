'use strict';

/**
 * Foodkeep server — Express + SQLite (node:sqlite).
 * Serves the SPA (index.html) and a JSON API under /api.
 */

const express = require('express');
const path = require('node:path');
const { DB_PATH } = require('./db');
const { router: authRouter } = require('./routes/auth');
const dataRouter = require('./routes/data');

const app = express();
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), db: DB_PATH });
});

app.use('/api/auth', authRouter);
app.use('/api', dataRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Basic JSON error handler (bad JSON bodies, unexpected errors).
app.use('/api', (err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Foodkeep running → http://localhost:${PORT}`);
  console.log(`SQLite database → ${DB_PATH}`);
});
