import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature } from "@/lib/retell";
import { normalizePhone } from "@/lib/utils";

// Order matters: rescheduled must come before booked because "rescheduled" contains "scheduled"
const OUTCOME_PRIORITY: Array<[string, string[]]> = [
  [
    "rescheduled",
    ["rescheduled", "moved your appointment", "changed your appointment"],
  ],
  ["cancelled", ["cancelled", "canceled"]],
  ["booked", ["booked", "scheduled", "appointment set", "confirmed"]],
  ["inquiry_only", ["information", "hours", "pricing", "price"]],
];

function deriveOutcome(transcript: string): string {
  const lower = transcript.toLowerCase();
  for (const [outcome, keywords] of OUTCOME_PRIORITY) {
    if (keywords.some((kw) => lower.includes(kw))) return outcome;
  }
  return "unresolved";
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-retell-signature") ?? "";

  if (!(await verifyRetellSignature(body, signature))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const retellCallId: string = payload.call_id ?? "";
  const fromNumber: string = payload.from_number ?? "";
  const toNumber: string = payload.to_number ?? "";
  const transcript: string = payload.transcript ?? "";

  const db = createServiceClient();

  const { data: business } = await db
    .from("businesses")
    .select("id, owner_user_id")
    .eq("retell_phone_number", toNumber)
    .single();

  if (!business) return NextResponse.json({ ok: true });

  // Determine if this is a test call (owner calling their own number)
  const { data: owner } = await db.auth.admin.getUserById(
    business.owner_user_id,
  );
  const ownerPhone = owner?.user?.phone ?? "";
  const isTestCall = ownerPhone
    ? normalizePhone(fromNumber).includes(normalizePhone(ownerPhone))
    : false;

  const outcome = deriveOutcome(transcript);

  await db.from("calls").upsert(
    {
      business_id: business.id,
      retell_call_id: retellCallId,
      from_number: fromNumber,
      outcome,
      is_test_call: isTestCall,
    },
    { onConflict: "retell_call_id" },
  );

  return NextResponse.json({ ok: true });
}
