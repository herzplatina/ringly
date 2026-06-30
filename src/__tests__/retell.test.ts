// Mock env before importing retell (which imports env)
jest.mock("@/lib/env", () => ({
  env: {
    RETELL_API_KEY: "test",
    RETELL_WEBHOOK_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

import { buildAgentPrompt } from "@/lib/retell";

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
