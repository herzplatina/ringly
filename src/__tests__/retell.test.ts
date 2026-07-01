// Mock env before importing retell (which imports env)
jest.mock("@/lib/env", () => ({
  env: {
    RETELL_API_KEY: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

import crypto from "crypto";
import {
  buildAgentPrompt,
  verifyRetellSignature,
  parseRetellCall,
} from "@/lib/retell";

// Build a signature the way Retell does: HMAC-SHA256(body + timestamp, apiKey),
// header format "v={timestampMs},d={hexDigest}".
function sign(body: string, timestampMs: number, apiKey = "test"): string {
  const digest = crypto
    .createHmac("sha256", apiKey)
    .update(body + String(timestampMs))
    .digest("hex");
  return `v=${timestampMs},d=${digest}`;
}

const BASE_BIZ = {
  name: "Glamour Studio",
  business_type: "salon",
  timezone: "America/New_York",
  greeting_script: null as string | null,
  services: [
    {
      name: "Women's Haircut",
      description: "Cut and style",
      price_cents: 4500,
      duration_minutes: 60,
    },
    {
      name: "Blowout",
      description: null,
      price_cents: null,
      duration_minutes: 30,
    },
  ],
  hours: [
    {
      day_of_week: 1,
      is_closed: false,
      hours_ranges: [{ open: "09:00", close: "17:00" }],
    },
    { day_of_week: 0, is_closed: true, hours_ranges: [] },
  ],
};

describe("buildAgentPrompt", () => {
  test("includes business name", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain("Glamour Studio");
  });

  test("includes service names and prices", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain("Women's Haircut");
    expect(prompt).toContain("$45.00");
    expect(prompt).toContain("60 min");
  });

  test("shows price not listed when price_cents is null", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain("price not listed");
  });

  test("includes hours", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain("Monday");
    expect(prompt).toContain("09:00–17:00");
    expect(prompt).toContain("Sunday: Closed");
  });

  test("uses custom greeting when provided", () => {
    const prompt = buildAgentPrompt({
      ...BASE_BIZ,
      greeting_script: "Welcome to our salon!",
    });
    expect(prompt).toContain("Welcome to our salon!");
  });

  test("uses default greeting when greeting_script is null", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain("Thank you for calling Glamour Studio");
  });

  test("includes WhatsApp consent script with business name", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain(
      "Would it be okay for Glamour Studio to text you on WhatsApp",
    );
  });

  test("consent defaults to declined on ambiguity", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain("treated as DECLINED");
  });

  test("instructs not to re-ask consent if already on file", () => {
    const prompt = buildAgentPrompt(BASE_BIZ);
    expect(prompt).toContain("Do NOT ask again if consent is already on file");
  });
});

describe("verifyRetellSignature", () => {
  const body = '{"event":"call_ended","call_id":"abc"}';

  test("accepts a correctly signed, fresh payload", async () => {
    const now = Date.now();
    await expect(verifyRetellSignature(body, sign(body, now))).resolves.toBe(
      true,
    );
  });

  test("rejects when the body has been tampered with", async () => {
    const now = Date.now();
    const sig = sign(body, now);
    await expect(verifyRetellSignature(body + "tampered", sig)).resolves.toBe(
      false,
    );
  });

  test("rejects a signature made with the wrong key", async () => {
    const now = Date.now();
    await expect(
      verifyRetellSignature(body, sign(body, now, "wrong-key")),
    ).resolves.toBe(false);
  });

  test("rejects a stale timestamp (replay) beyond the 5-minute window", async () => {
    const stale = Date.now() - 6 * 60 * 1000;
    await expect(verifyRetellSignature(body, sign(body, stale))).resolves.toBe(
      false,
    );
  });

  test("rejects a malformed signature header", async () => {
    await expect(
      verifyRetellSignature(body, "not-a-valid-header"),
    ).resolves.toBe(false);
    await expect(verifyRetellSignature(body, "")).resolves.toBe(false);
  });
});

describe("parseRetellCall", () => {
  test("reads a custom-function / call-event payload (nested under call)", () => {
    expect(
      parseRetellCall({
        name: "book_appointment",
        call: {
          call_id: "call_123",
          from_number: "+14155550001",
          to_number: "+14155550002",
        },
        args: {},
      }),
    ).toEqual({
      callId: "call_123",
      fromNumber: "+14155550001",
      toNumber: "+14155550002",
    });
  });

  test("reads an inbound-webhook payload (nested under call_inbound)", () => {
    expect(
      parseRetellCall({
        event: "call_inbound",
        call_inbound: {
          from_number: "+14155550001",
          to_number: "+14155550002",
        },
      }),
    ).toEqual({
      callId: "",
      fromNumber: "+14155550001",
      toNumber: "+14155550002",
    });
  });

  test("falls back to top-level fields and empty strings", () => {
    expect(
      parseRetellCall({
        call_id: "flat",
        from_number: "+1",
        to_number: "+2",
      }),
    ).toEqual({ callId: "flat", fromNumber: "+1", toNumber: "+2" });
    expect(parseRetellCall({})).toEqual({
      callId: "",
      fromNumber: "",
      toNumber: "",
    });
  });
});
