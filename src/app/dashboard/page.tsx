"use client";
import { useEffect, useState } from "react";
import { formatDate, formatCents } from "@/lib/utils";
import type { Appointment, Business, Call } from "@/types";
import Link from "next/link";
import { Phone, Calendar, CheckCircle } from "lucide-react";

export default function DashboardPage() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/business").then((r) => r.json()),
      fetch("/api/appointments?filter=upcoming").then((r) => r.json()),
      fetch("/api/calls").then((r) => r.json()),
    ]).then(([biz, appts, cls]) => {
      setBusiness(biz);
      setAppointments(appts?.slice(0, 5) ?? []);
      setCalls(cls?.slice(0, 5) ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const stats = [
    {
      label: "Upcoming appointments",
      value: appointments.length,
      icon: Calendar,
      color: "text-indigo-600",
    },
    {
      label: "Recent calls",
      value: calls.length,
      icon: Phone,
      color: "text-green-600",
    },
    {
      label: "WhatsApp status",
      value:
        business?.whatsapp_sender_status?.replace("_", " ") ?? "not started",
      icon: CheckCircle,
      color: "text-amber-600",
    },
  ];

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {business?.name ?? "Your Business"}
        </h1>
        {business?.retell_phone_number && (
          <p className="text-gray-500 mt-1">
            AI receptionist number:{" "}
            <span className="font-semibold text-indigo-600">
              {business.retell_phone_number}
            </span>
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-gray-200 p-5"
          >
            <s.icon className={`h-6 w-6 ${s.color} mb-2`} />
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Upcoming appointments */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Upcoming appointments</h2>
          <Link
            href="/dashboard/appointments"
            className="text-sm text-indigo-600 hover:underline"
          >
            View all
          </Link>
        </div>
        {appointments.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">
            No upcoming appointments
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {appointments.map((a) => (
              <li
                key={a.id}
                className="px-5 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {(a as any).customers?.name ?? "Unknown"} —{" "}
                    {(a as any).services?.name ?? "Appointment"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(a.starts_at, business?.timezone)}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent calls */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent calls</h2>
          <Link
            href="/dashboard/calls"
            className="text-sm text-indigo-600 hover:underline"
          >
            View all
          </Link>
        </div>
        {calls.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">
            No calls yet
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {calls.map((c) => (
              <li
                key={c.id}
                className="px-5 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {c.from_number ?? "Unknown"}
                    {c.is_test_call && " (test)"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(c.created_at)}
                  </p>
                </div>
                <span className="text-xs text-gray-500 capitalize">
                  {c.outcome ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
