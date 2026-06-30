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
    .from("calls")
    .select("*")
    .eq("business_id", biz.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json(data ?? []);
}
