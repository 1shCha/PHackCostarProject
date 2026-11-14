import type { ProgressEvent } from "@/lib/types";

/** Live list of agents: working → done. One row per agent, latest status wins. */
export function AgentRoom({ events }: { events: ProgressEvent[] }) {
  const latest = new Map<string, ProgressEvent>();
  for (const e of events) latest.set(e.agent, e);

  return (
    <ol className="space-y-2">
      {[...latest.values()].map((e) => (
        <li key={e.agent} className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
          <span className="w-5 text-center">
            {e.status === "working" ? (
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-amber-400" />
            ) : e.status === "done" ? "✅" : "⚠️"}
          </span>
          <span className="w-32 font-medium text-stone-800">{e.agent}</span>
          <span className="text-stone-500">{e.message}</span>
        </li>
      ))}
    </ol>
  );
}
