'use strict';

/** Recipe ideas keyed by ingredient keywords. Shared by server and client. */
const RECIPES = [
  { name: 'Palak Dal', keywords: ['palak', 'spinach', 'saag', 'dal', 'moong', 'lentil'], desc: "Simmer wilting greens into a comforting yellow dal — spinach that's a day from turning is perfect here." },
  { name: 'Banana Sheera or Banana Bread', keywords: ['banana'], desc: 'Overripe bananas are sweeter, not spoiled — mash them into a quick sheera or banana bread.' },
  { name: 'Curd Rice', keywords: ['curd', 'yogurt', 'dahi'], desc: "Curd that's turned a little sour is exactly what curd rice wants — no need to toss it." },
  { name: 'Quick Sabzi or Bhurji', keywords: ['capsicum', 'tomato', 'onion', 'bell pepper', 'vegetable', 'veggies', 'carrot', 'beans', 'peas'], desc: 'Soft capsicum, onion, tomato or other vegetables disappear beautifully into a quick sabzi or bhurji.' },
  { name: 'Chana Chaat', keywords: ['chana', 'chickpea', 'chickpeas'], desc: 'Leftover boiled or canned chana turns into a five-minute chaat with onion, lemon and chaat masala.' },
  { name: 'French Toast or Bread Upma', keywords: ['bread'], desc: "Bread that's gone stale but not moldy is ideal for French toast or a spiced bread upma." },
  { name: 'Fried Rice from Leftovers', keywords: ['rice', 'pulao', 'leftover pulao', 'leftover rice'], desc: 'Day-old rice fries up better than fresh rice — toss in whatever vegetables are also on their way out.' },
  { name: 'Quick Chicken Curry', keywords: ['chicken'], desc: 'Chicken close to its date should be cooked today — a quick curry or shredded filling uses it fully.' },
  { name: 'Homemade Paneer or Kheer', keywords: ['milk'], desc: 'Milk about to turn can be curdled into fresh paneer, or spiced into kheer — both forgive a slightly-off smell.' },
  { name: 'Egg Bhurji or Frittata', keywords: ['egg', 'eggs'], desc: 'A few extra eggs close to date go straight into a bhurji or frittata with whatever vegetables need using too.' },
  { name: 'Fruit Chaat or Smoothie', keywords: ['apple', 'fruit', 'mango', 'papaya', 'orange'], desc: 'Soft or bruised fruit is smoothie and fruit-chaat material — just cut around any bad spots.' },
  { name: 'Vegetable Stock or Soup', keywords: ['carrot', 'beans', 'peas', 'cauliflower', 'broccoli'], desc: "Softening vegetables are perfect for a stock or a simple blended soup — texture won't matter once cooked down." },
];

/**
 * Match pantry items to recipes. `items` is an array of {name, expiryDate}.
 * Returns ideas sorted by urgency (items expiring within 3 days) then matches.
 */
function getRecipeIdeas(items) {
  const daysUntil = (iso) => {
    const d = new Date(String(iso) + 'T00:00:00');
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  };

  const results = [];
  for (const r of RECIPES) {
    const matched = items.filter((p) => {
      const n = String(p.name || '').toLowerCase();
      return r.keywords.some((k) => n.includes(k) || k.includes(n));
    });
    if (matched.length) {
      const urgent = matched.filter((p) => daysUntil(p.expiryDate) <= 3).length;
      results.push({ recipe: r, matched, urgent });
    }
  }
  results.sort((a, b) => b.urgent - a.urgent || b.matched.length - a.matched.length);
  return results;
}

module.exports = { RECIPES, getRecipeIdeas };
