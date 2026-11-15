// Turns a spoken sentence into one app command.
// Pure functions (no browser APIs) so every phrase can be unit-tested.

export type Mode = "tenant" | "landlord";

export type Command =
  | { kind: "tour.start" }
  | { kind: "tour.exit" }
  | { kind: "tour.next" }
  | { kind: "tour.prev" }
  | { kind: "tour.goto"; room: RoomKey }
  | { kind: "tour.gotoPlace"; name: string } // a room by this suite's own label ("Open area"), picked by /api/voice-intent
  | { kind: "tour.guide" } // narrated walk through every room
  | { kind: "tour.turn"; degrees: number }
  | { kind: "tour.look"; degrees: number }
  | { kind: "tour.spin" }
  | { kind: "tour.dollhouse" }
  | { kind: "tour.floorplan" }
  | { kind: "tour.inside" }
  | { kind: "tour.where" }
  | { kind: "nav.search"; text: string }
  | { kind: "nav.open"; rank?: number; suite?: string }
  | { kind: "nav.offer" }
  | { kind: "nav.back" }
  | { kind: "nav.home" }
  | { kind: "nav.mode"; mode: Mode }
  | { kind: "ui.help" }
  | { kind: "ui.close" }
  | { kind: "ui.stop" }
  | { kind: "ui.sleep" }
  | { kind: "ask"; question: string }
  | { kind: "none" };

// Room names people say, mapped to one key. Matterport labels and our own labels use the same keys.
export const ROOM_ALIASES = {
  procedure: ["procedure", "operating", "operating room", "surgery", "surgical", "treatment", "o r"],
  exam: ["exam", "examination", "patient room", "consult", "consultation"],
  reception: ["reception", "front desk", "lobby", "entrance", "entry", "foyer", "check in"],
  waiting: ["waiting", "waiting area", "waiting room"],
  office: ["office", "private office", "doctor's office", "doctors office", "study"],
  bathroom: ["bathroom", "restroom", "toilet", "washroom", "lavatory", "powder room"],
  kitchen: ["kitchen", "break room", "breakroom", "pantry", "kitchenette", "lounge"],
  hallway: ["hallway", "hall", "corridor"],
  storage: ["storage", "closet", "supply", "utility"],
  conference: ["conference", "meeting room", "boardroom"],
  lab: ["lab", "laboratory"],
} as const;

export type RoomKey = keyof typeof ROOM_ALIASES;

export const ROOM_NAMES: Record<RoomKey, string> = {
  procedure: "procedure room",
  exam: "exam room",
  reception: "reception",
  waiting: "waiting area",
  office: "office",
  bathroom: "restroom",
  kitchen: "break room",
  hallway: "hallway",
  storage: "storage room",
  conference: "conference room",
  lab: "lab",
};

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, one: 1, top: 1, best: 1,
  second: 2, "2nd": 2, two: 2,
  third: 3, "3rd": 3, three: 3,
  fourth: 4, "4th": 4, four: 4,
  fifth: 5, "5th": 5, five: 5,
};

// "open the second match" -> 2, "open suite 800" -> "800"
function openTarget(t: string): { rank?: number; suite?: string } {
  const suite = t.match(/\b(?:suite|unit|number|#)\s?(\d{1,4}[a-z]?)\b/)?.[1];
  if (suite && !/^number (one|two|three|four|five)$/.test(t)) return { suite };
  const ord = t.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|top|best)\b/)?.[1] ??
    t.match(/\bnumber (one|two|three|four|five)\b/)?.[1];
  return ord ? { rank: ORDINALS[ord] } : {};
}

const NUMBER_WORDS: Record<string, string> = {
  "three sixty": "360",
  "three hundred sixty": "360",
  "three hundred and sixty": "360",
  "one eighty": "180",
  "one hundred eighty": "180",
  ninety: "90",
  "nine hundred": "900",
  "nine oh oh": "900",
  "nine zero zero": "900",
  "forty five": "45",
  "forty-five": "45",
};

export function normalize(raw: string): string {
  let t = raw
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/°/g, " degrees")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [word, digits] of Object.entries(NUMBER_WORDS)) t = t.replace(new RegExp(`\\b${word}\\b`, "g"), digits);
  // Speech-to-text often hears "suite" as "sweet".
  t = t.replace(/\bsweet\b/g, "suite");
  return t;
}

// Wake phrase. Speech-to-text writes "SecondLife" many ways ("second life", "secondlife", "2nd life").
const WAKE = /\b(?:(?:hey|hi|hay|hello|okay|ok|a)\s+)?(?:second|seconds|2nd)\s?(?:life|lives|live|lyfe|like|light|wife|lie)\b/;

// Same phrase, matched on the original text so the rest keeps its punctuation and numbers ("6,000 sq ft").
const WAKE_RAW = /(?:(?:hey|hi|hay|hello|okay|ok|a)[\s,.!]+)?(?:second|seconds|2nd)[\s-]?(?:life|lives|live|lyfe|like|light|wife|lie)\b[\s,.!?:;-]*/i;

