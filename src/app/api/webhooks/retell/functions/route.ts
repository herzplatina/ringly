import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRetellSignature } from "@/lib/retell";
import { computeAvailableSlots, formatSlotForSpeech } from "@/lib/availability";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";
import { sendWhatsApp } from "@/lib/twilio";
import { addHours } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { normalizePhone } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-retell-signature") ?? "";

  if (!verifyRetellSignature(body, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const functionName: string = payload.function_name ?? payload.name ?? "";
  const args: Record<string, unknown> = payload.arguments ?? payload.args ?? {};
  const callId: string = payload.call_id ?? "";
  const toNumber: string = payload.to_number ?? "";
  const fromNumber: string = payload.from_number ?? "";

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

  const duration = service?.duration_minutes ?? 60;

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

  const duration = service?.duration_minutes ?? 60;
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

  // Verify the caller owns this appointment (normalize before comparing — Retell
  // delivers E.164 with "+", but stored numbers may lack the prefix)
  if (
    normalizePhone((appt as any).customers?.phone_number ?? "") !==
    normalizePhone(callerPhone)
  ) {
    return NextResponse.json({
      result: "You can only reschedule your own appointments.",
    });
  }

  const duration = (appt as any).services?.duration_minutes ?? 60;
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

  // Verify the caller owns this appointment (normalize before comparing)
  if (
    normalizePhone((appt as any).customers?.phone_number ?? "") !==
    normalizePhone(callerPhone)
  ) {
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
