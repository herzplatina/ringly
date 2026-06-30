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
