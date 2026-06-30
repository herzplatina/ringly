import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createRetellLLM,
  createAgent,
  bindAgentToNumber,
  buildAgentPrompt,
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
    return NextResponse.json({ ok: true, already_provisioned: true });

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

  // Bind agent to phone number if already purchased
  if (business.retell_phone_number) {
    await bindAgentToNumber(business.retell_phone_number, agent.agent_id);
  }

  await db
    .from("businesses")
    .update({
      retell_agent_id: agent.agent_id,
      retell_llm_id: llm.llm_id,
    })
    .eq("id", businessId);

  return NextResponse.json({ ok: true, agent_id: agent.agent_id });
}
