import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncRetellPrompt } from "@/lib/retell";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_user_id", user.id)
    .single();

  return NextResponse.json(data ?? null);
}

// Fields a client is allowed to set on their own business record.
// Retell/WhatsApp/Google fields are set only by internal API calls.
const MUTABLE_FIELDS = [
  "name",
  "business_type",
  "address",
  "timezone",
  "greeting_script",
  "onboarding_step",
  "whatsapp_number",
] as const;

type MutableField = (typeof MUTABLE_FIELDS)[number];

function pickAllowed(
  body: Record<string, unknown>,
): Partial<Record<MutableField, unknown>> {
  return Object.fromEntries(
    MUTABLE_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]),
  ) as Partial<Record<MutableField, unknown>>;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const allowed = pickAllowed(body);
  const { data, error } = await supabase
    .from("businesses")
    .insert({ ...allowed, owner_user_id: user.id })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const allowed = pickAllowed(body);

  const { data: business, error } = await supabase
    .from("businesses")
    .update(allowed)
    .eq("owner_user_id", user.id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  // If editable fields changed, regenerate Retell agent prompt asynchronously
  const promptFields = ["greeting_script", "name", "business_type", "timezone"];
  if (
    business.retell_agent_id &&
    Object.keys(body).some((k) => promptFields.includes(k))
  ) {
    void syncRetellPrompt(business.id);
  }

  return NextResponse.json(business);
}
