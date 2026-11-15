// Fit + build-out estimate: compares what a space already has (from the inspection) with what a business needs
// (from its profile), and estimates what's already paid for, what must be added, and what must be removed.
// Dollar figures come from COSTS in profiles.ts and are rough ASSUMPTIONS, shown as ranges.

import { COSTS, ELEMENTS, REMOVE_ROOM_COST, type Element, type Profile } from "./profiles";
import { OPEN_AREAS, PRIVATE_ROOMS, type Feature, type Label } from "./vocabulary";
import type { InspectRoom } from "./inspector";

type Inspection = { rooms: InspectRoom[] };
type PastTenant = { tenant: string; category: string; from: string; to: string };
type Range = { low: number; high: number };
type Item = { element: Element; label: string; units: number } & Range;

/** Counts every element in the space. Unverified rooms are left out (we can't see them). */
/** Older saved inspections lack some fields; fill them so counting works either way. */
function normalize(insp: Inspection): Inspection {
  return {
    rooms: insp.rooms.map((r) => {
      const legacy = r as InspectRoom & { scanned_inside?: boolean };
      return {
        ...r,
        status: r.status ?? (legacy.scanned_inside === false ? "unverified" : "likely"),
        features: r.features ?? [],
        zones: r.zones?.map((z) => ({ ...z, features: z.features ?? [] })),
      };
    }),
  };
}

export function countElements(raw: Inspection): Record<Element, number> {
  const insp = normalize(raw);
  const rooms = insp.rooms.filter((r) => r.status !== "unverified");
  const zones = rooms.flatMap((r) => r.zones ?? []);
  const isRoom = (ls: Label[]) => rooms.filter((r) => !r.zones && ls.includes(r.label));
  const isZone = (ls: Label[]) => zones.filter((z) => ls.includes(z.label));
  const feat = (t: Feature) => rooms.reduce((n, r) => n + r.features.filter((f) => f.type === t).length, 0);
  const any = (n: number) => (n > 0 ? 1 : 0);

  // Enclosed rooms: separate rooms, plus zones of big rooms that are clearly private rooms
  // (Matterport sometimes merges rooms opening onto a corridor into one big room).
  const privRooms = isRoom(PRIVATE_ROOMS);
  const privZones = isZone(PRIVATE_ROOMS);
  const plumbed =
    privRooms.filter((r) => r.features.some((f) => f.type === "sink" || f.type === "lab_counter")).length +
    privZones.filter((z) => z.features.includes("sink") || z.features.includes("lab_counter")).length;

  return {
    reception: any(isRoom(["reception"]).length + isZone(["reception"]).length + feat("reception_desk")),
    waiting: any(isRoom(["waiting"]).length + isZone(["waiting"]).length),
    private_rooms: privRooms.length + privZones.length,
    plumbed_rooms: plumbed,
    offices: isRoom(["private_office"]).length + isZone(["private_office"]).length,
    conference: isRoom(["conference"]).length + isZone(["conference"]).length || any(feat("conference_table")),
    restrooms: isRoom(["restroom"]).length || any(feat("toilet")),
    break_room: any(isRoom(["break_room", "kitchen"]).length + isZone(["break_room", "kitchen"]).length),
    open_floor: any(isRoom(OPEN_AREAS).length + rooms.filter((r) => r.zones).length),
    shampoo_bowls: feat("shampoo_bowl"),
    pedicure_stations: feat("pedicure_station"),
    styling_stations: feat("styling_station"),
    nail_stations: feat("nail_station"),
    treatment_beds: feat("treatment_bed"),
    ventilation: any(feat("ventilation_exhaust") + feat("kitchen_hood")),
    kitchen_hood: any(feat("kitchen_hood")),
    storage: any(isRoom(["storage", "file_room"]).length + isZone(["storage", "file_room"]).length + feat("shelving")),
    server_room: any(isRoom(["server_utility"]).length + feat("server_rack")),
    warehouse: any(isRoom(["warehouse", "workshop", "garage_bay"]).length + isZone(["warehouse", "workshop", "garage_bay"]).length),
    roll_up_door: any(feat("roll_up_door") + feat("loading_dock")),
    heavy_power: any(feat("heavy_power")),
    lab: any(isRoom(["lab"]).length + isZone(["lab"]).length + feat("lab_counter")),
  };
}

