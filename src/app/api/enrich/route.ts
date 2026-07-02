import { NextRequest, NextResponse } from "next/server";
import { searchBusiness, getPlaceDetails, normalizePlace } from "@/lib/places";
import { extractServicesFromUrl } from "@/lib/menu-extraction";

// Public (pre-auth) endpoint: turns free-text business details into an enriched
// draft. Non-streaming in v1 — resolves Places, then optionally the website menu.
export async function POST(req: NextRequest) {
  let text = "";
  let placeId = "";
  try {
    const body = await req.json();
    text = body.text ?? "";
    placeId = body.place_id ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Path 1: caller already picked a candidate → go straight to details.
  if (!placeId) {
    if (!text.trim()) {
      return NextResponse.json(
        { error: "Tell us your business name and address." },
        { status: 400 },
      );
    }
    let candidates;
    try {
      candidates = await searchBusiness(text.trim());
    } catch (err) {
      console.error("enrich: Places search failed", err);
      return NextResponse.json(
        { error: "Could not look up that business." },
        { status: 502 },
      );
    }
    if (candidates.length === 0) {
      return NextResponse.json({ found: false });
    }
    if (candidates.length > 1) {
      // Ambiguous → let the UI disambiguate before pulling full details.
      return NextResponse.json({ found: true, candidates });
    }
    placeId = candidates[0].place_id;
  }

  let place;
  try {
    place = await getPlaceDetails(placeId);
  } catch (err) {
    console.error("enrich: Place Details failed", err);
    return NextResponse.json(
      { error: "Could not load business details." },
      { status: 502 },
    );
  }

  const { business, hours } = normalizePlace(place);

  // Best-effort menu extraction from the website (bounded timeout, ≤5, Haiku).
  const services = business.website_url
    ? await extractServicesFromUrl(business.website_url)
    : [];

  return NextResponse.json({ found: true, business, hours, services });
}
