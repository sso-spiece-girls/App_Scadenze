/** Product categories used for grouping and filtering. */

export const CATEGORIES: { value: string; emoji: string }[] = [
  { value: "Latticini e uova", emoji: "🥛" },
  { value: "Carne", emoji: "🥩" },
  { value: "Pesce", emoji: "🐟" },
  { value: "Salumi", emoji: "🥓" },
  { value: "Frutta e verdura", emoji: "🍎" },
  { value: "Pane e prodotti da forno", emoji: "🥖" },
  { value: "Cibi surgelati", emoji: "🧊" },
  { value: "Cibi in scatola", emoji: "🥫" },
  { value: "Pasta e riso", emoji: "🍝" },
  { value: "Dolci e snack", emoji: "🍫" },
  { value: "Bevande", emoji: "🥤" },
  { value: "Salse e condimenti", emoji: "🍯" },
  { value: "Surgelati", emoji: "❄️" },
  { value: "Prodotti per la casa", emoji: "🧹" },
  { value: "Igiene personale", emoji: "🧴" },
  { value: "Altro", emoji: "📦" },
];

export function categoryEmoji(category: string | null | undefined): string {
  if (!category) return "📦";
  const match = CATEGORIES.find((c) => c.value.toLowerCase() === category.toLowerCase());
  if (match) return match.emoji;
  return "📦";
}

/** Maps an Open Food Facts category/path to our localized category when possible. */
export function mapOffCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (/(dairy|milk|cheese|yogurt|egg|cream|butter|latte|cacio|formagg|uova|burro|yogurt)/.test(c)) return "Latticini e uova";
  if (/(meat|beef|pork|chicken|poultry|carne|pollo|manzo|maiale)/.test(c)) return "Carne";
  if (/(fish|salmon|tuna|pesce|tonno|salmone)/.test(c)) return "Pesce";
  if (/(fruit|vegetable|apple|banana|salad|frutta|verdura|mela|banana|insalata)/.test(c)) return "Frutta e verdura";
  if (/(bread|bakery|pane|grissini|fette biscottate)/.test(c)) return "Pane e prodotti da forno";
  if (/(frozen|surgelat|gelato|ice cream)/.test(c)) return "Cibi surgelati";
  if (/(canned|tinned|scatola|conserve)/.test(c)) return "Cibi in scatola";
  if (/(pasta|rice|riso|noodle|farina|flour)/.test(c)) return "Pasta e riso";
  if (/(chocolate|snack|cookie|biscott|dolc|caramell|candy|merenda)/.test(c)) return "Dolci e snack";
  if (/(drink|beverage|juice|water|cola|bevanda|succo|acqua|soft drink)/.test(c)) return "Bevande";
  if (/(sauce|condiment|ketchup|majo|olive oil|salsa|condimento|aceto|vinegar)/.test(c)) return "Salse e condimenti";
  if (/(household|cleaning|detergent|pulizia|detergente)/.test(c)) return "Prodotti per la casa";
  if (/(cosmetic|hygiene|shampoo|soap|igiene|sapone|shampoo)/.test(c)) return "Igiene personale";
  return null;
}