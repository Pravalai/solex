/** All money is whole rupees; all rates are basis points (10000 bps = 100%). */

export function applyBps(amount: number, bps: number): number {
  return Math.round((amount * bps) / 10_000);
}

export function toBps(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part * 10_000) / whole);
}

/**
 * Splits `total` into parts proportional to `weights` (bps). The last part absorbs
 * rounding so the parts always sum exactly to `total`.
 */
export function splitByBps(total: number, weights: number[]): number[] {
  const parts = weights.map((w) => applyBps(total, w));
  const drift = total - parts.reduce((a, b) => a + b, 0);
  if (parts.length > 0) parts[parts.length - 1] += drift;
  return parts;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,23,45,678 */
export function formatINR(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}₹${inr.format(Math.abs(amount))}`;
}

/** ₹1.23 Cr / ₹45.6 L / ₹12,500 */
export function formatINRCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000, 2)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000, 1)} L`;
  return `${sign}₹${inr.format(abs)}`;
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

export function formatBps(bps: number): string {
  return `${trim(bps / 100, 2)}%`;
}
