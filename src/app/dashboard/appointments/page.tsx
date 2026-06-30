"use client";
import { useEffect, useState } from "react";
import { formatDate, formatCents } from "@/lib/utils";
import type { Appointment } from "@/types";

type Filter = "upcoming" | "past" | "cancelled";

const STATUS_COLORS: Record<string, string> = {
  booked: "bg-green-50 text-green-700 border-green-200",
  rescheduled: "bg-blue-50 text-blue-700 border-blue-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  completed: "bg-gray-50 text-gray-600 border-gray-200",
  no_show: "bg-orange-50 text-orange-700 border-orange-200",
};

export default function AppointmentsPage() {
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/appointments?filter=${filter}`)
      .then((r) => r.json())
      .then((data) => {
        setAppointments(data ?? []);
        setLoading(false);
      });
  }, [filter]);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>

      <div className="flex gap-2">
        {(["upcoming", "past", "cancelled"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${
              filter === f
                ? "bg-indigo-600 text-white"
                : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : appointments.length === 0 ? (
          <p className="px-5 py-12 text-sm text-gray-400 text-center">
            No {filter} appointments
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr className="text-left">
                <th className="px-5 py-3 font-medium text-gray-500">
                  Customer
                </th>
                <th className="px-5 py-3 font-medium text-gray-500">Service</th>
                <th className="px-5 py-3 font-medium text-gray-500">
                  Date & Time
                </th>
                <th className="px-5 py-3 font-medium text-gray-500">Price</th>
                <th className="px-5 py-3 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {appointments.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {(a as any).customers?.name ?? "—"}
                    <div className="text-xs text-gray-400 font-normal">
                      {(a as any).customers?.phone_number}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    {(a as any).services?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    {formatDate(a.starts_at)}
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    {formatCents((a as any).services?.price_cents)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${STATUS_COLORS[a.status] ?? ""}`}
                    >
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
