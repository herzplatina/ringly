import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // Save the WhatsApp number and mark as pending — the actual sender registration
  // is completed out-of-band through the Twilio console. Status updates arrive
  // via the /api/webhooks/twilio/sender-status webhook once Twilio/Meta approves.
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
