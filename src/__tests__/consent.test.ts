// Tests for consent logic — no external deps needed

describe("WhatsApp consent rules (F2.4a, F2.6a, F3.3, F3.7)", () => {
  // Mirrors the logic in the record_whatsapp_consent handler
  function parseConsent(consent: unknown): "granted" | "declined" {
    const granted =
      consent === true || consent === "yes" || consent === "granted";
    return granted ? "granted" : "declined";
  }

  test('explicit "yes" grants consent', () => {
    expect(parseConsent("yes")).toBe("granted");
  });

  test("boolean true grants consent", () => {
    expect(parseConsent(true)).toBe("granted");
  });

  test('"granted" string grants consent', () => {
    expect(parseConsent("granted")).toBe("granted");
  });

  test('"no" declines consent', () => {
    expect(parseConsent("no")).toBe("declined");
  });

  test("boolean false declines consent", () => {
    expect(parseConsent(false)).toBe("declined");
  });

  test("ambiguous/empty value defaults to declined (F3.3 requirement)", () => {
    expect(parseConsent("")).toBe("declined");
    expect(parseConsent(null)).toBe("declined");
    expect(parseConsent(undefined)).toBe("declined");
    expect(parseConsent("maybe")).toBe("declined");
    expect(parseConsent("I think so")).toBe("declined");
  });

  // Reminder creation logic — mirrors book_appointment handler
  function shouldCreateReminders(
    consentStatus: string,
    senderStatus: string,
  ): boolean {
    return consentStatus === "granted" && senderStatus === "approved";
  }

  test("reminders created only when consent granted AND sender approved (F3.7)", () => {
    expect(shouldCreateReminders("granted", "approved")).toBe(true);
    expect(shouldCreateReminders("declined", "approved")).toBe(false);
    expect(shouldCreateReminders("not_asked", "approved")).toBe(false);
    expect(shouldCreateReminders("granted", "pending_verification")).toBe(
      false,
    );
    expect(shouldCreateReminders("granted", "rejected")).toBe(false);
  });
});

describe("Post-call outcome derivation", () => {
  function deriveOutcome(transcript: string): string {
    const OUTCOME_PRIORITY: Array<[string, string[]]> = [
      [
        "rescheduled",
        ["rescheduled", "moved your appointment", "changed your appointment"],
      ],
      ["cancelled", ["cancelled", "canceled"]],
      ["booked", ["booked", "scheduled", "appointment set", "confirmed"]],
      ["inquiry_only", ["information", "hours", "pricing", "price"]],
    ];
    const lower = transcript.toLowerCase();
    for (const [outcome, keywords] of OUTCOME_PRIORITY) {
      if (keywords.some((kw) => lower.includes(kw))) return outcome;
    }
    return "unresolved";
  }

  test("detects booking confirmation", () => {
    expect(
      deriveOutcome("Your appointment has been booked for Tuesday at 2pm."),
    ).toBe("booked");
    expect(deriveOutcome("Great, I have scheduled you for Friday.")).toBe(
      "booked",
    );
  });

  test("detects rescheduling", () => {
    expect(
      deriveOutcome("I have rescheduled your appointment to next Monday."),
    ).toBe("rescheduled");
  });

  test("detects cancellation", () => {
    expect(
      deriveOutcome("Your appointment has been cancelled successfully."),
    ).toBe("cancelled");
    expect(deriveOutcome("The appointment is canceled.")).toBe("cancelled");
  });

  test("detects inquiry-only calls", () => {
    expect(
      deriveOutcome(
        "We charge $50 for a haircut. Our pricing is listed below.",
      ),
    ).toBe("inquiry_only");
    expect(
      deriveOutcome("Our hours are Monday through Friday 9am to 5pm."),
    ).toBe("inquiry_only");
  });

  test("marks ambiguous calls as unresolved", () => {
    expect(deriveOutcome("Hello, goodbye.")).toBe("unresolved");
    expect(deriveOutcome("")).toBe("unresolved");
  });
});
