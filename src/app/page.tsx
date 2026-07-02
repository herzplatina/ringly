"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DAY_NAMES } from "@/lib/utils";
import { saveDraft } from "@/lib/draft";

const SPOKEN_PROMPT =
  "Hey there! Why don't you tell me the name and rough address of your business to set up your AI receptionist?";
const PLACEHOLDER = "e.g. Glamour Studio, 123 Main St, Austin";

type Service = {
  name: string;
  description: string;
  price_cents: number | null;
  duration_minutes: number | null;
};
type HoursRow = {
  day_of_week: number;
  is_closed: boolean;
  hours_ranges: { open: string; close: string }[];
};
type EnrichedBusiness = {
  google_place_id: string;
  name: string;
  formatted_address: string;
  public_phone: string;
  website_url: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
};
type Candidate = { place_id: string; name: string; address: string };

export default function IntakePage() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [speakerOn, setSpeakerOn] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [business, setBusiness] = useState<EnrichedBusiness | null>(null);
  const [hours, setHours] = useState<HoursRow[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const spokenRef = useRef(false);

  // Voice output: greet the visitor in a lively female voice. Voices load
  // async (getVoices() is often empty at first → wait for voiceschanged), and
  // browsers block speech until the first user gesture → also retry on interaction.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;

    // Prefer a known lively female English voice; fall back sensibly.
    function pickVoice(voices: SpeechSynthesisVoice[]) {
      const preferred = [
        "Google US English",
        "Samantha",
        "Ava",
        "Allison",
        "Susan",
        "Karen",
        "Victoria",
        "Google UK English Female",
        "Microsoft Zira",
      ];
      const byName = preferred
        .map((n) => voices.find((v) => v.name === n || v.name.includes(n)))
        .find(Boolean);
      if (byName) return byName;
      const female = voices.find(
        (v) =>
          /^en/i.test(v.lang) &&
          /female|samantha|victoria|karen|zira|susan|allison|ava|moira|tessa/i.test(
            v.name,
          ),
      );
      return female ?? voices.find((v) => /^en/i.test(v.lang)) ?? voices[0];
    }

    function speak() {
      if (spokenRef.current || !speakerOn) return;
      const voices = synth.getVoices();
      if (voices.length === 0) return; // wait for voiceschanged
      try {
        const u = new SpeechSynthesisUtterance(SPOKEN_PROMPT);
        const v = pickVoice(voices);
        if (v) u.voice = v;
        u.pitch = 1.2; // livelier
        u.rate = 1.05;
        u.onstart = () => {
          spokenRef.current = true; // only mark spoken once it actually starts
        };
        synth.cancel();
        synth.speak(u);
      } catch {
        /* ignore */
      }
    }

    speak();
    synth.onvoiceschanged = () => speak(); // voices arrived after mount
    const onGesture = () => {
      speak();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      synth.onvoiceschanged = null;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [speakerOn]);

  async function enrich(payload: { text?: string; place_id?: string }) {
    setLoading(true);
    setError("");
    setCandidates(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      if (data.found === false) {
        setError("We couldn't find that business. Check the name and address.");
        return;
      }
      if (data.candidates) {
        setCandidates(data.candidates);
        return;
      }
      setBusiness(data.business);
      setHours(data.hours ?? []);
      setServices(data.services ?? []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup() {
    if (!business) return;
    // Persist so the draft survives the Google OAuth redirect.
    saveDraft({ business, hours, services });
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/calendar.events",
        redirectTo: `${window.location.origin}/api/auth/google/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  function setField<K extends keyof EnrichedBusiness>(
    key: K,
    value: EnrichedBusiness[K],
  ) {
    setBusiness((b) => (b ? { ...b, [key]: value } : b));
  }

  // ── Intake (before enrichment) ──────────────────────────────────────────
  if (!business) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-xl space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-indigo-600">Ringly</h1>
            <p className="mt-2 text-gray-600">
              Your AI receptionist, live in minutes.
            </p>
          </div>
          <textarea
            aria-label="Business name and address"
            className="w-full h-32 rounded-2xl border border-gray-300 p-4 text-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {candidates && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Which one is yours?</p>
              {candidates.map((c) => (
                <button
                  key={c.place_id}
                  onClick={() => enrich({ place_id: c.place_id })}
                  className="w-full text-left rounded-lg border border-gray-200 p-3 hover:bg-indigo-50"
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm text-gray-500">{c.address}</div>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => enrich({ text })}
              disabled={loading || !text.trim()}
            >
              {loading ? "Looking you up…" : "Continue"}
            </Button>
            <button
              type="button"
              onClick={() => setSpeakerOn((s) => !s)}
              className="text-sm text-gray-500 underline"
            >
              {speakerOn ? "🔊 Voice on" : "🔇 Voice off"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Enriched review (inline-editable) ───────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-3xl font-bold">
          Welcome, <span className="text-indigo-600">{business.name}</span>!
        </h1>
        <p className="text-gray-600">
          Here's what we found. Fix anything that's off.
        </p>

        <div className="rounded-2xl bg-white shadow p-6 space-y-4">
          <Field label="Business name">
            <Input
              value={business.name}
              onChange={(e) => setField("name", e.target.value)}
            />
          </Field>
          <Field label="Address">
            <Input
              value={business.formatted_address}
              onChange={(e) => setField("formatted_address", e.target.value)}
            />
          </Field>
          <Field label="Phone (your public number)">
            <Input
              value={business.public_phone}
              onChange={(e) => setField("public_phone", e.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <Input
              value={business.timezone}
              onChange={(e) => setField("timezone", e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-2xl bg-white shadow p-6 space-y-2">
          <h2 className="font-semibold">Hours</h2>
          {hours.map((h) => (
            <div key={h.day_of_week} className="flex justify-between text-sm">
              <span>{DAY_NAMES[h.day_of_week]}</span>
              <span className="text-gray-600">
                {h.is_closed
                  ? "Closed"
                  : h.hours_ranges
                      .map((r) => `${r.open}–${r.close}`)
                      .join(", ") || "Closed"}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-white shadow p-6 space-y-3">
          <h2 className="font-semibold">Services ({services.length})</h2>
          {services.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Service ${i + 1} name`}
                value={s.name}
                onChange={(e) =>
                  setServices((list) =>
                    list.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                onClick={() =>
                  setServices((list) => list.filter((_, j) => j !== i))
                }
                className="text-red-500 px-2"
                aria-label="Remove service"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              setServices((list) => [
                ...list,
                {
                  name: "",
                  description: "",
                  price_cents: null,
                  duration_minutes: null,
                },
              ])
            }
            className="text-sm text-indigo-600"
          >
            + Add a service
          </button>
        </div>

        <Button onClick={handleSetup} className="w-full">
          Set up your AI Receptionist
        </Button>
        <p className="text-center text-xs text-gray-500">
          You'll sign in with Google — that account becomes your Ringly login
          and your booking calendar.
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
