import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/encrypt";
import { normalizeTimezone } from "@/lib/utils";
import type { BusinessHoursRow, EnrichedBusiness } from "@/lib/places";
import type { ExtractedService } from "@/lib/menu-extraction";

type ClaimBody = {
  business: EnrichedBusiness & { business_type?: string };
  hours?: BusinessHoursRow[];
  services?: ExtractedService[];
};

// After Google auth, bind the pre-auth enriched draft to the new account.
// Idempotent: one business per owner — a second call returns the existing one.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();

  // Idempotency: reuse an existing business for this owner.
  const { data: existing } = await db
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ businessId: existing.id, existing: true });
  }

  let body: ClaimBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body.business;
  if (!b?.name) {
    return NextResponse.json(
      { error: "Missing business name" },
      { status: 400 },
    );
  }

  // Move the encrypted Google refresh token from app_metadata onto the business.
  let googleRefreshToken: string | null = null;
  const enc = (user.app_metadata as { google_refresh_token_enc?: string })
    ?.google_refresh_token_enc;
  if (enc) {
    try {
      googleRefreshToken = enc; // stored already-encrypted; keep as-is at rest
      decrypt(enc); // validate it decrypts; throw → skip
    } catch {
      googleRefreshToken = null;
    }
  }

  const validTypes = ["salon", "clinic", "tax_office", "other"];
  const businessType = validTypes.includes(body.business.business_type ?? "")
    ? body.business.business_type!
    : "other";

  const { data: created, error } = await db
    .from("businesses")
    .insert({
      owner_user_id: user.id,
      name: b.name,
      business_type: businessType,
      address: b.formatted_address || null,
      formatted_address: b.formatted_address || null,
      public_phone: b.public_phone || null,
      website_url: b.website_url || null,
      google_place_id: b.google_place_id || null,
      timezone: normalizeTimezone(b.timezone),
      latitude: b.latitude,
      longitude: b.longitude,
      google_refresh_token: googleRefreshToken,
      onboarding_status: "provisioning",
      onboarding_step: 7,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("claim: insert failed", error?.message);
    return NextResponse.json(
      { error: "Could not create business" },
      { status: 500 },
    );
  }
  const businessId = created.id;

  // Hours (7 rows) + extracted services.
  if (body.hours?.length) {
    await db.from("business_hours").insert(
      body.hours.map((h) => ({
        business_id: businessId,
        day_of_week: h.day_of_week,
        is_closed: h.is_closed,
        hours_ranges: h.is_closed ? [] : h.hours_ranges,
      })),
    );
  }
  if (body.services?.length) {
    await db.from("services").insert(
      body.services.map((s) => ({
        business_id: businessId,
        name: s.name,
        description: s.description || null,
        price_cents: s.price_cents,
        duration_minutes: s.duration_minutes,
        source: "extracted",
      })),
    );
  }

  return NextResponse.json({ businessId });
}
