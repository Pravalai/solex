/**
 * Injectable clock. Services read time only through `now()` so tests can
 * exercise expiry rules and the seed script can replay six months of history.
 */
let override: Date | null = null;

export function now(): Date {
  return override ? new Date(override) : new Date();
}

export function setClock(date: Date | null): void {
  override = date ? new Date(date) : null;
}

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}
