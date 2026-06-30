import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const filter = searchParams.get("filter") ?? "upcoming";

  const { data: biz } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();
  if (!biz) return NextResponse.json([]);

  let query = supabase
    .from("appointments")
    .select(
      `*, customers(id, name, phone_number, whatsapp_consent_status), services(id, name, price_cents, duration_minutes)`,
    )
    .eq("business_id", biz.id)
    .order("starts_at", { ascending: filter === "upcoming" });

  if (filter === "upcoming") {
    query = query
      .gte("starts_at", new Date().toISOString())
      .in("status", ["booked", "rescheduled"]);
  } else if (filter === "past") {
    query = query.lt("starts_at", new Date().toISOString());
  } else if (filter === "cancelled") {
    query = query.eq("status", "cancelled");
  }

  const { data } = await query.limit(100);
  return NextResponse.json(data ?? []);
}
