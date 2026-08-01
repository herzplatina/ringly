import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature, parseRetellCall } from "@/lib/retell";
import { computeAvailableSlots, formatSlotForSpeech } from "@/lib/availability";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";
import { sendWhatsApp } from "@/lib/twilio";
import { addHours } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { namesMatch, normalizePhone } from "@/lib/utils";

/**
 * Supabase returns a joined one-to-one relation as either an object or a
 * single-element array depending on how it inferred the relationship.
 */
function joined<T>(v: T[] | T | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

/** Local wall-clock date + time in a timezone, as a UTC ISO timestamp. */
function localToUtcIso(
  date: string,
  time: string,
  timezone: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  // Find the UTC instant whose rendering in `timezone` is the wanted local
  // time. One correction pass is enough: offsets are whole minutes, so the
  // second evaluation is exact except across a transition, where the earlier
  // of the two candidate instants is returned.
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const seen = new Date(naive.toLocaleString("en-US", { timeZone: timezone }));
  const local = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(
    naive.getTime() + (local.getTime() - seen.getTime()),
  ).toISOString();
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-retell-signature") ?? "";

  if (!(await verifyRetellSignature(body, signature))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(body);
  // Retell custom-function body: { name, call: {...}, args }
  const functionName: string = payload.name ?? payload.function_name ?? "";
  const args: Record<string, unknown> = payload.args ?? payload.arguments ?? {};
  const { callId, toNumber, fromNumber } = parseRetellCall(payload);

  const db = createServiceClient();

  // Resolve business from the called phone number
  const { data: business } = await db
    .from("businesses")
    .select("id, name, timezone, whatsapp_number, whatsapp_sender_status")
    .eq("retell_phone_number", toNumber)
    .single();

  if (!business) {
    return NextResponse.json({ result: "Business not found." });
  }

  try {
    switch (functionName) {
      case "check_availability":
        return handleCheckAvailability(db, business, args);

      case "record_whatsapp_consent":
        return handleRecordConsent(db, business, args, callId, fromNumber);

      case "book_appointment":
        return handleBookAppointment(db, business, args, callId);

      case "reschedule_appointment":
        return handleReschedule(db, business, args);

      case "cancel_appointment":
        return handleCancel(db, business, args);

      case "find_appointment":
        return handleFindAppointment(db, business, args);

      default:
        return NextResponse.json({
          result: `Unknown function: ${functionName}`,
        });
    }
  } catch (err) {
    console.error(`Function ${functionName} error:`, err);
    return NextResponse.json({
      result: "An error occurred. Please try again.",
    });
  }
}

// ── check_availability ──────────────────────────────────────────────────────
async function handleCheckAvailability(
  db: ReturnType<typeof createServiceClient>,
  business: { id: string; timezone: string },
  args: Record<string, unknown>,
) {
  const date = String(args.date ?? "");
  const serviceId = String(args.service_id ?? "");

  const { data: service } = await db
    .from("services")
    .select("duration_minutes, name")
    .eq("id", serviceId)
    .eq("business_id", business.id)
    .single();

  const duration = service?.duration_minutes ?? 30;

  const { data: hours } = await db
    .from("business_hours")
    .select("*")
    .eq("business_id", business.id);

  const dayStart = fromZonedTime(
    `${date}T00:00:00`,
    business.timezone,
  ).toISOString();
  const dayEnd = fromZonedTime(
    `${date}T23:59:59`,
    business.timezone,
  ).toISOString();

  const { data: existing } = await db
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("business_id", business.id)
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .in("status", ["booked", "rescheduled"]);

  const slots = computeAvailableSlots(
    date,
    duration,
    business.timezone,
    hours ?? [],
    existing ?? [],
  );

  if (slots.length === 0) {
    return NextResponse.json({
      result: `No availability on ${date}. Please suggest another date.`,
    });
  }

  const slotList = slots
    .slice(0, 5)
    .map((s) => formatSlotForSpeech(s, business.timezone))
    .join(", ");

  return NextResponse.json({
    result: `Available times on ${date}: ${slotList}`,
    slots: slots.slice(0, 5),
  });
}

// ── record_whatsapp_consent ─────────────────────────────────────────────────
async function handleRecordConsent(
  db: ReturnType<typeof createServiceClient>,
  business: { id: string },
  args: Record<string, unknown>,
  callId: string,
  callerPhone: string,
) {
  // Consent is recorded against the verified caller ID, never a number the
  // model supplied. Otherwise a caller could flip someone else's declined
  // consent to granted and cause messages to be sent to a person who refused
  // them.
  const phoneNumber = normalizePhone(callerPhone);
  if (!phoneNumber) {
    return NextResponse.json({
      result: "I can only record consent for the number you're calling from.",
    });
  }
  const consent = args.consent; // true / false / "yes" / "no"
  const granted =
    consent === true || consent === "yes" || consent === "granted";

  // Upsert customer record first (may not exist yet)
  await db.from("customers").upsert(
    {
      business_id: business.id,
      phone_number: phoneNumber,
      whatsapp_consent_status: granted ? "granted" : "declined",
      whatsapp_consent_at: new Date().toISOString(),
      whatsapp_consent_call_id: callId,
    },
    { onConflict: "business_id,phone_number", ignoreDuplicates: false },
  );

  return NextResponse.json({
    result: granted
      ? "WhatsApp consent recorded. We will send a confirmation and reminders."
      : "Consent declined. No WhatsApp messages will be sent.",
  });
}

// ── book_appointment ────────────────────────────────────────────────────────
async function handleBookAppointment(
  db: ReturnType<typeof createServiceClient>,
  business: {
    id: string;
    name: string;
    timezone: string;
    whatsapp_number: string | null;
    whatsapp_sender_status: string;
  },
  args: Record<string, unknown>,
  callId: string,
) {
  const customerName = String(args.customer_name ?? "");
  const phoneNumber = normalizePhone(String(args.phone_number ?? ""));
  const serviceId = String(args.service_id ?? "");
  const startsAt = String(args.starts_at ?? "");

  // Fetch service for duration
  const { data: service } = await db
    .from("services")
    .select("id, name, duration_minutes")
    .eq("id", serviceId)
    .eq("business_id", business.id)
    .single();

  const duration = service?.duration_minutes ?? 30;
  const endsAt = addHours(new Date(startsAt), duration / 60).toISOString();

  // Upsert customer
  const { data: customer } = await db
    .from("customers")
    .upsert(
      {
        business_id: business.id,
        phone_number: phoneNumber,
        name: customerName,
      },
      { onConflict: "business_id,phone_number" },
    )
    .select("id, whatsapp_consent_status")
    .single();

  if (!customer) {
    return NextResponse.json({ result: "Could not create customer record." });
  }

  // Insert appointment
  const { data: appointment } = await db
    .from("appointments")
    .insert({
      business_id: business.id,
      customer_id: customer.id,
      service_id: serviceId || null,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "booked",
      source_call_id: callId,
    })
    .select("id")
    .single();

  if (!appointment) {
    return NextResponse.json({ result: "Could not create appointment." });
  }

  // Insert reminder rows synchronously so they survive a cold serverless kill
  if (
    customer.whatsapp_consent_status === "granted" &&
    business.whatsapp_sender_status === "approved" &&
    business.whatsapp_number
  ) {
    const apptTime = new Date(startsAt);
    await db.from("reminders").insert([
      {
        appointment_id: appointment.id,
        channel: "whatsapp",
        kind: "confirmation",
        from_number: business.whatsapp_number,
        to_number: phoneNumber,
        scheduled_for: new Date().toISOString(),
        status: "pending",
      },
      {
        appointment_id: appointment.id,
        channel: "whatsapp",
        kind: "reminder_24h",
        from_number: business.whatsapp_number,
        to_number: phoneNumber,
        scheduled_for: addHours(apptTime, -24).toISOString(),
        status: "pending",
      },
      {
        appointment_id: appointment.id,
        channel: "whatsapp",
        kind: "reminder_4h",
        from_number: business.whatsapp_number,
        to_number: phoneNumber,
        scheduled_for: addHours(apptTime, -4).toISOString(),
        status: "pending",
      },
    ]);
  }

  // Fire-and-forget: external API calls only (calendar + WhatsApp send)
  void syncAfterBooking(db, business, appointment.id, {
    customerName,
    phoneNumber,
    serviceName: service?.name ?? "Appointment",
    startsAt,
    endsAt,
    consentStatus: customer.whatsapp_consent_status,
  });

  return NextResponse.json({
    result: `Appointment booked for ${customerName} on ${startsAt}. A confirmation will be sent if consent was granted.`,
    appointment_id: appointment.id,
  });
}

async function syncAfterBooking(
  db: ReturnType<typeof createServiceClient>,
  business: {
    id: string;
    name: string;
    timezone: string;
    whatsapp_number: string | null;
    whatsapp_sender_status: string;
  },
  appointmentId: string,
  data: {
    customerName: string;
    phoneNumber: string;
    serviceName: string;
    startsAt: string;
    endsAt: string;
    consentStatus: string;
  },
) {
  // Google Calendar
  try {
    const eventId = await createCalendarEvent(business.id, {
      id: appointmentId,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      customer_name: data.customerName,
      customer_phone: data.phoneNumber,
      service_name: data.serviceName,
    });
    await db
      .from("appointments")
      .update({ google_calendar_event_id: eventId })
      .eq("id", appointmentId);
  } catch (err) {
    console.error("Calendar sync failed:", err);
  }

  // Send WhatsApp confirmation (reminder row already inserted synchronously)
  if (
    data.consentStatus === "granted" &&
    business.whatsapp_sender_status === "approved" &&
    business.whatsapp_number
  ) {
    try {
      await sendWhatsApp(
        business.whatsapp_number,
        data.phoneNumber,
        "confirmation",
        {
          "1": data.serviceName,
          "2": business.name,
          "3": data.startsAt,
        },
      );
      await db
        .from("reminders")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("appointment_id", appointmentId)
        .eq("kind", "confirmation");
    } catch (err) {
      console.error("WhatsApp confirmation failed:", err);
      await db
        .from("reminders")
        .update({ status: "failed" })
        .eq("appointment_id", appointmentId)
        .eq("kind", "confirmation");
    }
  }
}

// ── reschedule_appointment ──────────────────────────────────────────────────
async function handleReschedule(
  db: ReturnType<typeof createServiceClient>,
  business: {
    id: string;
    timezone: string;
    whatsapp_number: string | null;
    whatsapp_sender_status: string;
  },
  args: Record<string, unknown>,
) {
  const appointmentId = String(args.appointment_id ?? "");
  const newStartsAt = String(args.new_starts_at ?? "");
  const statedName = String(args.customer_name ?? "").trim();

  const { data: appt } = await db
    .from("appointments")
    .select(
      "id, service_id, customer_id, google_calendar_event_id, services(name, duration_minutes), customers(name, phone_number, whatsapp_consent_status)",
    )
    .eq("id", appointmentId)
    .eq("business_id", business.id)
    .single();

  if (!appt) {
    return NextResponse.json({ result: "Appointment not found." });
  }

  // F2.4 — the identifying tuple authenticates, not caller ID: a customer may
  // ring from a different phone or withhold their number. The name is
  // re-checked here so this call cannot act on an appointment that
  // find_appointment never matched.
  if (!namesMatch((appt as any).customers?.name ?? "", statedName)) {
    return NextResponse.json({
      result: "That name does not match the booking. Could you say it again?",
    });
  }

  const duration = (appt as any).services?.duration_minutes ?? 30;
  const newEndsAt = addHours(
    new Date(newStartsAt),
    duration / 60,
  ).toISOString();

  await db
    .from("appointments")
    .update({
      starts_at: newStartsAt,
      ends_at: newEndsAt,
      status: "rescheduled",
    })
    .eq("id", appointmentId);

  // Cancel old pending reminders
  await db
    .from("reminders")
    .update({ status: "cancelled" })
    .eq("appointment_id", appointmentId)
    .eq("status", "pending");

  // Insert new reminder rows synchronously so they survive a cold serverless kill
  const customer = (appt as any).customers;
  if (
    customer?.whatsapp_consent_status === "granted" &&
    business.whatsapp_sender_status === "approved" &&
    business.whatsapp_number
  ) {
    const apptTime = new Date(newStartsAt);
    await db.from("reminders").insert([
      {
        appointment_id: appointmentId,
        channel: "whatsapp",
        kind: "confirmation",
        from_number: business.whatsapp_number,
        to_number: customer.phone_number,
        scheduled_for: new Date().toISOString(),
        status: "pending",
      },
      {
        appointment_id: appointmentId,
        channel: "whatsapp",
        kind: "reminder_24h",
        from_number: business.whatsapp_number,
        to_number: customer.phone_number,
        scheduled_for: addHours(apptTime, -24).toISOString(),
        status: "pending",
      },
      {
        appointment_id: appointmentId,
        channel: "whatsapp",
        kind: "reminder_4h",
        from_number: business.whatsapp_number,
        to_number: customer.phone_number,
        scheduled_for: addHours(apptTime, -4).toISOString(),
        status: "pending",
      },
    ]);
  }

  // Fire-and-forget: calendar update only
  void (async () => {
    try {
      if (appt.google_calendar_event_id) {
        await updateCalendarEvent(business.id, appt.google_calendar_event_id, {
          starts_at: newStartsAt,
          ends_at: newEndsAt,
          customer_name: customer?.name ?? "",
          service_name: (appt as any).services?.name ?? "Appointment",
        });
      }
    } catch (err) {
      console.error("Calendar reschedule failed:", err);
    }
  })();

  return NextResponse.json({
    result: `Appointment rescheduled to ${newStartsAt}.`,
  });
}

// ── cancel_appointment ──────────────────────────────────────────────────────
async function handleCancel(
  db: ReturnType<typeof createServiceClient>,
  business: { id: string },
  args: Record<string, unknown>,
) {
  const appointmentId = String(args.appointment_id ?? "");
  const statedName = String(args.customer_name ?? "").trim();

  const { data: appt } = await db
    .from("appointments")
    .select("google_calendar_event_id, customers(phone_number)")
    .eq("id", appointmentId)
    .eq("business_id", business.id)
    .single();

  if (!appt) {
    return NextResponse.json({ result: "Appointment not found." });
  }

  // F2.4 — see handleReschedule: the tuple authenticates, not caller ID.
  if (!namesMatch((appt as any).customers?.name ?? "", statedName)) {
    return NextResponse.json({
      result: "That name does not match the booking. Could you say it again?",
    });
  }

  await db
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", appointmentId);

  await db
    .from("reminders")
    .update({ status: "cancelled" })
    .eq("appointment_id", appointmentId)
    .eq("status", "pending");

  void (async () => {
    try {
      if (appt.google_calendar_event_id) {
        await deleteCalendarEvent(business.id, appt.google_calendar_event_id);
      }
    } catch (err) {
      console.error("Calendar cancel failed:", err);
    }
  })();

  return NextResponse.json({ result: "Appointment cancelled successfully." });
}

// ── find_appointment ────────────────────────────────────────────────────────
/**
 * F2.4 / §2.5.6 — identify one appointment by name plus its details.
 *
 * **Caller ID is deliberately not used.** A customer may ring from a different
 * phone or withhold their number, so gating on caller ID refuses legitimate
 * callers. The four facts together are the authentication: the tuple is narrow
 * because two appointments cannot share a slot, and a caller who already knows
 * the name, date, time and service of a booking knows everything this returns.
 *
 * **There is deliberately no way to list a customer's appointments.** An
 * earlier version took a phone number and returned everything booked under it,
 * which let any caller name any number and be read that customer's name,
 * schedule and appointment ids.
 */
async function handleFindAppointment(
  db: ReturnType<typeof createServiceClient>,
  business: { id: string; timezone: string },
  args: Record<string, unknown>,
) {
  const name = String(args.customer_name ?? "").trim();
  const date = String(args.date ?? "").trim();
  const time = String(args.time ?? "").trim();
  const serviceName = String(args.service_name ?? "").trim();

  if (!name || !date || !time || !serviceName) {
    return NextResponse.json({
      result:
        "I need the name it was booked under, the date, the time and the service.",
    });
  }

  const startsAt = localToUtcIso(date, time, business.timezone);
  if (!startsAt) {
    return NextResponse.json({
      result: "I did not catch the date and time. Could you say them again?",
    });
  }

  // Everything in that slot, so a partial match can say which detail was wrong
  // rather than a bare "not found" the caller cannot act on (F2.4).
  const { data: inSlot } = await db
    .from("appointments")
    .select("id, starts_at, services(name), customers(name)")
    .eq("business_id", business.id)
    .eq("starts_at", startsAt)
    .in("status", ["booked", "rescheduled"]);

  const rows = inSlot ?? [];
  if (rows.length === 0) {
    return NextResponse.json({
      result: `I have nothing booked at that time on ${date}. Could you check the date and time?`,
    });
  }

  const match = rows.find(
    (a) =>
      namesMatch(joined<{ name?: string }>(a.customers)?.name ?? "", name) &&
      namesMatch(
        joined<{ name?: string }>(a.services)?.name ?? "",
        serviceName,
      ),
  );

  if (!match) {
    // Name the failing field, never the correct value: "that slot is Nguyen's"
    // would leak the very thing the match protects.
    const nameMatches = rows.some((a) =>
      namesMatch(joined<{ name?: string }>(a.customers)?.name ?? "", name),
    );
    return NextResponse.json({
      result: nameMatches
        ? "I have that name at that time, but for a different service. Which service was it?"
        : "That name does not match what I have at that time. Could you spell it for me?",
    });
  }

  return NextResponse.json({
    result: `Found it: ${joined<{ name?: string }>(match.services)?.name ?? "appointment"} on ${formatSlotForSpeech(
      { starts_at: match.starts_at, ends_at: match.starts_at },
      business.timezone,
    )}.`,
    appointment_id: match.id,
  });
}
