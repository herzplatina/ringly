import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "Price TBD";
  return `$${(cents / 100).toFixed(2)}`;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function formatDate(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Strip all non-digit characters so E.164 "+14155551234" matches "14155551234". */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * True only if both phone numbers are non-empty and equal once normalized to
 * digits. Empty/whitespace/no-digit inputs never match (so a missing owner or
 * caller number can't be mistaken for a self-call).
 */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length > 0 && na === nb;
}

/** True if `tz` is a valid IANA timezone that Intl (and date-fns-tz) accepts. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return `tz` if it's a valid IANA zone, else `fallback`. Use at every write so
 * a bad value never persists (an invalid zone throws in toZonedTime/fromZonedTime,
 * which would 500 the call webhooks and availability).
 */
export function normalizeTimezone(
  tz: string | null | undefined,
  fallback = "America/New_York",
): string {
  return tz && isValidTimezone(tz) ? tz : fallback;
}

/** Filter a request body to only the listed allowed keys. */
export function pickAllowed<T extends string>(
  fields: readonly T[],
  body: Record<string, unknown>,
): Partial<Record<T, unknown>> {
  return Object.fromEntries(
    fields.filter((k) => k in body).map((k) => [k, body[k]]),
  ) as Partial<Record<T, unknown>>;
}
