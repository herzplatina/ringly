"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents, DAY_NAMES } from "@/lib/utils";
import type { Business, Service } from "@/types";

type HoursDay = {
  day_of_week: number;
  is_closed: boolean;
  hours_ranges: { open: string; close: string }[];
};

type Tab = "profile" | "services" | "hours" | "whatsapp";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  const [business, setBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [hours, setHours] = useState<HoursDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // Profile fields
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("");

  // WhatsApp
  const [whatsappNumber, setWhatsappNumber] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/business").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/hours").then((r) => r.json()),
    ]).then(([biz, svcs, hrs]) => {
      setBusiness(biz);
      setName(biz?.name ?? "");
      setGreeting(biz?.greeting_script ?? "");
      setWhatsappNumber(biz?.whatsapp_number ?? "");
      setServices(svcs ?? []);
      setHours(
        hrs.length
          ? hrs
          : Array.from({ length: 7 }, (_: unknown, i: number) => ({
              day_of_week: i,
              is_closed: i === 0 || i === 6,
              hours_ranges: [{ open: "09:00", close: "17:00" }],
            })),
      );
    });
  }, []);

  async function saveProfile() {
    setLoading(true);
    await fetch("/api/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, greeting_script: greeting || null }),
    });
    setLoading(false);
    flashSaved();
  }

  async function saveService(svc: Service) {
    await fetch("/api/services", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(svc),
    });
    flashSaved();
  }

  async function deleteService(id: string) {
    await fetch("/api/services", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setServices((prev) => prev.filter((s) => s.id !== id));
  }

  async function addService() {
    const res = await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { name: "New service", active: true, source: "manual" },
      ]),
    });
    const data = await res.json();
    setServices((prev) => [...prev, ...data]);
  }

  async function saveHours() {
    setLoading(true);
    await fetch("/api/hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hours),
    });
    setLoading(false);
    flashSaved();
  }

  async function saveWhatsApp() {
    setLoading(true);
    await fetch("/api/business/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsappNumber }),
    });
    setLoading(false);
    flashSaved();
  }

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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
        const ranges = [...(h.hours_ranges ?? [])];
        if (!ranges[0]) ranges[0] = { open: "09:00", close: "17:00" };
        if (field === "open")
          ranges[0] = { ...ranges[0], open: value as string };
        if (field === "close")
          ranges[0] = { ...ranges[0], close: value as string };
        return { ...h, hours_ranges: ranges };
      }),
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "services", label: "Services" },
    { key: "hours", label: "Hours" },
    { key: "whatsapp", label: "WhatsApp" },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        {saved && (
          <span className="text-sm text-green-600 font-medium">✓ Saved</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Profile tab */}
        {tab === "profile" && (
          <div className="space-y-5">
            <Input
              id="name"
              label="Business name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {business?.retell_phone_number && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  AI receptionist number
                </p>
                <p className="text-lg font-bold text-indigo-600">
                  {business.retell_phone_number}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Custom greeting (optional)
              </label>
              <textarea
                rows={3}
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                placeholder="Thank you for calling! How can I help you today?"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">
                Leave blank to use the default greeting.
              </p>
            </div>
            <Button onClick={saveProfile} loading={loading}>
              Save changes
            </Button>
          </div>
        )}

        {/* Services tab */}
        {tab === "services" && (
          <div className="space-y-4">
            {services.map((s) => (
              <div
                key={s.id}
                className="border border-gray-200 rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <Input
                      label="Service name"
                      value={s.name}
                      onChange={(e) =>
                        setServices((prev) =>
                          prev.map((x) =>
                            x.id === s.id ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <Input
                      label="Description"
                      value={s.description ?? ""}
                      onChange={(e) =>
                        setServices((prev) =>
                          prev.map((x) =>
                            x.id === s.id
                              ? { ...x, description: e.target.value }
                              : x,
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
                            prev.map((x) =>
                              x.id === s.id
                                ? { ...x, price_cents: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                        placeholder="2500"
                      />
                      <Input
                        label="Duration (min)"
                        type="number"
                        value={s.duration_minutes ?? ""}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((x) =>
                              x.id === s.id
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
                    <p className="text-xs text-gray-400">
                      {formatCents(s.price_cents)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveService(s)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => deleteService(s.id)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="secondary" onClick={addService}>
              + Add service
            </Button>
          </div>
        )}

        {/* Hours tab */}
        {tab === "hours" && (
          <div className="space-y-5">
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
                    <span className="text-sm text-gray-400 italic">Closed</span>
                  )}
                </div>
              ))}
            </div>
            <Button onClick={saveHours} loading={loading}>
              Save hours
            </Button>
          </div>
        )}

        {/* WhatsApp tab */}
        {tab === "whatsapp" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Sender status
                </p>
                <p className="text-sm text-gray-500 capitalize mt-0.5">
                  {business?.whatsapp_sender_status?.replace("_", " ") ??
                    "not started"}
                </p>
              </div>
              {business?.whatsapp_sender_status === "approved" && (
                <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-green-50 text-green-700 border border-green-200">
                  ✓ Approved
                </span>
              )}
              {business?.whatsapp_sender_status === "rejected" && (
                <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-red-50 text-red-700 border border-red-200">
                  Rejected
                </span>
              )}
            </div>
            <Input
              id="whatsappNumber"
              label="WhatsApp Business number (E.164)"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="+14155551234"
            />
            <p className="text-xs text-gray-400">
              Each business requires its own WhatsApp sender registration
              through Meta. Approval typically takes 1–3 business days.
            </p>
            <Button onClick={saveWhatsApp} loading={loading}>
              {business?.whatsapp_sender_status === "not_started"
                ? "Register sender"
                : "Update number"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
