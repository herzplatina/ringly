import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { syncRetellPrompt } from "@/lib/retell";

// Re-push the current agent prompt to Retell for the logged-in owner's business.
// Used after prompt-template changes (e.g. date grounding, duration rules) so an
// already-provisioned agent picks them up without re-provisioning.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data: biz } = await db
    .from("businesses")
    .select("id, retell_llm_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!biz?.retell_llm_id)
    return NextResponse.json(
      { error: "No provisioned agent to re-sync" },
      { status: 404 },
    );

  await syncRetellPrompt(biz.id);
  return NextResponse.json({ ok: true });
}
