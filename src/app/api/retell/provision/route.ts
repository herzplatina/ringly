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
  selectReusableNumber,
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
  // purchases a (billable) number. Reuse a genuinely orphaned number on the
  // account (e.g. leftover test numbers, or an earlier failed run) before
  // buying a new one. "Orphaned" means BOTH: no inbound agent bound in Retell,
  // AND not already recorded against any business in our DB — otherwise we
  // could steal a live business's number that was merely unbound in Retell.
  let phoneNumber: string | null = business.retell_phone_number;
  if (!phoneNumber) {
    const existing = await listPhoneNumbers();
    const { data: taken } = await db
      .from("businesses")
      .select("retell_phone_number")
      .not("retell_phone_number", "is", null);
    const reusable = selectReusableNumber(
      existing,
      (taken ?? []).map((b) => b.retell_phone_number as string),
    );
    phoneNumber = reusable ?? (await purchasePhoneNumber()).phone_number;
  }

  // Claim the number in our DB BEFORE binding it in Retell. The unique index on
  // retell_phone_number arbitrates concurrent provisions: if two businesses pick
  // the same orphaned number, only one UPDATE wins — the loser fails here (23505)
  // and never binds, so it can't misroute the number in Retell. Bind happens only
  // after the claim succeeds.
  const { error: claimError } = await db
    .from("businesses")
    .update({
      retell_phone_number: phoneNumber,
      retell_agent_id: agent.agent_id,
      retell_llm_id: llm.llm_id,
      onboarding_status: "live",
    })
    .eq("id", businessId);

  if (claimError) {
    // Retell resources were created but not persisted — log them for cleanup.
    console.error("provision: DB claim failed after Retell creation", {
      businessId,
      llm_id: llm.llm_id,
      agent_id: agent.agent_id,
      phone_number: phoneNumber,
      code: claimError.code,
      error: claimError.message,
    });
    // 23505 = another business claimed this number between our reuse scan and
    // now; retrying provisioning will pick a different free number.
    const raced = claimError.code === "23505";
    return NextResponse.json(
      {
        error: raced
          ? "That phone number was just taken. Please retry."
          : "Provisioning succeeded in Retell but failed to save. Please retry.",
      },
      { status: raced ? 409 : 500 },
    );
  }

  // The number is ours; bind the agent. If binding fails, release the claim so
  // the number returns to the free pool for a retry instead of being stranded on
  // a business marked "live" that can't actually receive calls.
  if (phoneNumber) {
    try {
      await bindAgentToNumber(phoneNumber, agent.agent_id, agent.version);
    } catch (bindErr) {
      await db
        .from("businesses")
        .update({
          retell_phone_number: null,
          retell_agent_id: null,
          retell_llm_id: null,
          onboarding_status: business.onboarding_status,
        })
        .eq("id", businessId);
      console.error("provision: bind failed; released claim", {
        businessId,
        llm_id: llm.llm_id,
        agent_id: agent.agent_id,
        phone_number: phoneNumber,
        error: bindErr instanceof Error ? bindErr.message : String(bindErr),
      });
      return NextResponse.json(
        { error: "Could not connect the phone number. Please retry." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    agent_id: agent.agent_id,
    phone_number: phoneNumber,
  });
}
