import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature, parseRetellCall } from "@/lib/retell";
import {
  computeAvailableSlots,
  formatSlotForSpeech,
  hasConflict,
  isWithinBusinessHours,
  findAlternatives,
} from "@/lib/availability";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarBusySlots,
} from "@/lib/google-calendar";
import { sendWhatsApp } from "@/lib/twilio";
import { addHours } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { format as fmtDate } from "date-fns";
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

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse an ISO timestamp string.  Returns `null` when the string is missing,
 * empty, or results in an invalid Date.
 */
function safeParse(iso: string): Date | null {
  if (!iso || !iso.trim()) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Extract the local YYYY-MM-DD date for a UTC instant in a given timezone.
 */
function localDateStr(utcDate: Date, timezone: string): string {
  const local = toZonedTime(utcDate, timezone);
  return fmtDate(local, "yyyy-MM-dd");
}

/**
 * Format a UTC instant as a friendly wall-clock string in the business timezone.
 */
function formatWallClock(iso: string, timezone: string): string {
  return formatSlotForSpeech({ starts_at: iso, ends_at: iso }, timezone);
}

/**
 * Gather all busy intervals for a date window from both the appointments
 * table and Google Calendar.  Calendar failures are silently swallowed
 * (returns DB rows only) so bookings are never blocked by an outage.
 */
async function gatherBusyIntervals(
  db: ReturnType<typeof createServiceClient>,
  businessId: string,
  timezone: string,
  dateOnly: string,
  opts?: {
    excludeAppointmentId?: string;
    excludeCalendarEventIds?: string[];
  },
): Promise<Array<{ starts_at: string; ends_at: string }>> {
  const dayStart = fromZonedTime(
    `${dateOnly}T00:00:00`,
    timezone,
  ).toISOString();
  const dayEnd = fromZonedTime(
    `${dateOnly}T23:59:59`,
    timezone,
  ).toISOString();

  // DB appointments
  let query = db
    .from("appointments")
    .select("id, starts_at, ends_at")
    .eq("business_id", businessId)
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .in("status", ["booked", "rescheduled"]);

  const { data: rawAppts } = await query;
  let dbAppts: Array<{ starts_at: string; ends_at: string }> = (
    rawAppts ?? []
  ).filter(
    (a: { id: string }) => a.id !== opts?.excludeAppointmentId,
  );

  // Google Calendar events (best-effort)
  const calSlots = await fetchCalendarBusySlots(
    businessId,
    dayStart,
    dayEnd,
    timezone,
    opts?.excludeCalendarEventIds,
  );

  return [...dbAppts, ...calSlots];
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

  // Gather ALL busy intervals (DB + Google Calendar)
  const dateOnly = date.slice(0, 10);
  const busy = await gatherBusyIntervals(
    db,
    business.id,
    business.timezone,
    dateOnly,
  );

  const slots = computeAvailableSlots(
    date,
    duration,
    business.timezone,
    hours ?? [],
    busy,
  );

  // Also filter out past slots
  const now = new Date();
  const futureSlots = slots.filter(
    (s) => new Date(s.starts_at).getTime() > now.getTime(),
  );

  if (futureSlots.length === 0) {
    return NextResponse.json({
      result: `No availability on ${date}. Please suggest another date.`,
    });
  }

  const slotList = futureSlots
    .slice(0, 5)
    .map((s) => formatSlotForSpeech(s, business.timezone))
    .join(", ");

  return NextResponse.json({
    result: `Available times on ${date}: ${slotList}`,
    slots: futureSlots.slice(0, 5),
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
  const startsAtRaw = String(args.starts_at ?? "");

  // ── 1. Parse start time ───────────────────────────────────────────────
  const startsAtDate = safeParse(startsAtRaw);
  if (!startsAtDate) {
    return NextResponse.json({
      result:
        "Sorry, the requested time could not be understood. Please provide a valid date and time.",
      conflict: true,
      alternatives: [],
    });
  }

  // ── 2. Resolve service & duration ─────────────────────────────────────
  const { data: service } = await db
    .from("services")
    .select("id, name, duration_minutes")
    .eq("id", serviceId)
    .eq("business_id", business.id)
    .single();

  const duration = service?.duration_minutes ?? 30;
  const endsAtDate = new Date(
    startsAtDate.getTime() + duration * 60 * 1000,
  );
  const startsAt = startsAtDate.toISOString();
  const endsAt = endsAtDate.toISOString();

  // ── 3. Determine local date for business-hour / conflict lookups ──────
  const dateOnly = localDateStr(startsAtDate, business.timezone);

  // ── 4. Fetch business hours ───────────────────────────────────────────
  const { data: hours } = await db
    .from("business_hours")
    .select("*")
    .eq("business_id", business.id);

  // ── 5. Gather busy intervals (DB + calendar) ─────────────────────────
  const busy = await gatherBusyIntervals(
    db,
    business.id,
    business.timezone,
    dateOnly,
  );

  // ── 6. Check conflicts ────────────────────────────────────────────────
  const outsideHours = !isWithinBusinessHours(
    startsAtDate,
    endsAtDate,
    hours ?? [],
    business.timezone,
    dateOnly,
  );

  const conflict = outsideHours || hasConflict(startsAtDate, endsAtDate, busy);

  if (conflict) {
    // Compute alternatives from the same day
    const allSlots = computeAvailableSlots(
      dateOnly,
      duration,
      business.timezone,
      hours ?? [],
      busy,
    );
    const alts = findAlternatives(startsAtDate, allSlots);

    if (alts.length === 0) {
      return NextResponse.json({
        result:
          "That time is already taken and there is no remaining availability today. Could you pick a different date?",
        conflict: true,
        alternatives: [],
      });
    }

    const altList = alts
      .map((s) => formatSlotForSpeech(s, business.timezone))
      .join(", ");

    return NextResponse.json({
      result: `That time is already taken. How about one of these: ${altList}?`,
      conflict: true,
      alternatives: alts.map((s) => ({
        starts_at: s.starts_at,
        ends_at: s.ends_at,
      })),
    });
  }

  // ── 7. Upsert customer ───────────────────────────────────────────────
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

  // ── 8. Insert appointment ─────────────────────────────────────────────
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

  // ── 9. Insert reminder rows synchronously ─────────────────────────────
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

  // ── 10. Fire-and-forget: external API calls ───────────────────────────
  void syncAfterBooking(db, business, appointment.id, {
    customerName,
    phoneNumber,
    serviceName: service?.name ?? "Appointment",
    startsAt,
    endsAt,
    consentStatus: customer.whatsapp_consent_status,
  });

  const spokenTime = formatWallClock(startsAt, business.timezone);

  return NextResponse.json({
    result: `Appointment booked for ${customerName} on ${spokenTime}.`,
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
  const newStartsAtRaw = String(args.new_starts_at ?? "");

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

  // ── 1. Parse the new start time ───────────────────────────────────────
  const newStartsAtDate = safeParse(newStartsAtRaw);
  if (!newStartsAtDate) {
    return NextResponse.json({
      result:
        "Sorry, the requested time could not be understood. Please provide a valid date and time.",
      conflict: true,
      alternatives: [],
    });
  }

  const duration = (appt as any).services?.duration_minutes ?? 30;
  const newEndsAtDate = new Date(
    newStartsAtDate.getTime() + duration * 60 * 1000,
  );
  const newStartsAt = newStartsAtDate.toISOString();
  const newEndsAt = newEndsAtDate.toISOString();

  // ── 2. Determine local date ───────────────────────────────────────────
  const dateOnly = localDateStr(newStartsAtDate, business.timezone);

  // ── 3. Fetch business hours ───────────────────────────────────────────
  const { data: hours } = await db
    .from("business_hours")
    .select("*")
    .eq("business_id", business.id);

  // ── 4. Gather busy intervals, excluding the appointment being moved ──
  const excludeCalEventIds = appt.google_calendar_event_id
    ? [appt.google_calendar_event_id]
    : [];

  const busy = await gatherBusyIntervals(
    db,
    business.id,
    business.timezone,
    dateOnly,
    {
      excludeAppointmentId: appointmentId,
      excludeCalendarEventIds: excludeCalEventIds,
    },
  );

  // ── 5. Check conflicts ────────────────────────────────────────────────
  const outsideHours = !isWithinBusinessHours(
    newStartsAtDate,
    newEndsAtDate,
    hours ?? [],
    business.timezone,
    dateOnly,
  );

  const conflict =
    outsideHours || hasConflict(newStartsAtDate, newEndsAtDate, busy);

  if (conflict) {
    const allSlots = computeAvailableSlots(
      dateOnly,
      duration,
      business.timezone,
      hours ?? [],
      busy,
    );
    const alts = findAlternatives(newStartsAtDate, allSlots);

    if (alts.length === 0) {
      return NextResponse.json({
        result:
          "That time is already taken and there is no remaining availability today. Could you pick a different date?",
        conflict: true,
        alternatives: [],
      });
    }

    const altList = alts
      .map((s) => formatSlotForSpeech(s, business.timezone))
      .join(", ");

    return NextResponse.json({
      result: `That time is already taken. How about one of these: ${altList}?`,
      conflict: true,
      alternatives: alts.map((s) => ({
        starts_at: s.starts_at,
        ends_at: s.ends_at,
      })),
    });
  }

  // ── 6. Write the reschedule ───────────────────────────────────────────
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

  const spokenTime = formatWallClock(newStartsAt, business.timezone);

  return NextResponse.json({
    result: `Appointment rescheduled to ${spokenTime}.`,
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
