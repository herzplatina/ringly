import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncRetellPrompt } from "@/lib/retell";

const HH_MM = /^\d{2}:\d{2}$/;

// Parse an HH:MM string to minutes-since-midnight, or null if the components
// are out of range (the regex alone would accept "99:99").
function toMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

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
    .from("business_hours")
    .select("*")
    .eq("business_id", biz.id)
    .order("day_of_week");

  return NextResponse.json(data ?? []);
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: biz } = await supabase
    .from("businesses")
    .select("id, retell_agent_id")
    .eq("owner_user_id", user.id)
    .single();
  if (!biz)
    return NextResponse.json({ error: "No business found" }, { status: 404 });

  const hours: Array<{
    day_of_week: number;
    is_closed: boolean;
    hours_ranges: Array<{ open: string; close: string }>;
  }> = await req.json();

  // Validate input
  for (const h of hours) {
    if (
      !Number.isInteger(h.day_of_week) ||
      h.day_of_week < 0 ||
      h.day_of_week > 6
    ) {
      return NextResponse.json(
        { error: `Invalid day_of_week: ${h.day_of_week}` },
        { status: 400 },
      );
    }
    if (!h.is_closed) {
      for (const r of h.hours_ranges ?? []) {
        if (!HH_MM.test(r.open) || !HH_MM.test(r.close)) {
          return NextResponse.json(
            {
              error: `Invalid time format in hours_ranges (expected HH:MM): ${JSON.stringify(r)}`,
            },
            { status: 400 },
          );
        }
        const openMin = toMinutes(r.open);
        const closeMin = toMinutes(r.close);
        if (openMin === null || closeMin === null) {
          return NextResponse.json(
            {
              error: `Time out of range in hours_ranges: ${JSON.stringify(r)}`,
            },
            { status: 400 },
          );
        }
        if (openMin >= closeMin) {
          return NextResponse.json(
            {
              error: `Open time must be before close time: ${JSON.stringify(r)}`,
            },
            { status: 400 },
          );
        }
      }
    }
  }

  // Upsert all 7 days atomically
  const rows = hours.map((h) => ({
    business_id: biz.id,
    day_of_week: h.day_of_week,
    is_closed: h.is_closed,
    hours_ranges: h.is_closed ? [] : h.hours_ranges,
  }));

  const { data, error } = await supabase
    .from("business_hours")
    .upsert(rows, { onConflict: "business_id,day_of_week" })
    .select();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase
    .from("businesses")
    .update({ onboarding_step: 5 })
    .eq("id", biz.id)
    .lt("onboarding_step", 5);

  void syncRetellPrompt(biz.id);
  return NextResponse.json(data);
}
