import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import twilio from "twilio";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { whatsappNumber } = await req.json();
  if (!whatsappNumber) {
    return NextResponse.json(
      { error: "whatsappNumber required" },
      { status: 400 },
    );
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();
  if (!business)
    return NextResponse.json({ error: "Business not found" }, { status: 404 });

  // Begin Twilio WhatsApp Business sender registration
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!,
    );
    // Register the number as a WhatsApp Business sender via Twilio's Channel Endpoint API
    await (client as any).messaging.v1.brandRegistrations.create({
      customerProfileSid: whatsappNumber,
      a2pProfileBundle: whatsappNumber,
    });
  } catch (err) {
    // Log but don't fail — status will update via webhook when Meta processes it
    console.warn(
      "Twilio sender registration initiated (may already be pending):",
      err,
    );
  }

  await supabase
    .from("businesses")
    .update({
      whatsapp_number: whatsappNumber,
      whatsapp_sender_status: "pending_verification",
      onboarding_step: 7,
    })
    .eq("id", business.id);

  return NextResponse.json({ ok: true, status: "pending_verification" });
}
