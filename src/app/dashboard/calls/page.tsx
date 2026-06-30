"use client";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";
import type { Call } from "@/types";
import { Phone, TestTube } from "lucide-react";

type TranscriptData = {
  transcript: string;
  recording_url: string | null;
  duration_ms: number | null;
};

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Call | null>(null);
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  useEffect(() => {
    fetch("/api/calls")
      .then((r) => r.json())
      .then((data) => {
        setCalls(data ?? []);
        setLoading(false);
      });
  }, []);

  async function openCall(call: Call) {
    setSelected(call);
    setTranscript(null);
    setTranscriptLoading(true);
    try {
      const res = await fetch(`/api/calls/${call.id}/transcript`);
      const data = await res.json();
      setTranscript(data);
    } catch {
      setTranscript({
        transcript: "Could not load transcript.",
        recording_url: null,
        duration_ms: null,
      });
    } finally {
      setTranscriptLoading(false);
    }
  }

  const OUTCOME_COLORS: Record<string, string> = {
    booked: "bg-green-50 text-green-700 border-green-200",
    rescheduled: "bg-blue-50 text-blue-700 border-blue-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
    inquiry_only: "bg-gray-50 text-gray-600 border-gray-200",
    unresolved: "bg-orange-50 text-orange-700 border-orange-200",
  };

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Call Log</h1>

      <div className="flex gap-6">
        {/* Call list */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          ) : calls.length === 0 ? (
            <p className="px-5 py-12 text-sm text-gray-400 text-center">
              No calls yet
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {calls.map((c) => (
                <li
                  key={c.id}
                  onClick={() => openCall(c)}
                  className={`px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${selected?.id === c.id ? "bg-indigo-50" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {c.is_test_call ? (
                        <TestTube className="h-4 w-4 text-amber-500" />
                      ) : (
                        <Phone className="h-4 w-4 text-gray-400" />
                      )}
                      <span className="text-sm font-medium text-gray-900">
                        {c.from_number ?? "Unknown"}
                      </span>
                      {c.is_test_call && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          test
                        </span>
                      )}
                    </div>
                    {c.outcome && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${OUTCOME_COLORS[c.outcome] ?? ""}`}
                      >
                        {c.outcome.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 ml-6">
                    {formatDate(c.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Transcript panel */}
        {selected && (
          <div className="w-96 bg-white rounded-xl border border-gray-200 flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="font-semibold text-gray-900 text-sm">
                Call from {selected.from_number}
              </p>
              <p className="text-xs text-gray-400">
                {formatDate(selected.created_at)}
              </p>
            </div>
            <div className="flex-1 p-5 overflow-y-auto">
              {transcriptLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                </div>
              ) : (
                <>
                  {transcript?.recording_url && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-gray-500 mb-1">
                        Recording
                      </p>
                      <audio
                        controls
                        src={transcript.recording_url}
                        className="w-full"
                      />
                    </div>
                  )}
                  {transcript?.duration_ms && (
                    <p className="text-xs text-gray-400 mb-3">
                      Duration: {Math.round(transcript.duration_ms / 1000)}s
                    </p>
                  )}
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Transcript
                  </p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {transcript?.transcript || "No transcript available."}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
