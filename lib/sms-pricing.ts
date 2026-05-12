export function normalizeSmsPrice(price: unknown): number | null {
  if (price === null || price === undefined || price === '') return null;

  const value = Number(price);
  if (Number.isNaN(value)) return null;

  return Math.abs(value);
}
