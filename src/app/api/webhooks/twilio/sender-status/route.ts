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
  const status = String(formData.get("ChannelEndpointSid") ?? "");
  const whatsappNumber = String(formData.get("PhoneNumber") ?? "");
  const accountStatus = String(
    formData.get("ChannelRegistrationSid") ?? "pending",
  );

  // Map Twilio status values to our schema
  let senderStatus: "pending_verification" | "approved" | "rejected" =
    "pending_verification";
  if (
    accountStatus.toLowerCase().includes("approved") ||
    status.toLowerCase().includes("approved")
  ) {
    senderStatus = "approved";
  } else if (
    accountStatus.toLowerCase().includes("rejected") ||
    status.toLowerCase().includes("rejected")
  ) {
    senderStatus = "rejected";
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
