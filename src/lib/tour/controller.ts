// Controls the Matterport 3D tour from code (walk to rooms, turn, 360, dollhouse, floor plan).
// Uses the Matterport Showcase SDK. Needs NEXT_PUBLIC_MATTERPORT_SDK_KEY, and "localhost"
// (plus the demo domain) on that key's allow list in the Matterport developer settings.

import { ROOM_ALIASES, ROOM_NAMES, type RoomKey } from "@/lib/voice/commands";

type Vec3 = { x: number; y: number; z: number };
type Sweep = { id: string; sid?: string; enabled: boolean; position: Vec3; floorInfo?: { id?: string; sequence?: number } };
type RoomData = { id: string; label?: string; bounds?: { min: Vec3; max: Vec3 }; center?: Vec3; floorInfo?: { sequence?: number } };

/* Minimal typing of the parts of the SDK we use. */
type Observable<T> = { subscribe: (cb: T) => { cancel: () => void } };
export type MpSdk = {
  Sweep: {
    data: Observable<{ onCollectionUpdated: (c: Record<string, Sweep>) => void }>;
    current: Observable<(s: { sid: string; id?: string }) => void>;
    moveTo: (id: string, o: { transition?: string; transitionTime?: number; rotation?: { x: number; y: number } }) => Promise<string>;
  };
  Camera: {
    rotate: (h: number, v: number, o?: { speed?: number }) => Promise<void>;
    TransitionType: { FLY: string; FADEOUT: string; INSTANT: string };
  };
  Mode: {
    moveTo: (m: string, o?: { transition?: string }) => Promise<string>;
    Mode: { DOLLHOUSE: string; FLOORPLAN: string; INSIDE: string };
    current: Observable<(m: string) => void>;
  };
  Room?: {
    data: Observable<{ onCollectionUpdated: (c: Record<string, RoomData> | Map<string, RoomData>) => void }>;
    current: Observable<(c: { rooms: RoomData[] }) => void>;
  };
};

export type TourResult = { ok: boolean; say: string };

// If "turn left" turns right on the real tour, flip this to -1.
export const TURN_SIGN = 1;

const SDK_MODULE = "https://static.matterport.com/showcase-sdk/bootstrap/3.0.0-0-g0517b8d76c/sdk.es6.js";
const SDK_SCRIPT = "https://static.matterport.com/showcase-sdk/latest.js";

export function tourSrc(modelId: string, key: string | undefined) {
  const params = new URLSearchParams({ m: modelId, play: "1", qs: "1", brand: "0", help: "0", title: "0", mls: "0" });
  if (key) params.set("applicationKey", key);
  return `https://my.matterport.com/show/?${params.toString()}`;
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script"));
    document.head.appendChild(s);
  });
}

// Connect to the SDK inside the iframe. Tries the current module first, then the older global script.
export async function connectSdk(iframe: HTMLIFrameElement, key: string): Promise<MpSdk> {
  const withTimeout = <T,>(p: Promise<T>) =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20_000))]);
  try {
    const mod = (await import(/* webpackIgnore: true */ SDK_MODULE)) as { connect: (f: HTMLIFrameElement) => Promise<MpSdk> };
    return await withTimeout(mod.connect(iframe));
  } catch {
    await loadScript(SDK_SCRIPT);
    const g = (window as unknown as { MP_SDK?: { connect: (f: HTMLIFrameElement, k: string, v: string) => Promise<MpSdk> } }).MP_SDK;
    if (!g) throw new Error("Matterport SDK did not load");
    return withTimeout(g.connect(iframe, key, ""));
  }
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function inside(p: Vec3, b?: { min: Vec3; max: Vec3 }) {
  if (!b) return false;
  const pad = 0.4;
  return p.x >= b.min.x - pad && p.x <= b.max.x + pad && p.z >= b.min.z - pad && p.z <= b.max.z + pad &&
    p.y >= b.min.y - 2 && p.y <= b.max.y + 2;
}

