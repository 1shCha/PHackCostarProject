// POST /api/voice-intent { text, inTour, rooms, here } → { action, room? }
// The keyword matcher (src/lib/voice/commands.ts) handles the usual phrases instantly. When it can't place a
// sentence during the 3D tour ("can we see where people would wait?"), this asks Claude Haiku to pick one of
// the allowed tour actions. A forced tool call means the answer is always one of the actions below.
// Optional env: VOICE_INTENT_MODEL (default claude-haiku-5-5, chosen for speed: this runs while the user waits).

import Anthropic from "@anthropic-ai/sdk";
import { ACTIONS, type IntentAction } from "@/lib/voice/intent";

export const runtime = "nodejs";


const GUIDE = `You control a 3D virtual tour of a commercial suite by voice. Pick the ONE action that matches what the user said.
- go_to_room: they want to see a specific room. Set "room" to the closest name from the room list (e.g. "where would clients wait" → the waiting area; "the back" → a storage or back room).
- guided_walkthrough: they want to be shown the whole suite ("show me everything", "give me the tour").
- question: they're asking about the space, rent, history or fit, and want a spoken answer rather than movement.
- ignore: side conversation not meant for the assistant.
Prefer movement when the sentence is about seeing or going somewhere.`;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return Response.json({ action: "question" satisfies IntentAction }, { status: 200 });
  let body: { text?: unknown; inTour?: unknown; rooms?: unknown; here?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  const text = String(body.text ?? "").trim().slice(0, 300);
  const rooms = (Array.isArray(body.rooms) ? body.rooms : []).map(String).slice(0, 40);
  const here = String(body.here ?? "").slice(0, 80);
  if (!text) return Response.json({ error: "Empty text" }, { status: 400 });

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey,
    timeout: 8_000,
    maxRetries: 1,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  try {
    const response = await client.messages.create({
      model: process.env.VOICE_INTENT_MODEL?.trim() || "claude-haiku-5-5",
      max_tokens: 200,
      system: GUIDE,
      tools: [{
        name: "pick_action",
        description: "The tour action that matches the user's sentence.",
        input_schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: [...ACTIONS] },
            room: { type: "string", description: "For go_to_room: one name copied exactly from the room list." },
          },
          required: ["action"],
        },
      }],
      tool_choice: { type: "tool", name: "pick_action" },
      messages: [{
        role: "user",
        content: `Rooms in this suite: ${rooms.length ? rooms.join("; ") : "(not labeled)"}\nCurrently in: ${here || "unknown"}\nTour open: ${body.inTour ? "yes" : "no"}\nUser said: "${text}"`,
      }],
    });
    const call = response.content.find((b) => b.type === "tool_use");
    const input = (call?.type === "tool_use" ? call.input : {}) as { action?: string; room?: string };
    const action = (ACTIONS as readonly string[]).includes(input.action ?? "") ? (input.action as IntentAction) : "question";
    // Only accept a room name that's really in this suite.
    const room = action === "go_to_room" ? rooms.find((r) => r.toLowerCase() === String(input.room ?? "").toLowerCase()) : undefined;
    if (action === "go_to_room" && !room) return Response.json({ action: "question" });
    return Response.json({ action, ...(room ? { room } : {}) });
  } catch (e) {
    console.error("voice-intent failed:", (e as Error).message);
    return Response.json({ action: "question" satisfies IntentAction }); // fall back to the old behavior
  }
}