export function splitWake(raw: string): { woke: boolean; rest: string } {
  if (!WAKE.test(normalize(raw))) return { woke: false, rest: raw.trim() };
  const m = raw.match(WAKE_RAW);
  if (!m || m.index === undefined) return { woke: true, rest: normalize(raw).replace(WAKE, "").trim() };
  return { woke: true, rest: raw.slice(m.index + m[0].length).trim() };
}

export function roomFromText(t: string): RoomKey | null {
  const text = ` ${normalize(t)} `;
  // Longest alias first so "waiting room" wins over a shorter overlapping word.
  const pairs = (Object.entries(ROOM_ALIASES) as [RoomKey, readonly string[]][])
    .flatMap(([key, words]) => words.map((w) => [key, w] as const))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, word] of pairs) if (text.includes(` ${word} `) || text.includes(` ${word}s `)) return key;
  return null;
}

function turnAmount(t: string): number {
  const deg = t.match(/(\d+) ?degrees?/);
  if (deg) return Math.min(360, Number(deg[1]));
  if (/\b(a little|slightly|a bit|bit|little)\b/.test(t)) return 45;
  return 90;
}

export function parseCommand(raw: string, ctx: { inTour: boolean }): Command {
  const t = normalize(raw);
  if (!t) return { kind: "none" };
  const has = (re: RegExp) => re.test(t);
  const room = roomFromText(t);
  const aboutTenants = has(/\b(lease|tenant|tenants|who should|who's next|whos next|who is next|business)\b/);

  // --- Always available ---
  if (has(/^(stop|stop talking|quiet|be quiet|shh+|cancel|never ?mind|pause)$/)) return { kind: "ui.stop" };
  if (has(/^(thanks |thank you |ok(ay)? |alright )?(that'?s all|that is all|that'?s it|that'?ll be all|goodbye|good bye|bye|bye bye|stop listening|go to sleep|sleep|i'?m done|we'?re done|all done|done)( for now)?( thanks| thank you)?$/))
    return { kind: "ui.sleep" };
  if (has(/\b(what can i say|what can you do|what are the commands|^help$|show (me )?(the )?commands)\b/))
    return { kind: "ui.help" };
  if (has(/^(close|hide|dismiss|got it|ok(ay)? thanks?|thanks?|thank you)( (it|that|this|the answer))?$/))
    return { kind: "ui.close" };

  if (has(/\b(exit|leave|close|end|quit|stop|finish)( the)? (tour|3d|walk ?through|scan|virtual tour)\b/) ||
      has(/\b(get me out|back to the (page|card|details|listing))\b/))
    return { kind: "tour.exit" };

  // --- Opening the 3D tour (checked before page commands, so "show me Suite 900 in 3D" opens the tour) ---
  // Questions about the past ("what was inside before?") stay questions.
  const historyQuestion = has(/^(what|who|how|why|when|which)\b/) && has(/\b(before|was|were|used to|history|previous|past)\b/);
  const wantsTour = !historyQuestion && !ctx.inTour && (
    has(/\b(tour|tours|3d|three d|walk ?through|walkthrough|virtual|interior)\b/) ||
    has(/\b(inside|in side)\b/) ||
    has(/\b(take me through|walk me through|show me around|look around (the|this) (space|suite|unit|place)|explore (the|this) (space|suite|unit|inside))\b/));
  // Guided, narrated walkthrough of the whole suite (works from the page or inside the tour).
  if (!historyQuestion && has(/\b(walk me through|guided tour|give me (a|the) (full |guided |whole )?tour|tour guide|show me everything|full tour|walk me around|show me the whole (space|suite|place))\b/))
    return { kind: "tour.guide" };
  if (wantsTour && room) return { kind: "tour.goto", room };
  if (wantsTour) return { kind: "tour.start" };

  // --- Moving around the app ---
  if (has(/\b(switch|change|go|flip|move)( over)? to (the )?(landlord|owner)\b/) || has(/\b(landlord|owner) (mode|view|side)\b/) ||
      has(/\bi (have|own) (a |some )?(space|suite|building)\b/) || has(/\bi'?m (a |the )?(landlord|owner)\b/))
    return { kind: "nav.mode", mode: "landlord" };
  if (has(/\b(switch|change|go|flip|move)( over)? to (the )?tenant\b/) || has(/\btenant (mode|view|side)\b/))
    return { kind: "nav.mode", mode: "tenant" };

  if (has(/\b(draft|write|make|prepare|create|start)( me)? (an |the |my |a )?(offer|letter|loi)\b/) || has(/\bletter of intent\b/))
    return { kind: "nav.offer" };


  if (has(/\b(looking for|i need|find me|find (a|some)|search for|i want)\b/) &&
      has(/\b(sq|square|feet|foot|ft|space|office|suite|clinic|practice|houston|location)\b/) &&
      (!room || has(/\b(sq|square|feet|foot|ft|houston|medical|clinic|practice)\b/)))
    return { kind: "nav.search", text: raw.trim() };

  if (has(/\b(go|take me|bring me) home\b/) || has(/\b(start over|home ?page|main page|from the (start|beginning))\b/))
    return { kind: "nav.home" };

  // --- 3D tour ---

  if (has(/\b(doll ?house|whole (floor|suite|space|unit|place|thing)|from above|bird'?s?( eye)?|overview|zoom out|see everything|full layout|3d model)\b/))
    return { kind: "tour.dollhouse" };
  if (has(/\b(floor ?plan|top down|top view|map view|from the top)\b/)) return { kind: "tour.floorplan" };
  if (has(/\b(walk mode|back inside|street view|first person|go back in|inside mode)\b/)) return { kind: "tour.inside" };

  if (has(/\b360\b/) || has(/\b(spin|look all around|look around|full circle|panorama|all the way around|show me around)\b/))
    return { kind: "tour.spin" };
  if (has(/\b(turn|look|spin|rotate) around\b/) || has(/\b(behind me|what'?s behind|other way|opposite way|180)\b/))
    return { kind: "tour.turn", degrees: 180 };
  const lr = t.match(/\b(turn|look|rotate|face|pan|go|glance)( to)?( the)? (left|right)\b/) ?? t.match(/^(left|right)$/);
  if (lr) {
    const dir = lr[lr.length - 1] === "left" ? -1 : 1;
    return { kind: "tour.turn", degrees: dir * turnAmount(t) };
  }
  const ud = t.match(/\b(look|tilt|turn)( the camera)? (up|down)\b/) ?? t.match(/^(up|down)$/);
  if (ud) return { kind: "tour.look", degrees: ud[ud.length - 1] === "up" ? 30 : -30 };

  if (!aboutTenants && (has(/\bnext room\b/) || (ctx.inTour && has(/^(next|go next|forward|go forward|keep going|move on|continue|onward|go on)$/))))
    return { kind: "tour.next" };
  if (has(/\b(previous|last|prior) room\b/) || has(/\bback a room\b/) || (ctx.inTour && has(/^(go )?back$|^previous$/)))
    return { kind: "tour.prev" };

  if (ctx.inTour && has(/\b(where am i|what room|which room|what is this( room| place)?|what'?s (in )?(this|here)( room)?|whats (in )?(this|here)|what am i looking at|tell me about (this|the) room|describe (this|the) room)\b/))
    return { kind: "tour.where" };

  if (room && (ctx.inTour || has(/\b(take me to|go to|walk to|bring me to|head to|move to|jump to|show me|let'?s see|i want to see|where is|where's)\b/)))
    return { kind: "tour.goto", room };

  // Opening a listing comes after tour moves, so "give me a 360 of Suite 900" moves the tour.
  if (has(/\b(open|show|explore|see|view|pull up|bring up|check out|go to|take me to|look at|let'?s see|let me see)( me)?( the)? (best|top|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|number (one|two|three|four|five)|#\d)( match| one| option| space| result| pick| suite| listing)?\b/) ||
      has(/\b(open|show|explore|see|view|pull up|bring up|take me to|go to|let'?s see|let me see|look at|check out)( me)?( the)? (((suite|unit|space|number) )\d{1,4}[a-z]?|\d{2,4}[a-z]?)\b/) ||
      has(/\b(open|show|explore|pull up|bring up|take me to|go to|let me see|look at|check out)( me)?( that| this| the)? (space|suite|listing|unit|match|property|building)\b/) ||
      (has(/\b(suite|unit) \d{1,4}[a-z]?\b/) && has(/\b(open|show|see|view|explore|pull|bring|take|go)\b/)) || has(/\btravis\b/))
    return { kind: "nav.open", ...openTarget(t) };
  if (has(/^(go )?back$/) || has(/\b(previous page|go back|back to (the )?(results|matches|list))\b/)) return { kind: "nav.back" };

  return { kind: "ask", question: raw.trim() };
}

export const HELP_GROUPS: { title: string; items: string[] }[] = [
  { title: "Find a space", items: ["I'm a dermatologist looking for 6,000 sq ft in Houston", "Open the best match", "Go back", "Go home"] },
  { title: "Ask the space", items: ["What was here before?", "Would this work for a dermatologist?", "What's a fair rent?", "Who should lease this next?"] },
  { title: "Walk through it", items: ["Show me inside", "Next room", "Take me to the office", "Turn around", "Turn left", "Give me a 360", "Dollhouse view", "Floor plan", "What's in this room?", "Walk me through it", "Exit tour"] },
  { title: "Other", items: ["Switch to landlord", "Draft an offer", "Stop", "Close", "That's all (stop listening)"] },
];
