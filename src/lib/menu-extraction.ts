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
