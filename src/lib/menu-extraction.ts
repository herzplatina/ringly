import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic)
    _anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _anthropic;
}

export type ExtractedService = {
  name: string;
  description: string;
  price_cents: number | null;
  duration_minutes: number | null;
};

const HAIKU = "claude-haiku-4-5-20251001";
const MENU_CAP = 5;

/** Keep at most `max` services (v1 caps auto-extracted menus at 5). */
export function capServices(
  services: ExtractedService[],
  max = MENU_CAP,
): ExtractedService[] {
  return services.slice(0, max);
}

/** Strip tags/scripts from HTML and collapse whitespace to plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch a website's visible text under a bounded timeout; "" on any failure. */
export async function fetchWebsiteText(
  url: string,
  timeoutMs = 5000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "RinglyBot/1.0" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return htmlToText(html).slice(0, 8000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Extract up to 5 services from plain text (menu/site copy) using Claude Haiku. */
export async function extractServicesFromText(
  text: string,
): Promise<ExtractedService[]> {
  if (!text.trim()) return [];
  const response = await getAnthropic().messages.create({
    model: HAIKU,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `From the following business website/menu text, extract up to ${MENU_CAP} services or menu items. Return a JSON array only, no other text. Each item: {"name":string,"description":string,"price_cents":number|null,"duration_minutes":number|null}. If nothing looks like a service, return [].\n\nTEXT:\n${text}`,
      },
    ],
  });
  return capServices(parseServicesFromResponse(response));
}

/** Fetch a business website and extract up to 5 services; [] on timeout/failure. */
export async function extractServicesFromUrl(
  url: string,
): Promise<ExtractedService[]> {
  const text = await fetchWebsiteText(url);
  if (!text) return [];
  return extractServicesFromText(text);
}

function parseServicesFromResponse(response: {
  content: Anthropic.Messages.ContentBlock[];
}): ExtractedService[] {
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as ExtractedService[];
  } catch {
    return [];
  }
}

export async function extractServicesFromImage(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif",
): Promise<ExtractedService[]> {
  const response = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data },
          },
          {
            type: "text",
            text: `Extract all services from this business menu image. Return a JSON array only, no other text.
Each item must have:
- name: string (service name)
- description: string (brief description, empty string if none)
- price_cents: number or null (price in cents, e.g. $25.00 = 2500, null if not shown)
- duration_minutes: number or null (duration in minutes, null if not shown)

Example: [{"name":"Women's Haircut","description":"Cut and style","price_cents":4500,"duration_minutes":60}]`,
          },
        ],
      },
    ],
  });

  return parseServicesFromResponse(response);
}

export async function extractServicesFromPdf(
  base64Data: string,
): Promise<ExtractedService[]> {
  const response = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Data,
            },
          },
          {
            type: "text",
            text: `Extract all services from this business menu PDF. Return a JSON array only, no other text.
Each item must have:
- name: string
- description: string (empty string if none)
- price_cents: number or null
- duration_minutes: number or null`,
          },
        ],
      },
    ],
  });

  return parseServicesFromResponse(response);
}