const sum = (items: Item[]): Range => ({
  low: items.reduce((s, i) => s + i.low, 0),
  high: items.reduce((s, i) => s + i.high, 0),
});
const money = (r: Range) => (r.high === 0 ? "$0" : `$${Math.round(r.low / 1000)}k–$${Math.round(r.high / 1000)}k`);

export function fitFor(raw: Inspection, profile: Profile, history: PastTenant[] = []) {
  const insp = normalize(raw);
  const have = countElements(insp);
  const unverified = insp.rooms.filter((r) => r.status === "unverified").length;

  const checks: { need: string; status: "pass" | "partial" | "fail"; evidence: string }[] = [];
  const inPlace: Item[] = [];
  const toAdd: Item[] = [];
  for (const n of profile.needs) {
    const got = have[n.element];
    const [lo, hi] = COSTS[n.element];
    const status = got >= n.min ? "pass" : got > 0 ? "partial" : "fail";
    checks.push({
      need: `${n.min > 1 ? `${n.min}× ` : ""}${ELEMENTS[n.element]} (${n.why})`,
      status,
      evidence: got ? `Found ${got} in the scan` : unverified ? `Not found; ${unverified} room(s) couldn't be checked` : "Not found in the scan",
    });
    const used = Math.min(got, n.min);
    if (used && hi) inPlace.push({ element: n.element, label: ELEMENTS[n.element], units: used, low: lo * used, high: hi * used });
    const missing = n.min - used;
    if (missing > 0 && hi) toAdd.push({ element: n.element, label: ELEMENTS[n.element], units: missing, low: lo * missing, high: hi * missing });
    if (missing > 0 && !hi && n.element === "warehouse") {
      checks[checks.length - 1].evidence += " (a suite can't be turned into a warehouse)";
    }
  }

  const toRemove: Item[] = [];
  const extraRooms = profile.wants_open_floor ? have.private_rooms - (profile.max_private_rooms ?? 0) : 0;
  if (extraRooms > 0) {
    toRemove.push({ element: "private_rooms", label: "Enclosed rooms to open up", units: extraRooms,
      low: REMOVE_ROOM_COST[0] * extraRooms, high: REMOVE_ROOM_COST[1] * extraRooms });
  }

  const saved = sum(inPlace), add = sum(toAdd), remove = sum(toRemove);
  const sameKind = history.filter((h) => h.category && h.category === profile.category);
  const score = Math.round((checks.reduce((s, c) => s + (c.status === "pass" ? 1 : c.status === "partial" ? 0.5 : 0), 0) / Math.max(1, checks.length)) * 100);

  return {
    profile: { key: profile.key, name: profile.name, category: profile.category },
    score,
    checks,
    accessibility: [
      { check: "Restroom on the suite", status: have.restrooms ? "pass" : "unknown", evidence: have.restrooms ? "Restroom seen in the scan" : "No restroom seen" },
      { check: "Grab bars", status: insp.rooms.some((r) => r.features.some((f) => f.type === "grab_bars")) ? "pass" : "unknown", evidence: "From photos only; not a code review" },
      { check: "Door and hallway widths", status: "unknown", evidence: "Not measured from the scan yet" },
    ],
    buildout: {
      already_in_place: { ...saved, items: inPlace, summary: `${money(saved)} of ${profile.name.toLowerCase()} build-out already in the space` },
      to_add: { ...add, items: toAdd, summary: `${money(add)} to add what's missing` },
      to_remove: { ...remove, items: toRemove, summary: toRemove.length ? `${money(remove)} to open up ${extraRooms} enclosed room(s)` : "Nothing to remove" },
      net_cost: { low: add.low + remove.low, high: add.high + remove.high },
      note: "Rough estimates from assumed unit costs (src/lib/spatial/profiles.ts), not contractor quotes.",
    },
    history_note: sameKind.length
      ? `Past ${profile.category} tenant${sameKind.length > 1 ? "s" : ""}: ${sameKind.map((h) => `${h.tenant} (${h.from.slice(0, 4)}–${h.to.slice(0, 4)})`).join(", ")}. Second-generation space usually means a cheaper build-out.`
      : "",
  };
}
