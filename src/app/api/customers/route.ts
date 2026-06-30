import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: biz } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();
  if (!biz) return NextResponse.json([]);

  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", biz.id)
    .order("created_at", { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: biz } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();
  if (!biz)
    return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const { id, whatsapp_consent_status } = await req.json();

  const VALID_CONSENT = ["granted", "declined", "not_asked"] as const;
  if (!VALID_CONSENT.includes(whatsapp_consent_status)) {
    return NextResponse.json(
      { error: "Invalid whatsapp_consent_status" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("customers")
    .update({
      whatsapp_consent_status,
      whatsapp_consent_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("business_id", biz.id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
