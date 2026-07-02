// Client-side persistence for the pre-auth onboarding draft. Written to both
// localStorage and sessionStorage so it survives the Google OAuth round-trip
// (localStorage is the durable one; sessionStorage is a backup). All access is
// guarded — storage can be unavailable (private mode, disabled).

const KEY = "ringly_draft";

export function saveDraft(draft: unknown): void {
  try {
    const s = JSON.stringify(draft);
    localStorage.setItem(KEY, s);
    sessionStorage.setItem(KEY, s);
  } catch {
    /* storage unavailable — claim will surface a clear error */
  }
}

/** The raw JSON string of the draft (ready to POST), or null if none. */
export function loadDraft(): string | null {
  try {
    return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
