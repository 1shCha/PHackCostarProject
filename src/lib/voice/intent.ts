// Shared between /api/voice-intent (server) and the voice layer (browser): the tour actions Claude may pick.
import type { Command } from "./commands";

export const ACTIONS = [
  "next_room", "previous_room", "go_to_room", "turn_left", "turn_right", "turn_around", "look_up", "look_down",
  "spin_360", "dollhouse", "floor_plan", "inside_view", "where_am_i", "guided_walkthrough", "exit_tour",
  "question", "ignore",
] as const;
export type IntentAction = (typeof ACTIONS)[number];
export type Intent = { action: IntentAction; room?: string };

/** Turns the picked action into the same command the keyword matcher would produce. */
export function intentToCommand(intent: Intent, text: string): Command | "ignore" {
  switch (intent.action) {
    case "next_room": return { kind: "tour.next" };
    case "previous_room": return { kind: "tour.prev" };
    case "go_to_room": return intent.room ? { kind: "tour.gotoPlace", name: intent.room } : { kind: "ask", question: text };
    case "turn_left": return { kind: "tour.turn", degrees: -90 };
    case "turn_right": return { kind: "tour.turn", degrees: 90 };
    case "turn_around": return { kind: "tour.turn", degrees: 180 };
    case "look_up": return { kind: "tour.look", degrees: 30 };
    case "look_down": return { kind: "tour.look", degrees: -30 };
    case "spin_360": return { kind: "tour.spin" };
    case "dollhouse": return { kind: "tour.dollhouse" };
    case "floor_plan": return { kind: "tour.floorplan" };
    case "inside_view": return { kind: "tour.inside" };
    case "where_am_i": return { kind: "tour.where" };
    case "guided_walkthrough": return { kind: "tour.guide" };
    case "exit_tour": return { kind: "tour.exit" };
    case "ignore": return "ignore";
    default: return { kind: "ask", question: text };
  }
}

/** Asks the server to pick an action. Any failure keeps the old behavior (treat it as a question). */
export async function resolveIntent(text: string, ctx: { inTour: boolean; rooms: string[]; here: string }): Promise<Intent> {
  try {
    const res = await fetch("/api/voice-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...ctx }),
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return { action: "question" };
    return (await res.json()) as Intent;
  } catch {
    return { action: "question" };
  }
}
