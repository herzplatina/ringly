"use client";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";
import type { Customer, WhatsappConsentStatus } from "@/types";
import { Button } from "@/components/ui/button";

const CONSENT_STYLES: Record<WhatsappConsentStatus, string> = {
  granted: "bg-green-50 text-green-700 border-green-200",
  declined: "bg-red-50 text-red-700 border-red-200",
  not_asked: "bg-gray-50 text-gray-500 border-gray-200",
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => {
        setCustomers(data ?? []);
        setLoading(false);
      });
  }, []);

  async function toggleConsent(customer: Customer) {
    const next: WhatsappConsentStatus =
      customer.whatsapp_consent_status === "granted" ? "declined" : "granted";
    setUpdating(customer.id);
    try {
      const res = await fetch("/api/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customer.id,
          whatsapp_consent_status: next,
        }),
      });
      const updated = await res.json();
      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? updated : c)),
      );
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Customers</h1>

      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : customers.length === 0 ? (
          <p className="px-5 py-12 text-sm text-gray-400 text-center">
            No customers yet — they&apos;ll appear here after their first call.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-gray-100">
                <tr className="text-left">
                  <th className="px-5 py-3 font-medium text-gray-500">Name</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Phone</th>
                  <th className="px-5 py-3 font-medium text-gray-500">
                    WhatsApp consent
                  </th>
                  <th className="px-5 py-3 font-medium text-gray-500">
                    Consent date
                  </th>
                  <th className="px-5 py-3 font-medium text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {c.name ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {c.phone_number}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${CONSENT_STYLES[c.whatsapp_consent_status]}`}
                      >
                        {c.whatsapp_consent_status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {c.whatsapp_consent_at
                        ? formatDate(c.whatsapp_consent_at)
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {c.whatsapp_consent_status !== "not_asked" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={updating === c.id}
                          onClick={() => toggleConsent(c)}
                        >
                          {c.whatsapp_consent_status === "granted"
                            ? "Revoke consent"
                            : "Grant consent"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
