"use client";
export const dynamic = "force-dynamic";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadDraft, clearDraft } from "@/lib/draft";

type Phase = "claiming" | "provisioning" | "done" | "error";

const BENEFITS = [
  "Answers every call 24/7 — never miss a booking.",
  "Books, reschedules, and cancels appointments by voice.",
  "Syncs straight to your Google Calendar.",
  "Knows your services, hours, and prices.",
];

export default function FinishPage() {
  const [phase, setPhase] = useState<Phase>("claiming");
  const [error, setError] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        // 1. Claim: bind the pre-auth draft to this Google account.
        const claimRes = await fetch("/api/business/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: loadDraft() ?? "{}",
        });
        const claim = await claimRes.json();
        if (!claimRes.ok) {
          setError(claim.error ?? "Could not save your business.");
          setPhase("error");
          return;
        }
        clearDraft();

        // 2. Provision Retell (buys number, creates agent) in the background.
        setPhase("provisioning");
        const provRes = await fetch("/api/retell/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: claim.businessId }),
        });
        const prov = await provRes.json();
        if (!provRes.ok) {
          setError(prov.error ?? "Provisioning failed. Please retry.");
          setPhase("error");
          return;
        }
        setPhone(prov.phone_number ?? null);
        setPhase("done");
      } catch {
        setError("Network error. Please retry.");
        setPhase("error");
      }
    })();
  }, []);

  const pretty = phone
    ? phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")
    : "";

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg space-y-6 text-center">
        {phase === "error" ? (
          <>
            <h1 className="text-2xl font-bold text-red-600">
              Something went wrong
            </h1>
            <p className="text-gray-600">{error}</p>
            <Button onClick={() => location.reload()}>Retry</Button>
          </>
        ) : phase === "done" && live ? (
          <>
            <h1 className="text-3xl font-bold text-indigo-600">
              You're live! 🎉
            </h1>
            <p className="text-lg text-gray-700">Call your receptionist now:</p>
            <p className="text-4xl font-bold tracking-tight">{pretty}</p>
            <p className="text-gray-500">
              Call it and book an appointment — then watch it appear on your
              dashboard.
            </p>
            <Button onClick={() => (location.href = "/dashboard")}>
              Go to dashboard
            </Button>
          </>
        ) : phase === "done" ? (
          <>
            <h1 className="text-3xl font-bold text-indigo-600">
              Your receptionist is ready!
            </h1>
            <p className="text-gray-600">
              You're signed in to Ringly with your Google account — it's your
              login and your booking calendar.
            </p>
            <p className="text-lg text-gray-700">Your new number:</p>
            <p className="text-4xl font-bold tracking-tight">{pretty}</p>
            <Button onClick={() => setLive(true)}>Go Live</Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">
              {phase === "claiming"
                ? "Saving your business…"
                : "Setting up your AI receptionist…"}
            </h1>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <ul className="mx-auto max-w-sm space-y-2 text-left text-gray-600">
              {BENEFITS.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="text-indigo-600">✓</span>
                  {b}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
