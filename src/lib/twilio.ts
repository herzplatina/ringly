import "server-only";
import twilio from "twilio";
import { env } from "./env";

let _client: ReturnType<typeof twilio> | null = null;
function client() {
  if (!_client) _client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return _client;
}

const TEMPLATES = {
  confirmation: process.env.TWILIO_TEMPLATE_CONFIRMATION ?? "HX_confirmation",
  reminder_24h: process.env.TWILIO_TEMPLATE_REMINDER_24H ?? "HX_reminder_24h",
  reminder_4h: process.env.TWILIO_TEMPLATE_REMINDER_4H ?? "HX_reminder_4h",
};

export async function sendWhatsApp(
  fromNumber: string,
  toNumber: string,
  kind: "confirmation" | "reminder_24h" | "reminder_4h",
  variables: Record<string, string>,
) {
  const templateSid = TEMPLATES[kind];
  await client().messages.create({
    from: `whatsapp:${fromNumber}`,
    to: `whatsapp:${toNumber}`,
    contentSid: templateSid,
    contentVariables: JSON.stringify(variables),
  });
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
}
