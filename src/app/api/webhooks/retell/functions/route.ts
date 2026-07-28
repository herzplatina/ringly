import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature, parseRetellCall } from "@/lib/retell";
import {
  computeAvailableSlots,
  filterFutureSlots,
  findAlternativeSlots,
  formatSlotForSpeech,
  hasConflict,
} from "@/lib/availability";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
} from "@/lib/google-calendar";
import { sendWhatsApp } from "@/lib/twilio";
import { addHours, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { normalizePhone, phonesMatch } from "@/lib/utils";

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
        return handleRecordConsent(db, business, args, callId);

      case "book_appointment":
        return handleBookAppointment(db, business, args, callId);

      case "reschedule_appointment":
        return handleReschedule(db, business, args, fromNumber);

      case "cancel_appointment":
        return handleCancel(db, business, args, fromNumber);

      case "get_customer_appointments":
        return handleGetAppointments(db, business, args);

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

type BusyInterval = { starts_at: string; ends_at: string };

/**
 * Every interval that blocks booking over [fromIso, toIso): our own active
 * appointments plus events on the owner's Google Calendar. The calendar lookup
 * is best-effort — a disconnected or expired calendar must not break booking,
 * so on failure we fall back to the appointments table alone.
 * `excludeAppointmentId` / `excludeCalendarEventId` let a reschedule ignore the
 * appointment being moved (both our row and its copy on the calendar).
 */
async function getBusyIntervals(
  db: ReturnType<typeof createServiceClient>,
  businessId: string,
  fromIso: string,
  toIso: string,
  excludeAppointmentId?: string,
  excludeCalendarEventId?: string,
): Promise<BusyInterval[]> {
  let query = db
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("business_id", businessId)
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .in("status", ["booked", "rescheduled"]);
  if (excludeAppointmentId) query = query.neq("id", excludeAppointmentId);
  const { data: appointments } = await query;

  const busy: BusyInterval[] = [...(appointments ?? [])];

  try {
    const events = await listCalendarEvents(businessId, fromIso, toIso);
    for (const event of events ?? []) {
      if (excludeCalendarEventId && event.id === excludeCalendarEventId)
        continue;
      busy.push({ starts_at: event.starts_at, ends_at: event.ends_at });
    }
  } catch (err) {
    console.error("Google Calendar conflict check failed:", err);
  }

  return busy;
}

/** Local calendar date (YYYY-MM-DD) of an instant in the business timezone. */
function localDateString(iso: string, timezone: string): string {
  return format(toZonedTime(new Date(iso), timezone), "yyyy-MM-dd");
}

/**
 * The whole local day containing `startIso`, widened if needed so the full
 * [startIso, endIso) window is covered (an appointment may run past midnight).
 */
function dayWindow(startIso: string, endIso: string, timezone: string) {
  const date = localDateString(startIso, timezone);
  const dayStart = fromZonedTime(`${date}T00:00:00`, timezone);
  const dayEnd = fromZonedTime(`${date}T23:59:59`, timezone);
  const start = new Date(startIso);
  const end = new Date(endIso);
  return {
    date,
    from: (dayStart < start ? dayStart : start).toISOString(),
    to: (dayEnd > end ? dayEnd : end).toISOString(),
  };
}

/**
 * Refuse a booking/reschedule and offer the nearest open times on either side
 * of the requested window. Alternatives are computed against the same busy
 * intervals the conflict check used, so every offered time would be accepted,
 * and slots already in the past are never offered.
 */
async function conflictResponse(
  db: ReturnType<typeof createServiceClient>,
  business: { id: string; timezone: string },
  date: string,
  durationMinutes: number,
  busy: BusyInterval[],
  startsAt: string,
  endsAt: string,
) {
  const { data: hours } = await db
    .from("business_hours")
    .select("*")
    .eq("business_id", business.id);

  const alternatives = findAlternativeSlots(
    date,
    durationMinutes,
    business.timezone,
    hours ?? [],
    busy,
    startsAt,
  );

  const requested = formatSlotForSpeech(
    { starts_at: startsAt, ends_at: endsAt },
    business.timezone,
  );
  const suggestion =
    alternatives.length > 0
      ? `The nearest available times are ${alternatives
          .map((s) => formatSlotForSpeech(s, business.timezone))
          .join(", ")}.`
      : "There are no other openings that day. Please suggest another date.";

  return NextResponse.json({
    result: `Sorry, ${requested} is already taken. ${suggestion}`,
    alternatives,
  });
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

  // Offer only slots booking would actually accept: the window must be free
  // across both our appointments and the owner's Google Calendar, and slots
  // already in the past are never bookable.
  const busy = await getBusyIntervals(db, business.id, dayStart, dayEnd);

  const slots = filterFutureSlots(
    computeAvailableSlots(date, duration, business.timezone, hours ?? [], busy),
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
) {
  const phoneNumber = normalizePhone(String(args.phone_number ?? ""));
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

  if (isNaN(new Date(startsAt).getTime())) {
    return NextResponse.json({
      result: "Invalid starts_at time. Please use an ISO 8601 timestamp.",
    });
  }

  const duration = service?.duration_minutes ?? 30;
  const endsAt = addHours(new Date(startsAt), duration / 60).toISOString();

  // Never double-book: verify the requested window is free across both our
  // appointments table and the owner's Google Calendar before writing anything.
  const window = dayWindow(startsAt, endsAt, business.timezone);
  const busy = await getBusyIntervals(db, business.id, window.from, window.to);
  if (hasConflict(busy, startsAt, endsAt)) {
    return conflictResponse(
      db,
      business,
      window.date,
      duration,
      busy,
      startsAt,
      endsAt,
    );
  }

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
  callerPhone: string,
) {
  const appointmentId = String(args.appointment_id ?? "");
  const newStartsAt = String(args.new_starts_at ?? "");

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

  // Verify the caller owns this appointment. phonesMatch requires both numbers
  // to be non-empty, so a suppressed caller ID never passes the ownership check.
  if (!phonesMatch((appt as any).customers?.phone_number ?? "", callerPhone)) {
    return NextResponse.json({
      result: "You can only reschedule your own appointments.",
    });
  }

  if (isNaN(new Date(newStartsAt).getTime())) {
    return NextResponse.json({
      result: "Invalid new_starts_at time. Please use an ISO 8601 timestamp.",
    });
  }

  const duration = (appt as any).services?.duration_minutes ?? 30;
  const newEndsAt = addHours(
    new Date(newStartsAt),
    duration / 60,
  ).toISOString();

  // Never double-book: the new window must be free across both our
  // appointments table and the owner's Google Calendar — ignoring the
  // appointment being moved, which is not a conflict with itself (neither our
  // row nor its calendar event).
  const window = dayWindow(newStartsAt, newEndsAt, business.timezone);
  const busy = await getBusyIntervals(
    db,
    business.id,
    window.from,
    window.to,
    appointmentId,
    appt.google_calendar_event_id ?? undefined,
  );
  if (hasConflict(busy, newStartsAt, newEndsAt)) {
    return conflictResponse(
      db,
      business,
      window.date,
      duration,
      busy,
      newStartsAt,
      newEndsAt,
    );
  }

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
  callerPhone: string,
) {
  const appointmentId = String(args.appointment_id ?? "");

  const { data: appt } = await db
    .from("appointments")
    .select("google_calendar_event_id, customers(phone_number)")
    .eq("id", appointmentId)
    .eq("business_id", business.id)
    .single();

  if (!appt) {
    return NextResponse.json({ result: "Appointment not found." });
  }

  // Verify the caller owns this appointment (phonesMatch rejects empty numbers).
  if (!phonesMatch((appt as any).customers?.phone_number ?? "", callerPhone)) {
    return NextResponse.json({
      result: "You can only cancel your own appointments.",
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

// ── get_customer_appointments ───────────────────────────────────────────────
async function handleGetAppointments(
  db: ReturnType<typeof createServiceClient>,
  business: { id: string; timezone: string },
  args: Record<string, unknown>,
) {
  const phoneNumber = String(args.phone_number ?? "");

  const { data: customer } = await db
    .from("customers")
    .select("id, name")
    .eq("business_id", business.id)
    .eq("phone_number", phoneNumber)
    .single();

  if (!customer) {
    return NextResponse.json({
      result: "No record found for this phone number.",
    });
  }

  const { data: appointments } = await db
    .from("appointments")
    .select("id, starts_at, status, services(name)")
    .eq("customer_id", customer.id)
    .eq("business_id", business.id)
    .in("status", ["booked", "rescheduled"])
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(3);

  if (!appointments || appointments.length === 0) {
    return NextResponse.json({
      result: `${customer.name ?? "The customer"} has no upcoming appointments.`,
    });
  }

  const list = appointments
    .map(
      (a: {
        id: string;
        starts_at: string;
        services?: { name?: string }[] | { name?: string } | null;
      }) => {
        const time = formatSlotForSpeech(
          { starts_at: a.starts_at, ends_at: a.starts_at },
          business.timezone,
        );
        const svc = Array.isArray(a.services) ? a.services[0] : a.services;
        return `${svc?.name ?? "Appointment"} on ${time} (ID: ${a.id})`;
      },
    )
    .join("; ");

  return NextResponse.json({
    result: `Upcoming appointments for ${customer.name}: ${list}`,
    appointments,
  });
}
