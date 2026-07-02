import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature, parseRetellCall } from "@/lib/retell";
import { phonesMatch } from "@/lib/utils";

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
  // Retell sends call_started, call_ended, and call_analyzed for every call.
  // Only the terminal events carry a transcript worth recording; skip the rest.
  if (payload.event !== "call_ended" && payload.event !== "call_analyzed") {
    return NextResponse.json({ ok: true });
  }

  // Call-event body: { event, call: { call_id, from_number, to_number, transcript } }
  const {
    callId: retellCallId,
    fromNumber,
    toNumber,
  } = parseRetellCall(payload);
  const transcript: string =
    payload.call?.transcript ?? payload.transcript ?? "";

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
  const isTestCall = phonesMatch(fromNumber, ownerPhone);

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
