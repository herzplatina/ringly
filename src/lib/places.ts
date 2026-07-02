import "server-only";
import { env } from "./env";

// Google Places API (New). Docs verified 2026-07-01: Place Details returns
// displayName, formattedAddress, nationalPhoneNumber, regularOpeningHours,
// location, websiteUri, and timeZone (IANA) — no separate Time Zone API needed.

const PLACES_BASE = "https://places.googleapis.com/v1";

const DETAILS_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "regularOpeningHours",
  "location",
  "websiteUri",
  "timeZone",
].join(",");

type PlacePeriodPoint = { day: number; hour: number; minute: number };
type RegularOpeningHours = {
  periods?: Array<{ open?: PlacePeriodPoint; close?: PlacePeriodPoint }>;
};
type PlaceDetails = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: RegularOpeningHours;
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  timeZone?: { id: string };
};

export type BusinessHoursRow = {
  day_of_week: number; // 0 = Sunday … 6 = Saturday (matches Places + our schema)
  is_closed: boolean;
  hours_ranges: Array<{ open: string; close: string }>;
};

export type EnrichedBusiness = {
  google_place_id: string;
  name: string;
  formatted_address: string;
  public_phone: string;
  website_url: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
};

export type PlaceCandidate = {
  place_id: string;
  name: string;
  address: string;
};

/** Zero-pad an hour/minute pair to "HH:MM". */
export function formatHM(hour: number, minute: number): string {
  const h = String(Math.min(Math.max(hour, 0), 23)).padStart(2, "0");
  const m = String(Math.min(Math.max(minute, 0), 59)).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Map Places `regularOpeningHours.periods` to our 7-day business_hours rows.
 * Days with no period are marked closed. Overnight/rollover periods (close.day
 * != open.day) are clamped to end-of-day for v1 simplicity.
 */
export function mapOpeningHours(
  regular: RegularOpeningHours | undefined,
): BusinessHoursRow[] {
  const days: BusinessHoursRow[] = Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    is_closed: true,
    hours_ranges: [],
  }));
  for (const period of regular?.periods ?? []) {
    const open = period.open;
    if (!open || typeof open.day !== "number") continue;
    const day = days[open.day];
    if (!day) continue;
    const openStr = formatHM(open.hour ?? 0, open.minute ?? 0);
    const close = period.close;
    const closeStr =
      close && close.day === open.day
        ? formatHM(close.hour ?? 0, close.minute ?? 0)
        : "23:59";
    day.is_closed = false;
    day.hours_ranges.push({ open: openStr, close: closeStr });
  }
  return days;
}

async function placesFetch(path: string, init: RequestInit, fieldMask: string) {
  const res = await fetch(`${PLACES_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": fieldMask,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

/** Text Search — returns up to a few candidate places for a free-text query. */
export async function searchBusiness(text: string): Promise<PlaceCandidate[]> {
  const data = (await placesFetch(
    "/places:searchText",
    {
      method: "POST",
      body: JSON.stringify({ textQuery: text, maxResultCount: 5 }),
    },
    "places.id,places.displayName,places.formattedAddress",
  )) as {
    places?: Array<{
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
    }>;
  };
  return (data.places ?? []).map((p) => ({
    place_id: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
  }));
}

/** Full Place Details for a resolved place id. */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  return placesFetch(
    `/places/${encodeURIComponent(placeId)}`,
    { method: "GET" },
    DETAILS_FIELDS,
  ) as Promise<PlaceDetails>;
}

/** Normalize raw Place Details into our enriched-business + hours shapes. */
export function normalizePlace(place: PlaceDetails): {
  business: EnrichedBusiness;
  hours: BusinessHoursRow[];
} {
  return {
    business: {
      google_place_id: place.id,
      name: place.displayName?.text ?? "",
      formatted_address: place.formattedAddress ?? "",
      public_phone:
        place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? "",
      website_url: place.websiteUri ?? "",
      timezone: place.timeZone?.id ?? "America/New_York",
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
    },
    hours: mapOpeningHours(place.regularOpeningHours),
  };
}
