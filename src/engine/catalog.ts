import type { Sku } from './types';

/** Seeded demo catalog, 42 SKUs across a plausible grocery spread. */
const raw: Array<[code: string, name: string, price: number, emoji: string, category: string]> = [
  ['0411', 'Bananas', 1.29, '🍌', 'Produce'],
  ['0412', 'Organic Honeycrisp apples, 3 lb bag', 6.99, '🍎', 'Produce'],
  ['0413', 'Hass avocados, 4 ct', 4.49, '🥑', 'Produce'],
  ['0414', 'Baby spinach, 10 oz', 3.79, '🥬', 'Produce'],
  ['0415', 'Roma tomatoes, per lb', 1.89, '🍅', 'Produce'],
  ['0416', 'Yellow onions, 2 lb', 2.29, '🧅', 'Produce'],
  ['0417', 'Seedless red grapes, per lb', 2.99, '🍇', 'Produce'],
  ['0418', 'Lemons, 2 ct', 1.38, '🍋', 'Produce'],
  ['0419', 'Navel oranges, 4 ct', 3.49, '🍊', 'Produce'],
  ['0420', 'Pineapple', 2.99, '🍍', 'Produce'],
  ['0421', 'Mini watermelon', 4.99, '🍉', 'Produce'],
  ['0422', 'Strawberries, 1 lb', 3.99, '🍓', 'Produce'],
  ['0423', 'Red bell pepper', 1.79, '🫑', 'Produce'],
  ['0424', 'Sweet corn, 2 ct', 1.98, '🌽', 'Produce'],
  ['0425', 'Garlic bulb', 0.89, '🧄', 'Produce'],
  ['1121', 'Whole milk, 1 gal', 3.89, '🥛', 'Dairy'],
  ['1122', 'Large eggs, dozen', 4.19, '🥚', 'Dairy'],
  ['1123', 'Salted butter, 1 lb', 4.79, '🧈', 'Dairy'],
  ['1124', 'Greek yogurt, vanilla, 32 oz', 5.49, '🥣', 'Dairy'],
  ['1125', 'Sharp cheddar block, 8 oz', 3.99, '🧀', 'Dairy'],
  ['1126', 'Oat milk, 64 oz', 4.99, '🌾', 'Dairy'],
  ['2231', 'Sourdough loaf', 4.29, '🍞', 'Bakery'],
  ['2232', 'Everything bagels, 6 ct', 3.49, '🥯', 'Bakery'],
  ['2233', 'Croissants, 4 ct', 5.99, '🥐', 'Bakery'],
  ['2234', 'Flour tortillas, 10 ct', 2.79, '🫓', 'Bakery'],
  ['3341', 'Boneless chicken breast, per lb', 5.49, '🍗', 'Meat'],
  ['3342', 'Ground beef 85/15, 1 lb', 6.29, '🥩', 'Meat'],
  ['3343', 'Atlantic salmon fillet, per lb', 11.99, '🐟', 'Meat'],
  ['3344', 'Uncured bacon, 12 oz', 6.99, '🥓', 'Meat'],
  ['4451', 'Penne rigate, 16 oz', 1.49, '🍝', 'Pantry'],
  ['4452', 'Marinara sauce, 24 oz', 2.89, '🫙', 'Pantry'],
  ['4453', 'Long grain rice, 2 lb', 3.19, '🍚', 'Pantry'],
  ['4454', 'Creamy peanut butter, 16 oz', 3.49, '🥜', 'Pantry'],
  ['4455', 'Honey Nut Oat Cereal, family size', 4.49, '🥣', 'Pantry'],
  ['4456', 'Extra virgin olive oil, 500 ml', 8.99, '🫒', 'Pantry'],
  ['4457', 'Black beans, 15 oz can', 1.09, '🥫', 'Pantry'],
  ['4458', 'Chicken stock, 32 oz', 2.49, '🍲', 'Pantry'],
  ['5561', 'Tortilla chips, 13 oz', 3.79, '🌮', 'Snacks'],
  ['5562', 'Dark chocolate bar, 3.5 oz', 2.99, '🍫', 'Snacks'],
  ['5563', 'Trail mix, 26 oz', 8.49, '🥨', 'Snacks'],
  ['5564', 'Sparkling water, 12 pk', 5.99, '🫧', 'Beverages'],
  ['5565', 'Cold brew concentrate, 32 oz', 9.99, '☕', 'Beverages'],
  ['5566', 'Orange juice, 52 oz', 4.69, '🍊', 'Beverages'],
  ['6671', 'Paper towels, 6 rolls', 8.99, '🧻', 'Household'],
  ['6672', 'Dish soap, 19 oz', 3.29, '🧼', 'Household'],
  ['6673', 'Laundry detergent, 46 oz', 12.49, '🧺', 'Household'],
  ['6674', 'Trash bags, 45 ct', 9.79, '🗑️', 'Household'],
  ['7781', 'Dog treats, chicken, 16 oz', 7.49, '🦴', 'Pet'],
  ['7782', 'Cat litter, 20 lb', 11.29, '🐈', 'Pet'],
];

export const CATALOG: Sku[] = raw.map(([code, name, price, emoji, category]) => ({
  id: `sku_${code}`,
  code,
  name,
  price,
  emoji,
  category,
}));

export const skuByCode = new Map(CATALOG.map((s) => [s.code, s]));

export function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}
