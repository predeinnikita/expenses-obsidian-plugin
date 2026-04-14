/**
 * Format a number with space-separated thousands and fixed decimal places.
 * Examples: 10000 → "10 000.00", 100000 → "100 000.00", 2000000 → "2 000 000.00"
 */
export function formatMoney(value: number, decimals = 2): string {
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const digits = intPart.replace("-", "");
  const spaced = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return decPart !== undefined ? `${sign}${spaced}.${decPart}` : `${sign}${spaced}`;
}
