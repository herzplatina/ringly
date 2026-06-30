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
  return retellFetch("/buy-phone-number", {
    method: "POST",
    body: JSON.stringify({ area_code: areaCode }),
  });
}

export async function createAgent(llmId: string, businessName: string) {
  return retellFetch("/create-agent", {
    method: "POST",
    body: JSON.stringify({
      agent_name: businessName,
      response_engine: { type: "retell-llm", llm_id: llmId },
      voice_id: "eleven_turbo_v2",
      language: "en-US",
      webhook_url: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/retell/functions`,
    }),
  });
}

export async function createRetellLLM(systemPrompt: string) {
  return retellFetch("/create-retell-llm", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-4o",
      general_prompt: systemPrompt,
      general_tools: [
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

export async function bindAgentToNumber(phoneNumber: string, agentId: string) {
  return retellFetch(
    `/update-phone-number/${encodeURIComponent(phoneNumber)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        inbound_agent_id: agentId,
        inbound_webhook_url: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/retell/dynamic-variables`,
      }),
    },
  );
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
        : "duration not listed";
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

BOOKING FLOW:
1. Ask for preferred service
2. Ask for preferred date/time
3. Call check_availability
4. Collect customer name and phone number
5. If new customer or consent not on file: ask WhatsApp consent question, call record_whatsapp_consent
6. Call book_appointment
7. Confirm booking details verbally

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
