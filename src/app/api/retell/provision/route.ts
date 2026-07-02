import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createRetellLLM,
  createAgent,
  bindAgentToNumber,
  buildAgentPrompt,
  purchasePhoneNumber,
  listPhoneNumbers,
} from "@/lib/retell";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { businessId } = await req.json();

  const db = createServiceClient();

  const { data: business } = await db
    .from("businesses")
    .select("*, services(*), business_hours(*)")
    .eq("id", businessId)
    .eq("owner_user_id", user.id)
    .single();

  if (!business)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (business.retell_agent_id)
    return NextResponse.json({
      ok: true,
      already_provisioned: true,
      phone_number: business.retell_phone_number,
    });

  const prompt = buildAgentPrompt({
    name: business.name,
    business_type: business.business_type,
    timezone: business.timezone,
    greeting_script: business.greeting_script,
    services: business.services ?? [],
    hours: business.business_hours ?? [],
  });

  // Sequential: LLM must exist before agent can reference it
  const llm = await createRetellLLM(prompt);
  const agent = await createAgent(llm.llm_id, business.name);

  // Buy the number AFTER the agent exists so a failed LLM/agent create never
  // purchases a (billable) number. Reuse an existing unbound number on the
  // account (e.g. from an earlier failed run) before buying a new one.
  let phoneNumber: string | null = business.retell_phone_number;
  if (!phoneNumber) {
    const existing = await listPhoneNumbers();
    const unbound = existing.find(
      (n) => !n.inbound_agents || n.inbound_agents.length === 0,
    );
    phoneNumber = unbound
      ? unbound.phone_number
      : (await purchasePhoneNumber()).phone_number;
  }

  // Bind agent to the (now guaranteed) phone number
  if (phoneNumber) {
    await bindAgentToNumber(phoneNumber, agent.agent_id, agent.version);
  }

  const { error: updateError } = await db
    .from("businesses")
    .update({
      retell_phone_number: phoneNumber,
      retell_agent_id: agent.agent_id,
      retell_llm_id: llm.llm_id,
      onboarding_status: "live",
    })
    .eq("id", businessId);

  if (updateError) {
    // IDs were created in Retell but not persisted — log them so ops can clean up
    console.error("provision: DB update failed after Retell creation", {
      businessId,
      llm_id: llm.llm_id,
      agent_id: agent.agent_id,
      error: updateError.message,
    });
    return NextResponse.json(
      {
        error:
          "Provisioning succeeded in Retell but failed to save. Please retry.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    agent_id: agent.agent_id,
    phone_number: phoneNumber,
  });
}
