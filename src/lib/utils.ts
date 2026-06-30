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

/** Filter a request body to only the listed allowed keys. */
export function pickAllowed<T extends string>(
  fields: readonly T[],
  body: Record<string, unknown>,
): Partial<Record<T, unknown>> {
  return Object.fromEntries(
    fields.filter((k) => k in body).map((k) => [k, body[k]]),
  ) as Partial<Record<T, unknown>>;
}
