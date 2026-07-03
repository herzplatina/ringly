import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature, parseRetellCall } from "@/lib/retell";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { normalizeTimezone } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-retell-signature") ?? "";

  if (!(await verifyRetellSignature(body, signature))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(body);
  // Inbound webhook body: { event: "call_inbound", call_inbound: { from_number, to_number } }
  const { fromNumber, toNumber } = parseRetellCall(payload);

  const db = createServiceClient();

  // Look up business by the Retell phone number
  const { data: business } = await db
    .from("businesses")
    .select("id, timezone")
    .eq("retell_phone_number", toNumber)
    .single();

  if (!business) {
    return dynamicVariables({});
  }

  // Ground the agent in the real current date/time (in the business timezone) so
  // it never guesses the day of week for relative dates like "next Monday".
  // Normalize defensively: a legacy-stored invalid zone would throw in toZonedTime.
  const tz = normalizeTimezone(business.timezone);
  const now = toZonedTime(new Date(), tz);
  const dateVars = {
    current_date: format(now, "EEEE, MMMM d, yyyy"),
    current_time: format(now, "h:mm a"),
    current_year: format(now, "yyyy"),
    business_timezone: tz,
  };

  // Look up customer by phone number scoped to this business
  const { data: customer } = await db
    .from("customers")
    .select("id, name, whatsapp_consent_status")
    .eq("business_id", business.id)
    .eq("phone_number", fromNumber)
    .single();

  if (!customer) {
    return dynamicVariables({ ...dateVars, is_new_customer: "true" });
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
    ...dateVars,
    customer_name: customer.name ?? "",
    whatsapp_consent_status: customer.whatsapp_consent_status,
    is_new_customer: "false",
  };

  if (nextAppt) {
    const local = toZonedTime(new Date(nextAppt.starts_at), tz);
    variables.next_appointment = format(local, "EEEE, MMMM do 'at' h:mm a");
    variables.next_appointment_service = (nextAppt as any).services?.name ?? "";
  }

  if (lastAppt) {
    const local = toZonedTime(new Date(lastAppt.starts_at), tz);
    variables.last_visit = format(local, "MMMM do");
    variables.last_service = (lastAppt as any).services?.name ?? "";
  }

  return dynamicVariables(variables);
}

// Retell's inbound webhook requires dynamic variables nested under call_inbound.
function dynamicVariables(vars: Record<string, string>) {
  return NextResponse.json({ call_inbound: { dynamic_variables: vars } });
}
