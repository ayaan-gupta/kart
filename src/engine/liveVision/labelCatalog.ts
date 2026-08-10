/**
 * Maps a Vision classify label to one or more candidate SKU codes.
 * A single-entry array means the label alone is enough (mainly produce,
 * where shape and color are distinctive). Multi-entry arrays are visually
 * ambiguous categories (mainly packaged goods) that need OCR text on the
 * package to disambiguate, the same way a person reads the label to tell
 * two boxes apart.
 */
export const LABEL_TO_SKU: Record<string, string[]> = {
  banana: ['0411'],
  apple: ['0412'],
  avocado: ['0413'],
  spinach: ['0414'],
  tomato: ['0415'],
  onion: ['0416', '0425'], // Vision reads garlic as onion more often than not
  grape: ['0417'],
  lemon: ['0418'],
  orange: ['0419'],
  pineapple: ['0420'],
  watermelon: ['0421'],
  strawberry: ['0422'],
  bell_pepper: ['0423'],
  corn: ['0424'],
  garlic: ['0425'],
  egg: ['1122'],
  butter: ['1123'],
  cheese: ['1125'],
  bread: ['2231'],
  bagel: ['2232'],
  croissant: ['2233'],
  tortilla: ['2234'],
  chicken: ['3341'],
  ground_meat: ['3342'],
  salmon: ['3343'],
  bacon: ['3344'],
  pasta: ['4451'],
  rice: ['4453'],
  peanut_butter: ['4454'],
  olive_oil: ['4456'],
  can: ['4457', '4458'],
  chips: ['5561'],
  chocolate_bar: ['5562'],
  trail_mix: ['5563'],
  paper_towels: ['6671'],
  trash_bags: ['6674'],
  // Ambiguous silhouettes: several catalog SKUs all look like "a bottle"
  // or "a carton" from the outside. Label alone isn't enough here.
  bottle: ['1121', '1126', '5564', '5565', '5566'],
  jug: ['1121', '1126'],
  box: ['4455', '6673'],
};
