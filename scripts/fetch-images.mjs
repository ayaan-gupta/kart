// Downloads real product images for the demo catalog.
// Primary: spoonacular's public ingredient CDN (clean white-background packshots).
// Fallback: Open Food Facts / Open Products Facts search (CC-licensed community photos).
// Usage: node scripts/fetch-images.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const SP = 'https://img.spoonacular.com/ingredients_250x250/';

/** code -> spoonacular slug candidates, tried in order */
const spoonacular = {
  '0411': ['bananas.jpg'],
  '0412': ['apple.jpg'],
  '0413': ['avocado.jpg'],
  '0414': ['spinach.jpg'],
  '0415': ['roma-tomatoes.png', 'tomato.png', 'tomato.jpg'],
  '0416': ['brown-onion.png', 'yellow-onion.jpg', 'onion.jpg'],
  '0417': ['red-grapes.jpg', 'grapes.jpg'],
  '0418': ['lemon.jpg'],
  '0422': ['strawberries.png', 'strawberries.jpg'],
  '0423': ['red-pepper.jpg', 'red-bell-pepper.jpg'],
  '0424': ['corn-on-the-cob.jpg', 'corn.png'],
  '0425': ['garlic.png', 'garlic.jpg'],
  '1121': ['milk.jpg'],
  '1122': ['egg.jpg', 'eggs.jpg'],
  '1123': ['butter.jpg', 'butter-sliced.jpg'],
  '1124': ['greek-yogurt.jpg', 'plain-yogurt.jpg', 'yogurt.jpg'],
  '1125': ['cheddar-cheese.jpg'],
  '1126': ['oat-milk.jpg', 'soy-milk.jpg', 'milk.jpg'],
  '2231': ['sourdough-bread.jpg', 'crusty-bread.jpg', 'bread.jpg'],
  '2232': ['bagel.jpg', 'bagels.jpg', 'plain-bagel.jpg'],
  '2233': ['croissant.jpg', 'croissants.jpg'],
  '2234': ['flour-tortilla.jpg', 'tortillas.png', 'tortilla.jpg'],
  '3341': ['chicken-breasts.png', 'chicken-breast.jpg', 'raw-chicken-breast.jpg'],
  '3342': ['fresh-ground-beef.jpg', 'ground-beef.jpg', 'raw-ground-beef.jpg'],
  '3343': ['salmon.png', 'salmon.jpg', 'salmon-fillet.jpg'],
  '3344': ['raw-bacon.png', 'bacon.jpg', 'cooked-bacon.jpg'],
  '4451': ['penne-pasta.jpg', 'mostaccioli.jpg', 'pasta.jpg'],
  '4452': ['marinara-sauce.jpg', 'tomato-sauce-canned.png', 'pasta-sauce.jpg'],
  '4453': ['uncooked-white-rice.png', 'long-grain-rice.png', 'white-rice.jpg', 'rice.jpg'],
  '4454': ['peanut-butter.png', 'peanut-butter.jpg'],
  '4455': ['cheerios.jpg', 'cereal.jpg', 'oat-cereal.jpg', 'granola.jpg'],
  '4456': ['olive-oil.jpg'],
  '4457': ['black-beans.jpg', 'canned-black-beans.png'],
  '4458': ['chicken-broth.png', 'chicken-broth.jpg'],
  '5561': ['tortilla-chips.jpg', 'corn-chips.jpg'],
  '5562': ['dark-chocolate-pieces.jpg', 'dark-chocolate.jpg', 'chocolate-bar.jpg'],
  '5563': ['trail-mix.jpg', 'mixed-nuts.jpg'],
  '5564': ['sparkling-water.png', 'sparkling-water.jpg', 'club-soda.jpg'],
  '5565': ['brewed-coffee.jpg', 'coffee.jpg'],
  '5566': ['orange-juice.jpg'],
};

/** code -> Open Food/Products Facts search terms (household + pet) */
const off = {
  '6671': 'bounty paper towels',
  '6672': 'dawn dish soap',
  '6673': 'tide laundry detergent',
  '6674': 'glad trash bags',
  '7781': 'dog treats chicken',
  '7782': 'cat litter',
};

mkdirSync('assets/products', { recursive: true });

async function tryUrl(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1500) return null;
    return buf;
  } catch {
    return null;
  }
}

async function searchOff(host, terms) {
  const url = `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&action=process&json=1&page_size=6&fields=image_front_small_url,image_front_url,product_name`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'kart-demo/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    for (const p of data.products ?? []) {
      const img = p.image_front_url || p.image_front_small_url;
      if (img) {
        const buf = await tryUrl(img);
        if (buf) return buf;
      }
    }
  } catch {}
  return null;
}

const results = {};
for (const [code, slugs] of Object.entries(spoonacular)) {
  let done = false;
  for (const slug of slugs) {
    const buf = await tryUrl(SP + slug);
    if (buf) {
      const ext = slug.endsWith('.png') ? 'png' : 'jpg';
      writeFileSync(`assets/products/${code}.${ext}`, buf);
      results[code] = `${code}.${ext} (spoonacular ${slug}, ${buf.length}b)`;
      done = true;
      break;
    }
  }
  if (!done) results[code] = 'MISSING';
}

for (const [code, terms] of Object.entries(off)) {
  let buf = await searchOff('world.openfoodfacts.org', terms);
  if (!buf) buf = await searchOff('world.openproductsfacts.org', terms);
  if (buf) {
    writeFileSync(`assets/products/${code}.jpg`, buf);
    results[code] = `${code}.jpg (off, ${buf.length}b)`;
  } else {
    results[code] = 'MISSING';
  }
}

for (const [code, r] of Object.entries(results)) console.log(code, '->', r);
const missing = Object.values(results).filter((r) => r === 'MISSING').length;
console.log(`done. missing: ${missing}`);
