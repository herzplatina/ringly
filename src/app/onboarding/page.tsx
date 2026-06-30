"use client";
export const dynamic = "force-dynamic";
import { Suspense } from "react";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, DAY_NAMES } from "@/lib/utils";
import type { Service } from "@/types";

const STEPS = [
  "Business Profile",
  "Phone Number",
  "Menu Upload",
  "Business Hours",
  "Google Calendar",
  "WhatsApp",
  "Go Live",
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];
const BIZ_TYPES = [
  { value: "salon", label: "Salon / Spa" },
  { value: "clinic", label: "Medical / Dental Clinic" },
  { value: "tax_office", label: "Tax Office" },
  { value: "other", label: "Other" },
];

type HoursDay = {
  day_of_week: number;
  is_closed: boolean;
  hours_ranges: { open: string; close: string }[];
};

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full transition-colors",
              i < current
                ? "bg-indigo-600"
                : i === current
                  ? "bg-indigo-400"
                  : "bg-gray-200",
            )}
          />
          {i < total - 1 && <div className="h-px w-6 bg-gray-200" />}
        </div>
      ))}
      <span className="ml-2 text-sm text-gray-500">
        Step {current + 1} of {total}
      </span>
    </div>
  );
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [step, setStep] = useState(Number(searchParams.get("step") ?? 1) - 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — Business Profile
  const [bizName, setBizName] = useState("");
  const [bizType, setBizType] = useState("salon");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");

  // Step 2 — Phone Number
  const [areaCode, setAreaCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  // Step 3 — Menu
  const [menuFile, setMenuFile] = useState<File | null>(null);
  const [services, setServices] = useState<Partial<Service>[]>([]);
  const [extracting, setExtracting] = useState(false);

  // Step 4 — Hours
  const [hours, setHours] = useState<HoursDay[]>(
    Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      is_closed: i === 0 || i === 6,
      hours_ranges: [{ open: "09:00", close: "17:00" }],
    })),
  );

  // Step 6 — WhatsApp
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [bizExists, setBizExists] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      fetch("/api/business").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/hours").then((r) => r.json()),
    ]).then(([bizResult, svcResult, hrsResult]) => {
      if (bizResult.status === "fulfilled") {
        const biz = bizResult.value;
        if (biz) {
          setBizExists(true);
          if (biz.name) setBizName(biz.name);
          if (biz.business_type) setBizType(biz.business_type);
          if (biz.address) setAddress(biz.address);
          if (biz.timezone) setTimezone(biz.timezone);
          if (biz.retell_phone_number) setPhoneNumber(biz.retell_phone_number);
          if (biz.whatsapp_number) setWhatsappNumber(biz.whatsapp_number);
          if (biz.onboarding_step > 1) setStep(biz.onboarding_step - 1);
        }
      }
      if (svcResult.status === "fulfilled") {
        const s = svcResult.value;
        if (Array.isArray(s) && s.length) setServices(s);
      }
      if (hrsResult.status === "fulfilled") {
        const h = hrsResult.value;
        if (Array.isArray(h) && h.length === 7) setHours(h);
      }
    });
  }, []);

  async function handleStep1() {
    setLoading(true);
    setError("");
    try {
      const method = bizExists ? "PATCH" : "POST";
      const res = await fetch("/api/business", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bizName,
          business_type: bizType,
          address,
          timezone,
          onboarding_step: 2,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStep(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error saving profile");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/business/phone-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCode: areaCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to provision number");
      setPhoneNumber(data.phone_number);
      setStep(2);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error provisioning number");
    } finally {
      setLoading(false);
    }
  }

  async function handleExtract() {
    if (!menuFile) return;
    setExtracting(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", menuFile);
      const res = await fetch("/api/menu-extract", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.services?.length)
        setServices(
          data.services.map((s: Partial<Service>) => ({
            ...s,
            active: true,
            source: "extracted" as const,
          })),
        );
    } catch {
      setError("Extraction failed. You can add services manually.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleStep3() {
    setLoading(true);
    setError("");
    try {
      if (services.length) {
        const res = await fetch("/api/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(services),
        });
        if (!res.ok) throw new Error("Failed to save services");
      }
      await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_step: 4 }),
      });
      setStep(3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error saving services");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep4() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hours),
      });
      if (!res.ok) throw new Error("Failed to save hours");
      setStep(4);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error saving hours");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep6() {
    if (!whatsappNumber.trim()) {
      // Skip — persist the step advance so a page reload doesn't loop back
      await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_step: 7 }),
      });
      setStep(6);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/business/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappNumber }),
      });
      if (!res.ok) throw new Error("Failed to register WhatsApp");
      setStep(6);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error registering WhatsApp");
    } finally {
      setLoading(false);
    }
  }

  function updateHours(
    day: number,
    field: "is_closed" | "open" | "close",
    value: string | boolean,
  ) {
    setHours((prev) =>
      prev.map((h) => {
        if (h.day_of_week !== day) return h;
        if (field === "is_closed") return { ...h, is_closed: value as boolean };
        const ranges = [...h.hours_ranges];
        if (!ranges[0]) ranges[0] = { open: "09:00", close: "17:00" };
        if (field === "open")
          ranges[0] = { ...ranges[0], open: value as string };
        if (field === "close")
          ranges[0] = { ...ranges[0], close: value as string };
        return { ...h, hours_ranges: ranges };
      }),
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-indigo-600">Ringly</h1>
          <p className="text-gray-500 mt-1">{STEPS[step]}</p>
        </div>
        <StepIndicator current={step} total={STEPS.length} />

        <div className="bg-white rounded-2xl shadow p-8">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Step 1 — Business Profile */}
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold text-gray-900">
                Tell us about your business
              </h2>
              <Input
                id="bizName"
                label="Business name"
                required
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                placeholder="Glamour Studio"
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Business type
                </label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={bizType}
                  onChange={(e) => setBizType(e.target.value)}
                >
                  {BIZ_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                id="address"
                label="Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, City, ST 12345"
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Time zone
                </label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={handleStep1}
                loading={loading}
                disabled={!bizName}
                className="w-full"
                size="lg"
              >
                Continue
              </Button>
            </div>
          )}

          {/* Step 2 — Phone Number */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">
                Claim your AI receptionist number
              </h2>
              <p className="text-gray-500 text-sm">
                We&apos;ll provision a US phone number for your business.
                Callers will dial this number to reach your AI receptionist.
              </p>
              {phoneNumber ? (
                <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-4 text-center">
                  <p className="text-sm text-gray-500 mb-1">Your number</p>
                  <p className="text-2xl font-bold text-indigo-700">
                    {phoneNumber}
                  </p>
                </div>
              ) : (
                <Input
                  id="areaCode"
                  label="Preferred area code (optional)"
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value)}
                  placeholder="415"
                  maxLength={3}
                />
              )}
              <Button
                onClick={phoneNumber ? () => setStep(2) : handleStep2}
                loading={loading}
                className="w-full"
                size="lg"
              >
                {phoneNumber ? "Continue" : "Get my number"}
              </Button>
            </div>
          )}

          {/* Step 3 — Menu Upload */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">
                Upload your service menu
              </h2>
              <p className="text-gray-500 text-sm">
                Upload a photo or PDF of your menu. We&apos;ll extract the
                services automatically — you can edit them before saving.
              </p>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setMenuFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                  id="menuFile"
                />
                <label
                  htmlFor="menuFile"
                  className="cursor-pointer text-indigo-600 hover:underline text-sm font-medium"
                >
                  {menuFile ? menuFile.name : "Click to upload image or PDF"}
                </label>
              </div>
              {menuFile && (
                <Button
                  onClick={handleExtract}
                  loading={extracting}
                  variant="secondary"
                  className="w-full"
                >
                  Extract services from file
                </Button>
              )}
              {services.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">
                    Review and edit services
                  </p>
                  {services.map((s, i) => (
                    <div
                      key={i}
                      className="border border-gray-200 rounded-lg p-3 space-y-2"
                    >
                      <Input
                        label="Service name"
                        value={s.name ?? ""}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          label="Price (cents)"
                          type="number"
                          value={s.price_cents ?? ""}
                          onChange={(e) =>
                            setServices((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      price_cents: Number(e.target.value),
                                    }
                                  : x,
                              ),
                            )
                          }
                          placeholder="2500 = $25.00"
                        />
                        <Input
                          label="Duration (min)"
                          type="number"
                          value={s.duration_minutes ?? ""}
                          onChange={(e) =>
                            setServices((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      duration_minutes: Number(e.target.value),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setServices((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setServices((prev) => [
                        ...prev,
                        { name: "", active: true, source: "manual" },
                      ])
                    }
                  >
                    + Add service
                  </Button>
                </div>
              )}
              {services.length === 0 && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setServices([{ name: "", active: true, source: "manual" }])
                  }
                >
                  + Add service manually
                </Button>
              )}
              <div className="flex gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  onClick={handleStep3}
                  loading={loading}
                  className="flex-1"
                  size="lg"
                >
                  Save & continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 4 — Business Hours */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Set your business hours</h2>
              <p className="text-gray-500 text-sm">
                Your AI receptionist will only offer appointment times during
                these hours.
              </p>
              <div className="space-y-3">
                {hours.map((h) => (
                  <div key={h.day_of_week} className="flex items-center gap-3">
                    <span className="w-24 text-sm font-medium text-gray-700">
                      {DAY_NAMES[h.day_of_week]}
                    </span>
                    <label className="flex items-center gap-1.5 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={!h.is_closed}
                        onChange={(e) =>
                          updateHours(
                            h.day_of_week,
                            "is_closed",
                            !e.target.checked,
                          )
                        }
                      />
                      Open
                    </label>
                    {!h.is_closed && (
                      <>
                        <input
                          type="time"
                          value={h.hours_ranges[0]?.open ?? "09:00"}
                          onChange={(e) =>
                            updateHours(h.day_of_week, "open", e.target.value)
                          }
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                        <span className="text-gray-400 text-sm">to</span>
                        <input
                          type="time"
                          value={h.hours_ranges[0]?.close ?? "17:00"}
                          onChange={(e) =>
                            updateHours(h.day_of_week, "close", e.target.value)
                          }
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </>
                    )}
                    {h.is_closed && (
                      <span className="text-sm text-gray-400 italic">
                        Closed
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  onClick={handleStep4}
                  loading={loading}
                  className="flex-1"
                  size="lg"
                >
                  Save & continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 5 — Google Calendar */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Connect Google Calendar</h2>
              <p className="text-gray-500 text-sm">
                Every booking your AI receptionist makes will automatically
                appear on your Google Calendar.
              </p>
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-700">
                You&apos;ll be redirected to Google to authorise access to your
                calendar. We only request permission to create, update, and
                delete events.
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Back
                </Button>
                <a href="/api/auth/google/start" className="flex-1">
                  <Button className="w-full" size="lg">
                    Connect Google Calendar
                  </Button>
                </a>
              </div>
              <button
                onClick={() => setStep(5)}
                className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-2"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* Step 6 — WhatsApp */}
          {step === 5 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">
                Set up WhatsApp messaging
              </h2>
              <p className="text-gray-500 text-sm">
                Your customers will receive appointment confirmations and
                reminders on WhatsApp from your own business number.
              </p>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                <strong>Note:</strong> WhatsApp sender approval runs in the
                background and may take 1–3 business days. Voice calls and
                bookings work immediately — messaging activates once Meta
                approves your number.
              </div>
              <Input
                id="whatsappNumber"
                label="Your WhatsApp Business number (E.164 format)"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="+14155551234"
              />
              <div className="flex gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(4)}>
                  Back
                </Button>
                <Button
                  onClick={handleStep6}
                  loading={loading}
                  className="flex-1"
                  size="lg"
                >
                  {whatsappNumber ? "Register & continue" : "Skip for now"}
                </Button>
              </div>
            </div>
          )}

          {/* Step 7 — Go Live */}
          {step === 6 && (
            <div className="space-y-5 text-center">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mx-auto">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">
                Your AI receptionist is live!
              </h2>
              <p className="text-gray-500 text-sm">
                Call your number now to test it out. The AI knows your services,
                hours, and can book appointments.
              </p>
              {phoneNumber && (
                <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-4">
                  <p className="text-sm text-gray-500 mb-1">
                    Your AI receptionist number
                  </p>
                  <p className="text-3xl font-bold text-indigo-700">
                    {phoneNumber}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Call this number to place a test call
                  </p>
                </div>
              )}
              <Button
                onClick={() => router.push("/dashboard")}
                className="w-full"
                size="lg"
              >
                Go to dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
