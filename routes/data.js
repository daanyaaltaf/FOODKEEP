'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { q, withTransaction, rowToItem, rowToWaste, rowToSaved } = require('../db');
const { requireAuth } = require('./auth');
const { getRecipeIdeas } = require('../recipes');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = [
  'Produce', 'Dairy & Eggs', 'Meat & Seafood',
  'Grains & Bakery', 'Pantry Staples', 'Leftovers', 'Beverages',
];

const REASONS = [
  'Spoiled', 'Expired', 'Cooked too much',
  "Forgot it was there", "Didn't like it", 'Other',
];

const uid = () => crypto.randomBytes(5).toString('hex');
const todayISO = () => new Date().toISOString().slice(0, 10);
const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime());
const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

/** GET /api/pantry */
router.get('/pantry', (req, res) => {
  res.json({ items: q.pantry.listByUser.all(req.userId).map(rowToItem) });
});

/** POST /api/pantry  { name, category, qty, unit, cost, purchaseDate, expiryDate } */
router.post('/pantry', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const qty = Number(b.qty);
  const unit = String(b.unit || '').trim();
  const cost = Number(b.cost);

  if (!name || name.length > 120) return res.status(400).json({ error: 'Item name is required (max 120 chars).' });
  if (!category) return res.status(400).json({ error: 'Pick a valid category.' });
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'Quantity must be a number ≥ 0.' });
  if (!unit || unit.length > 40) return res.status(400).json({ error: 'Unit is required (max 40 chars).' });
  if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'Cost must be a number ≥ 0.' });
  if (!isISODate(b.purchaseDate) || !isISODate(b.expiryDate)) {
    return res.status(400).json({ error: 'Purchase and expiry dates are required (YYYY-MM-DD).' });
  }

  const id = uid();
  q.pantry.insert.run(id, req.userId, name, category, qty, unit, round2(cost), b.purchaseDate, b.expiryDate);
  res.status(201).json({ item: rowToItem(q.pantry.byId.get(id, req.userId)) });
});

// ---------------------------------------------------------------------------
// Waste log
// ---------------------------------------------------------------------------

/** GET /api/waste */
router.get('/waste', (req, res) => {
  res.json({ entries: q.waste.listByUser.all(req.userId).map(rowToWaste) });
});

/**
 * POST /api/waste
 * { name, category, reason, qty, unit, cost, date, note, pantryItemId? }
 *
 * Atomic: creating the waste entry, decrementing (or deleting) the linked
 * pantry item happen in one SQLite transaction.
 */
router.post('/waste', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const reason = REASONS.includes(b.reason) ? b.reason : null;
  let qty = Number(b.qty);
  const unit = String(b.unit || '').trim();
  const cost = Number(b.cost);
  const date = isISODate(b.date) ? b.date : todayISO();
  const note = String(b.note || '').trim().slice(0, 500);
  const pantryItemId = b.pantryItemId ? String(b.pantryItemId) : null;

  if (!name || name.length > 120) return res.status(400).json({ error: 'Item name is required (max 120 chars).' });
  if (!category) return res.status(400).json({ error: 'Pick a valid category.' });
  if (!reason) return res.status(400).json({ error: 'Pick a valid reason.' });
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'Quantity must be a number ≥ 0.' });
  if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'Cost must be a number ≥ 0.' });

  const result = withTransaction(() => {
    // Clamp against the linked pantry item, if any.
    let src = null;
    if (pantryItemId) {
      src = q.pantry.byId.get(pantryItemId, req.userId);
      if (src && Number.isFinite(qty) && qty > src.qty) qty = src.qty;
    }

    const id = uid();
    q.waste.insert.run(id, req.userId, name, category, reason, qty, unit, round2(cost), date, note);

    let remaining = null;
    let removed = false;
    if (src) {
      const left = src.qty - qty;
      if (left <= 0.0001) {
        q.pantry.delete.run(src.id, req.userId);
        removed = true;
      } else {
        const costPerUnit = src.cost / src.qty;
        const newQty = round2(left);
        const newCost = round2(costPerUnit * newQty);
        q.pantry.updateQtyCost.run(newQty, newCost, src.id, req.userId);
        remaining = { qty: newQty, cost: newCost };
      }
    }
    return { id, removed, remaining };
  });

  res.status(201).json({
    entry: rowToWaste(q.waste.listByUser.all(req.userId).find((e) => e.id === result.id)),
    pantryRemoved: result.removed,
    pantryRemaining: result.remaining,
  });
});