// Map a Matterport room label ("Office", "Hallway", "Bathroom 2") to one of our room keys.
export function keyForLabel(label: string | undefined): RoomKey | null {
  if (!label) return null;
  const l = ` ${label.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const [key, words] of Object.entries(ROOM_ALIASES) as [RoomKey, readonly string[]][]) {
    if (words.some((w) => l.includes(` ${w} `) || l.includes(` ${w}s `))) return key;
  }
  return null;
}

type TourRoom = { id: string; label: string; key: RoomKey | null; sweeps: Sweep[]; center: Vec3 };

export class TourController {
  private sdk: MpSdk;
  private sweeps: Sweep[] = [];
  private rawRooms: RoomData[] = [];
  private rooms: TourRoom[] = [];
  private currentSweep = "";
  private currentRoomIds: string[] = [];
  private mode = "";
  private queue: Promise<unknown> = Promise.resolve();
  private subs: { cancel: () => void }[] = [];
  /** Optional names from our own labeling (Matterport room id -> label), e.g. Riley's Gemini labels. */
  overrides: Record<string, string> = {};
  onChange: (() => void) | null = null;

  constructor(sdk: MpSdk) {
    this.sdk = sdk;
    this.subs.push(
      sdk.Sweep.data.subscribe({
        onCollectionUpdated: (c) => {
          this.sweeps = Object.values(c).filter((s) => s.enabled !== false);
          this.rebuild();
        },
      }),
      sdk.Sweep.current.subscribe((s) => {
        if (s.sid) this.currentSweep = s.sid;
        this.onChange?.();
      }),
      sdk.Mode.current.subscribe((m) => {
        this.mode = m;
        this.onChange?.();
      }),
    );
    if (sdk.Room) {
      this.subs.push(
        sdk.Room.data.subscribe({
          onCollectionUpdated: (c) => {
            this.rawRooms = c instanceof Map ? [...c.values()] : Object.values(c);
            this.rebuild();
          },
        }),
        sdk.Room.current.subscribe((c) => {
          this.currentRoomIds = (c?.rooms ?? []).map((r) => r.id);
          this.onChange?.();
        }),
      );
    }
  }

  dispose() {
    this.subs.forEach((s) => s.cancel());
    this.subs = [];
  }

  // Group sweeps (the 360° photo spots) into rooms, ordered so "next room" walks a sensible path.
  private rebuild() {
    const rooms: TourRoom[] = this.rawRooms
      .map((r) => {
        const label = this.overrides[r.id] ?? r.label ?? "";
        const sweeps = this.sweeps.filter((s) => inside(s.position, r.bounds));
        const center = r.center ?? (r.bounds ? {
          x: (r.bounds.min.x + r.bounds.max.x) / 2, y: (r.bounds.min.y + r.bounds.max.y) / 2, z: (r.bounds.min.z + r.bounds.max.z) / 2,
        } : sweeps[0]?.position ?? { x: 0, y: 0, z: 0 });
        return { id: r.id, label, key: keyForLabel(label), sweeps, center };
      })
      .filter((r) => r.sweeps.length > 0);

    // No room data from the SDK: treat clusters of sweeps ~3 m apart as "rooms" so next/previous still work.
    if (!rooms.length && this.sweeps.length) {
      const clusters: Sweep[][] = [];
      for (const s of this.sweeps) {
        const c = clusters.find((cl) => dist(cl[0].position, s.position) < 3);
        if (c) c.push(s);
        else clusters.push([s]);
      }
      clusters.forEach((cl, i) => rooms.push({ id: `area-${i}`, label: "", key: null, sweeps: cl, center: cl[0].position }));
    }

    // Order: start at the room nearest the first sweep (usually the entrance), then always the nearest unvisited room.
    const ordered: TourRoom[] = [];
    const left = [...rooms];
    let at = this.sweeps[0]?.position ?? { x: 0, y: 0, z: 0 };
    while (left.length) {
      left.sort((a, b) => dist(a.center, at) - dist(b.center, at));
      const r = left.shift()!;
      ordered.push(r);
      at = r.center;
    }
    this.rooms = ordered;
    this.onChange?.();
  }

  /** Development check: what the SDK has reported so far. */
  debug() {
    return { sweeps: this.sweeps.length, rooms: this.rooms.map((r) => `${r.label || "?"}:${r.sweeps.length}`), current: this.currentSweep, mode: this.mode, roomIds: this.currentRoomIds };
  }

  get ready() {
    return this.sweeps.length > 0;
  }

  get modeName() {
    return this.mode;
  }

  private sweepKey(s: Sweep) {
    return s.sid || s.id;
  }

  private roomIndexOfCurrent(): number {
    const bySdk = this.rooms.findIndex((r) => this.currentRoomIds.includes(r.id));
    if (bySdk >= 0) return bySdk;
    return this.rooms.findIndex((r) => r.sweeps.some((s) => this.sweepKey(s) === this.currentSweep || s.id === this.currentSweep));
  }

  roomName(r: TourRoom | undefined): string {
    if (!r) return "this space";
    if (r.key) return ROOM_NAMES[r.key];
    const l = r.label.trim().toLowerCase();
    return l && l !== "other" && l !== "unknown" ? l : "this area";
  }

  currentRoomName(): string {
    return this.roomName(this.rooms[this.roomIndexOfCurrent()]);
  }

  currentRoomKey(): RoomKey | null {
    return this.rooms[this.roomIndexOfCurrent()]?.key ?? null;
  }

  knownRoomNames(): string[] {
    return [...new Set(this.rooms.filter((r) => r.key).map((r) => ROOM_NAMES[r.key!]))];
  }

  /** Run one movement at a time so quick commands never fight each other. */
  private run(fn: () => Promise<TourResult>): Promise<TourResult> {
    const next = this.queue.then(fn, fn).catch(() => ({ ok: false, say: "That move didn't work. Try again." }));
    this.queue = next;
    return next;
  }

  private async ensureInside() {
    if (this.mode && this.mode !== this.sdk.Mode.Mode.INSIDE) {
      await this.sdk.Mode.moveTo(this.sdk.Mode.Mode.INSIDE, { transition: this.sdk.Camera.TransitionType.FLY });
    }
  }

  private async walkToRoom(r: TourRoom): Promise<TourResult> {
    // Land on the photo spot closest to the middle of the room.
    const target = [...r.sweeps].sort((a, b) => dist(a.position, r.center) - dist(b.position, r.center))[0];
    if (!target) return { ok: false, say: "I can't reach that room in this scan." };
    if (this.mode === this.sdk.Mode.Mode.DOLLHOUSE || this.mode === this.sdk.Mode.Mode.FLOORPLAN) await this.ensureInside();
    await this.sdk.Sweep.moveTo(target.id, { transition: this.sdk.Camera.TransitionType.FLY, transitionTime: 1600 });
    return { ok: true, say: `This is the ${this.roomName(r)}.` };
  }

  next(): Promise<TourResult> {
    return this.run(async () => {
      if (!this.rooms.length) return { ok: false, say: "The tour is still loading." };
      const i = this.roomIndexOfCurrent();
      return this.walkToRoom(this.rooms[(i + 1 + this.rooms.length) % this.rooms.length]);
    });
  }

  previous(): Promise<TourResult> {
    return this.run(async () => {
      if (!this.rooms.length) return { ok: false, say: "The tour is still loading." };
      const i = Math.max(0, this.roomIndexOfCurrent());
      return this.walkToRoom(this.rooms[(i - 1 + this.rooms.length) % this.rooms.length]);
    });
  }

  goTo(key: RoomKey): Promise<TourResult> {
    return this.run(async () => {
      const matches = this.rooms.filter((r) => r.key === key);
      if (!matches.length) {
        const known = this.knownRoomNames();
        return {
          ok: false,
          say: known.length
            ? `I don't see a ${ROOM_NAMES[key]} in this scan. I can take you to the ${known.join(", the ")}.`
            : `This scan doesn't name its rooms, so I can't find the ${ROOM_NAMES[key]}. Say "next room" to walk through.`,
        };
      }
      // Several rooms of the same kind (3 exam rooms): go to the next one, not the one you're in.
      const here = this.roomIndexOfCurrent();
      const after = matches.find((r) => this.rooms.indexOf(r) > here) ?? matches[0];
      const target = matches.length > 1 && this.rooms[here] === after ? matches[(matches.indexOf(after) + 1) % matches.length] : after;
      return this.walkToRoom(target);
    });
  }

  turn(degrees: number): Promise<TourResult> {
    return this.run(async () => {
      await this.ensureInside();
      await this.sdk.Camera.rotate(TURN_SIGN * degrees, 0, { speed: 100 });
      return { ok: true, say: "" };
    });
  }

  look(degrees: number): Promise<TourResult> {
    return this.run(async () => {
      await this.ensureInside();
      await this.sdk.Camera.rotate(0, degrees, { speed: 60 });
      return { ok: true, say: "" };
    });
  }

  spin(): Promise<TourResult> {
    return this.run(async () => {
      await this.ensureInside();
      for (let i = 0; i < 4; i++) await this.sdk.Camera.rotate(TURN_SIGN * 90, 0, { speed: 45 });
      return { ok: true, say: "" };
    });
  }

  dollhouse(): Promise<TourResult> {
    return this.run(async () => {
      await this.sdk.Mode.moveTo(this.sdk.Mode.Mode.DOLLHOUSE, { transition: this.sdk.Camera.TransitionType.FLY });
      return { ok: true, say: "Here's the whole suite." };
    });
  }

  floorplan(): Promise<TourResult> {
    return this.run(async () => {
      await this.sdk.Mode.moveTo(this.sdk.Mode.Mode.FLOORPLAN, { transition: this.sdk.Camera.TransitionType.FLY });
      return { ok: true, say: "Here's the floor plan." };
    });
  }

  insideView(): Promise<TourResult> {
    return this.run(async () => {
      await this.ensureInside();
      return { ok: true, say: "" };
    });
  }
}
