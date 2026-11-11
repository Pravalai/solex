/** Normalises Indian mobile numbers to their 10-digit form for duplicate detection. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isValidIndianMobile(raw: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizePhone(raw));
}

/** 98xxxxxx21 */
export function maskPhone(raw: string): string {
  const p = normalizePhone(raw);
  if (p.length < 4) return "••••";
  return `${p.slice(0, 2)}xxxxxx${p.slice(-2)}`;
}
