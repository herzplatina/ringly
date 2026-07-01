import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyTwilioSignature } from "@/lib/twilio";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
  const twilioSignature = req.headers.get("x-twilio-signature") ?? "";
  const url = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/sender-status`;

  // Twilio sends form-encoded bodies; buffer as text so we can verify the
  // signature over the raw bytes before parsing.
  const rawBody = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) {
    params[k] = v;
  }

  if (!verifyTwilioSignature(url, params, twilioSignature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = new URLSearchParams(rawBody);
  // Twilio sends the approval status in the "Status" field (values: "approved", "rejected", etc.)
  const statusValue = (formData.get("Status") ?? "").toLowerCase();
  const whatsappNumber = String(formData.get("PhoneNumber") ?? "");

  if (!whatsappNumber) {
    return NextResponse.json({ error: "Missing PhoneNumber" }, { status: 400 });
  }

  // Map Twilio status values to our schema. Only terminal states are actionable;
  // for any unknown or intermediate value (e.g. "pending", "verifying") we skip
  // the write rather than clobbering an already-approved sender back to pending.
  let senderStatus: "approved" | "rejected" | null = null;
  if (statusValue === "approved") {
    senderStatus = "approved";
  } else if (statusValue === "rejected" || statusValue === "failed") {
    senderStatus = "rejected";
  }

  if (senderStatus === null) {
    console.warn(
      `Twilio sender-status: unhandled Status "${statusValue}" for ${whatsappNumber}`,
    );
    return NextResponse.json({ ok: true });
  }

  const db = createServiceClient();

  // Update status and retrieve the business id in one round-trip
  const { data: business } = await db
    .from("businesses")
    .update({ whatsapp_sender_status: senderStatus })
    .eq("whatsapp_number", whatsappNumber)
    .select("id")
    .single();

  // If rejected, cancel all pending reminders for this business
  if (senderStatus === "rejected" && business) {
    const { data: appointments } = await db
      .from("appointments")
      .select("id")
      .eq("business_id", business.id);

    if (appointments?.length) {
      await db
        .from("reminders")
        .update({ status: "failed" })
        .in(
          "appointment_id",
          appointments.map((a: { id: string }) => a.id),
        )
        .eq("status", "pending");
    }
  }

  return NextResponse.json({ ok: true });
}
