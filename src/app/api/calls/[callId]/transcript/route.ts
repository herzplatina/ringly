import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCall } from "@/lib/retell";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { callId } = await params;

  // Verify the call belongs to this owner's business
  const { data: call } = await supabase
    .from("calls")
    .select("retell_call_id, business_id, businesses!inner(owner_user_id)")
    .eq("id", callId)
    .single();

  if (!call || (call as any).businesses?.owner_user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch transcript and recording from Retell API on demand
  const retellCall = await getCall(call.retell_call_id);

  return NextResponse.json({
    transcript: retellCall.transcript ?? "",
    recording_url: retellCall.recording_url ?? null,
    duration_ms: retellCall.end_timestamp
      ? retellCall.end_timestamp - retellCall.start_timestamp
      : null,
  });
}
