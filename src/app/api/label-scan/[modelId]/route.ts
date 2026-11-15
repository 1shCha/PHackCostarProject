// POST /api/label-scan/{modelId}?profile=<profile key>&scope=suite|building
// Labels the rooms and built-in features of a Matterport scan that nobody has labeled yet, using the same
// Space Inspector agent as scripts/label-rooms.ts (Gemini first, Claude when Gemini is unavailable).
// Streams newline-delimited JSON so the page can show progress:
//   {"type":"progress","message":"Labeling photo 3 of 24"} … {"type":"done","inspect":{…},"fit":{…}|null}
//   or {"type":"error","message":"…"}
// Results are saved (./cache locally, /tmp on Vercel) and reused by search, the suite page and the voice tour.
// Fit checks are only computed for a scan of this suite; a scan elsewhere in the building can't vouch for this suite.

import { inspectModel } from "@/lib/spatial/inspector";
import { fitFor } from "@/lib/spatial/buildout";
import { PROFILES } from "@/lib/spatial/profiles";
import { isModelId, loadInspection, saveInspection } from "@/lib/spatial/saved-inspections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Inspection = Awaited<ReturnType<typeof inspectModel>>;
type Run = { listeners: Set<(m: string) => void>; result: Promise<Inspection> };
const running = new Map<string, Run>(); // one labeling run per scan, shared by everyone who opens it

function start(modelId: string): Run {
  const existing = running.get(modelId);
  if (existing) return existing;
  const listeners = new Set<(m: string) => void>();
  const result = inspectModel(modelId, (m) => listeners.forEach((l) => l(m)))
    .then((inspection) => {
      if (!inspection.rooms.length) throw new Error("no room outlines in this scan");
      // Every room unverified usually means the AI calls failed: don't save that, so the next visit tries again.
      if (inspection.rooms.length && inspection.rooms.every((r) => r.status === "unverified")) {
        throw new Error("AI quota: no room could be labeled");
      }
      saveInspection(modelId, inspection);
      return inspection;
    })
    .finally(() => running.delete(modelId));
  const run = { listeners, result };
  running.set(modelId, run);
  return run;
}

/** Friendly wording for why a scan couldn't be labeled. */
function reason(e: unknown) {
  const msg = (e as Error).message ?? "";
  if (/no room outlines/i.test(msg)) return "Matterport has no room outlines for this scan, so there are no rooms to label.";
  if (/floor plan/i.test(msg)) return "This scan has no photo floor plan, so its rooms can't be labeled automatically.";
  if (/GEMINI_API_KEY|ANTHROPIC|quota|429/i.test(msg)) return "The AI models are unavailable right now. Try again in a minute.";
  if (/Matterport|MATTERPORT/i.test(msg)) return "Matterport didn't return this scan's details.";
  return "This scan couldn't be labeled right now.";
}

export async function POST(request: Request, { params }: { params: Promise<{ modelId: string }> }) {
  const { modelId } = await params;
  if (!isModelId(modelId)) return Response.json({ error: "Bad model id" }, { status: 400 });
  const url = new URL(request.url);
  const profile = PROFILES.find((p) => p.key === url.searchParams.get("profile"));
  const scope = url.searchParams.get("scope") === "suite" ? "suite" : "building";
  const fitOf = (inspection: Inspection) => (profile && scope === "suite" ? fitFor(inspection, profile, []) : null);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* the page went away; the run keeps going and is saved for next time */
        }
      };
      const saved = loadInspection(modelId);
      if (saved) {
        send({ type: "done", inspect: saved, fit: fitOf(saved) });
        controller.close();
        return;
      }
      const run = start(modelId);
      const listener = (message: string) => send({ type: "progress", message });
      run.listeners.add(listener);
      send({ type: "progress", message: "Opening the scan" });
      try {
        const inspection = await run.result;
        send({ type: "done", inspect: inspection, fit: fitOf(inspection) });
      } catch (e) {
        console.error(`Labeling ${modelId} failed:`, (e as Error).message);
        send({ type: "error", message: reason(e) });
      } finally {
        run.listeners.delete(listener);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
