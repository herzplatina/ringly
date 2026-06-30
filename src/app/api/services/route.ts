import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncRetellPrompt } from "@/lib/retell";
import { pickAllowed } from "@/lib/utils";

async function getBusinessId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("businesses")
    .select("id, retell_agent_id")
    .eq("owner_user_id", userId)
    .single();
  return data;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await getBusinessId(supabase, user.id);
  if (!biz) return NextResponse.json([]);

  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("business_id", biz.id)
    .order("created_at");

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await getBusinessId(supabase, user.id);
  if (!biz)
    return NextResponse.json({ error: "No business found" }, { status: 404 });

  const body = await req.json();
  const services = Array.isArray(body) ? body : [body];

  const { data, error } = await supabase
    .from("services")
    .insert(services.map((s) => ({ ...s, business_id: biz.id })))
    .select();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  void syncRetellPrompt(biz.id);
  return NextResponse.json(data);
}

const SERVICE_MUTABLE_FIELDS = [
  "name",
  "description",
  "price_cents",
  "duration_minutes",
  "active",
] as const;

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await getBusinessId(supabase, user.id);
  if (!biz)
    return NextResponse.json({ error: "No business found" }, { status: 404 });

  const body = await req.json();
  const { id } = body;
  const updates = pickAllowed(SERVICE_MUTABLE_FIELDS, body);
  const { data, error } = await supabase
    .from("services")
    .update(updates)
    .eq("id", id)
    .eq("business_id", biz.id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  void syncRetellPrompt(biz.id);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await getBusinessId(supabase, user.id);
  if (!biz)
    return NextResponse.json({ error: "No business found" }, { status: 404 });

  const { id } = await req.json();
  await supabase
    .from("services")
    .update({ active: false })
    .eq("id", id)
    .eq("business_id", biz.id);

  void syncRetellPrompt(biz.id);
  return NextResponse.json({ ok: true });
}
