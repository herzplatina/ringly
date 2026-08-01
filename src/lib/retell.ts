import "server-only";
import { Retell } from "retell-sdk";
import { env } from "./env";
import { DAY_NAMES } from "./utils";
import { createServiceClient } from "@/lib/supabase/server";

const BASE = "https://api.retellai.com";
const API_KEY = () => env.RETELL_API_KEY;

async function retellFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY()}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell API ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function purchasePhoneNumber(areaCode?: string) {
  // Retell API (New) endpoint is /create-phone-number; area_code is an optional
  // integer — omit it to get any available US number.
  const body: { area_code?: number } = {};
  if (areaCode && /^\d{3}$/.test(areaCode)) body.area_code = Number(areaCode);
  return retellFetch("/create-phone-number", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createAgent(llmId: string, businessName: string) {
  return retellFetch("/create-agent", {
    method: "POST",
    body: JSON.stringify({
      agent_name: businessName,
      response_engine: { type: "retell-llm", llm_id: llmId },
      voice_id: "11labs-Dorothy",
      language: "en-US",
      // Agent-level webhook receives call lifecycle events (call_started /
      // call_ended / call_analyzed → transcript). In-call function execution is
      // wired per-tool below, so this must point at the post-call route.
      webhook_url: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/retell/post-call`,
    }),
  });
}

// Every booking action the agent can invoke mid-call. Retell POSTs the parsed
// arguments to `url` (signed with x-retell-signature); the function route
// dispatches on `name`. Names + parameters must match the switch in
// src/app/api/webhooks/retell/functions/route.ts exactly.
function bookingTool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description: string }>,
  required: string[],
) {
  return {
    type: "custom",
    name,
    description,
    url: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/retell/functions`,
    speak_during_execution: true,
    speak_after_execution: true,
    parameters: { type: "object", properties, required },
  };
}

function bookingTools() {
  return [
    bookingTool(
      "check_availability",
      "Find open appointment slots for a service on a given date. Call this before booking so you can offer real times.",
      {
        date: {
          type: "string",
          description: "The date to check, as YYYY-MM-DD.",
        },
        service_id: {
          type: "string",
          description: "The id of the service the customer wants.",
        },
      },
      ["date", "service_id"],
    ),
    bookingTool(
      "record_whatsapp_consent",
      "Record whether the customer agrees to receive WhatsApp confirmations and reminders. Ask for consent before booking.",
      {
        consent: {
          type: "boolean",
          description: "true if the customer agreed, false if they declined.",
        },
      },
      ["consent"],
    ),
    bookingTool(
      "book_appointment",
      "Book a new appointment. Use the exact starts_at value returned by check_availability.",
      {
        customer_name: {
          type: "string",
          description: "The customer's full name.",
        },
        phone_number: {
          type: "string",
          description: "The customer's phone number in E.164 format.",
        },
        service_id: {
          type: "string",
          description: "The id of the service being booked.",
        },
        starts_at: {
          type: "string",
          description: "Appointment start time as an ISO 8601 timestamp.",
        },
      },
      ["customer_name", "phone_number", "service_id", "starts_at"],
    ),
    bookingTool(
      "reschedule_appointment",
      "Move an existing appointment to a new time. The caller may only reschedule their own appointments.",
      {
        appointment_id: {
          type: "string",
          description:
            "The id of the appointment to move (from get_customer_appointments).",
        },
        new_starts_at: {
          type: "string",
          description: "The new start time as an ISO 8601 timestamp.",
        },
      },
      ["appointment_id", "new_starts_at"],
    ),
    bookingTool(
      "cancel_appointment",
      "Cancel an existing appointment. The caller may only cancel their own appointments.",
      {
        appointment_id: {
          type: "string",
          description: "The id of the appointment to cancel.",
        },
      },
      ["appointment_id"],
    ),
    bookingTool(
      "get_customer_appointments",
      "Look up the appointments of the person currently on the call. Use before rescheduling or cancelling to get the appointment_id. Takes no arguments: it always uses the caller's own number, and cannot look up anyone else.",
      {},
      [],
    ),
  ];
}

export async function createRetellLLM(systemPrompt: string) {
  return retellFetch("/create-retell-llm", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-4o",
      general_prompt: systemPrompt,
      general_tools: [
        ...bookingTools(),
        {
          type: "end_call",
          name: "end_call",
          description: "End the call when the conversation is complete.",
        },
      ],
    }),
  });
}

export async function updateAgent(
  agentId: string,
  updates: Record<string, unknown>,
) {
  return retellFetch(`/update-agent/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function updateRetellLLM(llmId: string, systemPrompt: string) {
  return retellFetch(`/update-retell-llm/${llmId}`, {
    method: "PATCH",
    body: JSON.stringify({ general_prompt: systemPrompt }),
  });
}

export async function bindAgentToNumber(
  phoneNumber: string,
  agentId: string,
  agentVersion?: number,
) {
  // Retell deprecated the single inbound_agent_id field (2026-03-31) in favor of
  // a weighted inbound_agents list.
  const agent =
    agentVersion != null
      ? { agent_id: agentId, agent_version: agentVersion, weight: 1 }
      : { agent_id: agentId, weight: 1 };
  return retellFetch(
    `/update-phone-number/${encodeURIComponent(phoneNumber)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        inbound_agents: [agent],
        inbound_webhook_url: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/retell/dynamic-variables`,
      }),
    },
  );
}

export async function listPhoneNumbers(): Promise<
  Array<{ phone_number: string; inbound_agents?: unknown[] | null }>
> {
  return retellFetch("/list-phone-numbers");
}

/**
 * Pick a genuinely orphaned number to reuse before buying a new one. A number
 * qualifies only if it has no inbound agent bound in Retell AND is not already
 * recorded against a business in our DB (`takenNumbers`) — so a live business's
 * number that was merely unbound in Retell is never reassigned. Returns the
 * phone number to reuse, or null if the caller should purchase a fresh one.
 */
export function selectReusableNumber(
  existing: Array<{ phone_number: string; inbound_agents?: unknown[] | null }>,
  takenNumbers: Iterable<string>,
): string | null {
  const taken = new Set(takenNumbers);
  const match = existing.find(
    (n) =>
      (!n.inbound_agents || n.inbound_agents.length === 0) &&
      !taken.has(n.phone_number),
  );
  return match?.phone_number ?? null;
}

export async function getCall(retellCallId: string) {
  return retellFetch(`/get-call/${retellCallId}`);
}

// Delegate to the Retell SDK's official verifier (retell-sdk@5.9.0) so the
// signing scheme stays correct if Retell changes it. Per their docs, the
// x-retell-signature header is verified against the Retell API key (the key
// with the webhook badge) — there is no separate webhook secret.
export function verifyRetellSignature(
  body: string,
  signature: string,
): Promise<boolean> {
  return Retell.verify(body, env.RETELL_API_KEY, signature);
}

// Retell nests call metadata differently per webhook type: custom-function and
// call-event bodies carry it under `call`, the inbound webhook under
// `call_inbound`. Normalize to a flat shape (with a top-level fallback so unit
// tests and any future flat payloads keep working).
export function parseRetellCall(
  payload: {
    call?: { call_id?: string; from_number?: string; to_number?: string };
    call_inbound?: { from_number?: string; to_number?: string };
    call_id?: string;
    from_number?: string;
    to_number?: string;
  } & Record<string, unknown>,
): { callId: string; fromNumber: string; toNumber: string } {
  const { call, call_inbound: inbound } = payload;
  return {
    callId: call?.call_id ?? payload.call_id ?? "",
    fromNumber:
      call?.from_number ?? inbound?.from_number ?? payload.from_number ?? "",
    toNumber: call?.to_number ?? inbound?.to_number ?? payload.to_number ?? "",
  };
}

export function buildAgentPrompt(business: {
  name: string;
  business_type: string;
  timezone: string;
  greeting_script?: string | null;
  services: Array<{
    name: string;
    description?: string | null;
    price_cents?: number | null;
    duration_minutes?: number | null;
  }>;
  hours: Array<{
    day_of_week: number;
    is_closed: boolean;
    hours_ranges: Array<{ open: string; close: string }>;
  }>;
}): string {
  const servicesText = business.services
    .map((s) => {
      const price = s.price_cents
        ? `$${(s.price_cents / 100).toFixed(2)}`
        : "price not listed";
      const duration = s.duration_minutes
        ? `${s.duration_minutes} min`
        : "30 min (default)";
      return `- ${s.name}: ${s.description ?? ""} | ${price} | ${duration}`;
    })
    .join("\n");

  const hoursText = business.hours
    .map((h) => {
      if (h.is_closed) return `${DAY_NAMES[h.day_of_week]}: Closed`;
      const ranges = h.hours_ranges
        .map((r) => `${r.open}–${r.close}`)
        .join(", ");
      return `${DAY_NAMES[h.day_of_week]}: ${ranges}`;
    })
    .join("\n");

  const greeting =
    business.greeting_script ??
    `Thank you for calling ${business.name}! How can I help you today?`;

  return `You are the AI receptionist for ${business.name}, a ${business.business_type.replace("_", " ")}.

Your opening greeting: "${greeting}"

TODAY'S DATE & TIME:
Right now it is {{current_date}}, {{current_time}} (${business.timezone}).
ALWAYS use this as your reference for any date. When the caller says things like
"today", "tomorrow", "next Monday", or "the 6th", compute the actual calendar
date from {{current_date}} — never guess the day of the week or the year. Pass
the resolved date (YYYY-MM-DD) to check_availability and book_appointment.

SERVICES AND PRICING:
${servicesText || "Ask the business owner to add services in their dashboard."}

BUSINESS HOURS (${business.timezone}):
${hoursText}

CAPABILITIES:
- Describe any service, price, and duration
- Check appointment availability and book appointments
- Reschedule or cancel existing appointments for callers who identify by their phone number
- Recognize returning callers and reference their upcoming or past appointments
- Ask new customers for consent to receive WhatsApp confirmation and reminders (REQUIRED before booking)

CONSENT SCRIPT (use exactly for new customers or those with no consent on file):
"Would it be okay for ${business.name} to text you on WhatsApp to confirm this appointment and send you reminders?"
Record the answer immediately by calling record_whatsapp_consent before finalizing the booking.
An unclear or ambiguous answer must be treated as DECLINED — never assume consent.
Do NOT ask again if consent is already on file in either direction.

APPOINTMENT DURATION:
Each service has a duration listed above. If a service's duration is not listed,
it is 30 minutes by default. Always tell the caller how long the appointment
will take before booking.

BOOKING FLOW:
1. Ask for preferred service
2. Ask for preferred date/time (resolve it against today's date above)
3. Call check_availability
4. State the appointment duration (default 30 minutes if not listed)
5. Collect customer name and phone number
6. If new customer or consent not on file: ask WhatsApp consent question, call record_whatsapp_consent
7. Call book_appointment
8. Confirm booking details verbally, including the date, time, and duration

RULES:
- Only discuss topics related to ${business.name} and its services
- Never discuss competitors, medical advice, or personal matters unrelated to booking
- If you cannot resolve a request, offer to take a message or suggest the customer call back during business hours
- Always be warm, professional, and concise`;
}

export async function syncRetellPrompt(businessId: string): Promise<void> {
  const db = createServiceClient();
  const { data } = await db
    .from("businesses")
    .select(
      "retell_llm_id, name, business_type, timezone, greeting_script, services(*), business_hours(*)",
    )
    .eq("id", businessId)
    .single();
  if (!data?.retell_llm_id) return;
  const prompt = buildAgentPrompt({
    name: data.name,
    business_type: data.business_type,
    timezone: data.timezone,
    greeting_script: data.greeting_script,
    services: (data.services ?? []).filter(
      (s: { active: boolean }) => s.active,
    ),
    hours: data.business_hours ?? [],
  });
  try {
    await updateRetellLLM(data.retell_llm_id, prompt);
  } catch (err) {
    console.error("Prompt sync failed:", err);
  }
}
