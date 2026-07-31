/** Shared formatting for email copy. One definition, so amounts never disagree. */

/** Cents to a display amount: `12345` → `"$123.45"`. */
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Seconds to a spoken-ish duration: `95` → `"1m 35s"`. */
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
