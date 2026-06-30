import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature } from "@/lib/retell";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-retell-signature") ?? "";

  if (!verifyRetellSignature(body, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const fromNumber: string = payload.from_number ?? "";
  const toNumber: string = payload.to_number ?? "";

  const db = createServiceClient();

  // Look up business by the Retell phone number
  const { data: business } = await db
    .from("businesses")
    .select("id, timezone")
    .eq("retell_phone_number", toNumber)
    .single();

  if (!business) {
    return NextResponse.json({});
  }

  // Look up customer by phone number scoped to this business
  const { data: customer } = await db
    .from("customers")
    .select("id, name, whatsapp_consent_status")
    .eq("business_id", business.id)
    .eq("phone_number", fromNumber)
    .single();

  if (!customer) {
    return NextResponse.json({ is_new_customer: true });
  }

  const [{ data: nextAppt }, { data: lastAppt }] = await Promise.all([
    db
      .from("appointments")
      .select("starts_at, ends_at, services(name)")
      .eq("customer_id", customer.id)
      .eq("business_id", business.id)
      .in("status", ["booked", "rescheduled"])
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .single(),
    db
      .from("appointments")
      .select("starts_at, services(name)")
      .eq("customer_id", customer.id)
      .eq("business_id", business.id)
      .eq("status", "completed")
      .order("starts_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const variables: Record<string, string> = {
    customer_name: customer.name ?? "",
    whatsapp_consent_status: customer.whatsapp_consent_status,
    is_new_customer: "false",
  };

  if (nextAppt) {
    const local = toZonedTime(new Date(nextAppt.starts_at), business.timezone);
    variables.next_appointment = format(local, "EEEE, MMMM do 'at' h:mm a");
    variables.next_appointment_service = (nextAppt as any).services?.name ?? "";
  }

  if (lastAppt) {
    const local = toZonedTime(new Date(lastAppt.starts_at), business.timezone);
    variables.last_visit = format(local, "MMMM do");
    variables.last_service = (lastAppt as any).services?.name ?? "";
  }

  return NextResponse.json(variables);
}