/** DELETE /api/waste/:id */
router.delete('/waste/:id', (req, res) => {
  const info = q.waste.delete.run(req.params.id, req.userId);
  if (!info.changes) return res.status(404).json({ error: 'Entry not found.' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Saved ("used it up")
// ---------------------------------------------------------------------------

/** GET /api/saved */
router.get('/saved', (req, res) => {
  res.json({ entries: q.saved.listByUser.all(req.userId).map(rowToSaved) });
});

/** POST /api/saved  { pantryItemId } or { name, cost } */
router.post('/saved', (req, res) => {
  const b = req.body || {};
  const result = withTransaction(() => {
    let name = String(b.name || '').trim();
    let cost = Number(b.cost);

    if (b.pantryItemId) {
      const item = q.pantry.byId.get(String(b.pantryItemId), req.userId);
      if (!item) return { error: 'Pantry item not found.' };
      name = item.name;
      cost = item.cost;
      q.pantry.delete.run(item.id, req.userId);
    } else {
      if (!name || name.length > 120) return { error: 'Item name is required (max 120 chars).' };
      if (!Number.isFinite(cost) || cost < 0) return { error: 'Cost must be a number ≥ 0.' };
    }

    const id = uid();
    q.saved.insert.run(id, req.userId, name, round2(cost), isISODate(b.date) ? b.date : todayISO());
    return { id };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ entry: rowToSaved(q.saved.listByUser.all(req.userId).find((e) => e.id === result.id)) });
});

// ---------------------------------------------------------------------------
// Derived: insights + recipe ideas (computed server-side)
// ---------------------------------------------------------------------------

/** GET /api/insights */
router.get('/insights', (req, res) => {
  const waste = q.waste.listByUser.all(req.userId);
  const saved = q.saved.listByUser.all(req.userId);

  const monthKey = (d) => String(d).slice(0, 7);
  const thisMonth = monthKey(todayISO());
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  const lastMonth = d.toISOString().slice(0, 7);

  const sum = (rows) => rows.reduce((s, r) => s + Number(r.cost), 0);
  const wastedThis = sum(waste.filter((w) => monthKey(w.date) === thisMonth));
  const wastedLast = sum(waste.filter((w) => monthKey(w.date) === lastMonth));
  const savedTotal = sum(saved);

  const byCategory = {};
  const byReason = {};
  for (const w of waste) {
    byCategory[w.category] = round2((byCategory[w.category] || 0) + Number(w.cost));
    if (!byReason[w.reason]) byReason[w.reason] = { count: 0, cost: 0 };
    byReason[w.reason].count += 1;
    byReason[w.reason].cost = round2(byReason[w.reason].cost + Number(w.cost));
  }

  const monthsSeen = new Set(waste.map((w) => monthKey(w.date)));
  const totalAll = sum(waste);
  const monthlyAvg = monthsSeen.size ? totalAll / monthsSeen.size : 0;

  let daysSinceLastToss = null;
  if (waste.length) {
    const last = waste.map((w) => w.date).sort().reverse()[0];
    const lastD = new Date(last + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    daysSinceLastToss = Math.max(0, Math.round((today - lastD) / 86400000));
  }

  res.json({
    wastedThisMonth: round2(wastedThis),
    wastedLastMonth: round2(wastedLast),
    savedTotal: round2(savedTotal),
    savedCount: saved.length,
    byCategory,
    byReason,
    monthlyAverage: round2(monthlyAvg),
    projectedAnnual: round2(monthlyAvg * 12),
    daysSinceLastToss,
  });
});

/** GET /api/recipes?itemId=<optional> */
router.get('/recipes', (req, res) => {
  const items = req.query.itemId
    ? q.pantry.byId.get(String(req.query.itemId), req.userId)
    : null;
  const pool = items ? [items] : q.pantry.listByUser.all(req.userId);
  const mapped = pool.map((r) => ({ name: r.name, expiryDate: r.expiry_date }));
  res.json({ ideas: getRecipeIdeas(mapped).map(({ recipe, matched, urgent }) => ({
    name: recipe.name,
    desc: recipe.desc,
    matchedItems: matched.map((m) => m.name),
    urgentCount: urgent,
  })) });
});

module.exports = router;
