"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentRoom } from "@/components/AgentRoom";
import { SpaceCard } from "@/components/SpaceCard";
import { runAgents } from "@/lib/api";
import type { Card, ProgressEvent } from "@/lib/types";

/** Runs the agents for one suite: the Agent Room fills live, and Space Card sections appear as each agent finishes. */
export function SpaceRun({ suiteKey, mode }: { suiteKey: string; mode: "tenant" | "landlord" }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [card, setCard] = useState<Card>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setEvents([]);
    setCard({});
    setDone(false);
    setError(null);
    runAgents({ key: suiteKey, mode }, (e) => {
      if (e.type === "progress") {
        setEvents((prev) => [...prev, e]);
        if (e.status === "done" && e.field) setCard((prev) => ({ ...prev, [e.field as string]: e.value }));
      } else {
        setCard(e.card);
        setDone(true);
      }
    }, ctrl.signal).catch((err) => {
      if (!ctrl.signal.aborted) setError(String(err));
    });
    return () => ctrl.abort();
  }, [suiteKey, mode]);

  const question = mode === "landlord" ? "Who should lease this suite, and for how much?" : "Is this the right space for a dermatology practice?";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">← SecondLife</Link>
        <span className="rounded-full bg-white px-3 py-1 text-xs text-stone-500">{mode === "landlord" ? "Landlord mode" : "Tenant mode"}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="text-xs font-semibold uppercase text-emerald-700">You asked</p>
            <p className="mt-1">{question}</p>
          </div>
          <AgentRoom events={events} />
          {!done && !error && <p className="text-xs text-stone-400">Agents working…</p>}
          {error && (
            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              Can&apos;t reach the API. Is the backend running on port 8000? ({error})
            </p>
          )}
        </aside>
        <SpaceCard card={card} />
      </div>
    </main>
  );
}
