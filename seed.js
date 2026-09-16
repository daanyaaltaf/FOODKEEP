'use strict';

/**
 * Foodkeep guest seed data — mirrors the original localStorage demo dataset.
 * Exported as a factory so every new guest gets fresh IDs/dates.
 */

function seedGuestData(idGen) {
  const off = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  return {
    pantry: [
      { name: 'Palak', category: 'Produce', qty: 1, unit: 'bunch', cost: 30, purchaseDate: off(-4), expiryDate: off(1) },
      { name: 'Curd', category: 'Dairy & Eggs', qty: 400, unit: 'g', cost: 60, purchaseDate: off(-6), expiryDate: off(2) },
      { name: 'Chicken', category: 'Meat & Seafood', qty: 500, unit: 'g', cost: 180, purchaseDate: off(-1), expiryDate: off(4) },
      { name: 'Eggs', category: 'Dairy & Eggs', qty: 12, unit: 'eggs', cost: 96, purchaseDate: off(-3), expiryDate: off(6) },
      { name: 'Brown bread', category: 'Grains & Bakery', qty: 1, unit: 'loaf', cost: 55, purchaseDate: off(-5), expiryDate: off(-1) },
      { name: 'Chana (canned)', category: 'Pantry Staples', qty: 2, unit: 'tins', cost: 90, purchaseDate: off(-20), expiryDate: off(200) },
      { name: 'Leftover pulao', category: 'Leftovers', qty: 2, unit: 'servings', cost: 70, purchaseDate: off(-2), expiryDate: off(1) },
    ],
    waste: [
      { name: 'Bananas', category: 'Produce', reason: 'Spoiled', qty: 3, unit: 'pcs', cost: 40, date: off(-2), note: '' },
      { name: 'Milk', category: 'Dairy & Eggs', reason: 'Expired', qty: 1, unit: 'packet', cost: 65, date: off(-5), note: '' },
      { name: 'Leftover rice', category: 'Leftovers', reason: 'Forgot it was there', qty: 1, unit: 'container', cost: 50, date: off(-8), note: '' },
      { name: 'Capsicum', category: 'Produce', reason: 'Spoiled', qty: 2, unit: 'pcs', cost: 35, date: off(-10), note: '' },
      { name: 'Bread', category: 'Grains & Bakery', reason: 'Expired', qty: 1, unit: 'loaf', cost: 55, date: off(-15), note: '' },
    ],
    saved: [
      { name: 'Carrots', cost: 30, date: off(-3) },
      { name: 'Eggs', cost: 90, date: off(-6) },
    ],
  };
}

module.exports = { seedGuestData };
