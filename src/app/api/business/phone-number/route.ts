import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { purchasePhoneNumber, bindAgentToNumber } from "@/lib/retell";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { areaCode } = await req.json();

  const { data: business } = await supabase
    .from("businesses")
    .select("id, retell_agent_id, retell_phone_number")
    .eq("owner_user_id", user.id)
    .single();

  if (!business)
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  if (business.retell_phone_number) {
    return NextResponse.json({ phone_number: business.retell_phone_number });
  }

  const result = await purchasePhoneNumber(areaCode);
  const phoneNumber: string = result.phone_number;

  await supabase
    .from("businesses")
    .update({ retell_phone_number: phoneNumber, onboarding_step: 3 })
    .eq("id", business.id);

  // Bind to agent if already provisioned
  if (business.retell_agent_id) {
    await bindAgentToNumber(phoneNumber, business.retell_agent_id);
  }

  return NextResponse.json({ phone_number: phoneNumber });
}
