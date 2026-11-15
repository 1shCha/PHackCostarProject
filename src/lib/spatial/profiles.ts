// What different businesses need from a space, and rough build-out costs.
// Every number in COSTS is an ASSUMPTION for ballpark estimates, not a quote. Edit them here as a team.

import { askVisionJSON } from "./vision";

/** Things a space can already have (counted from the inspection) and that a tenant may need. */
export const ELEMENTS = {
  reception: "Reception / check-in area",
  waiting: "Waiting area",
  private_rooms: "Enclosed private rooms (offices, consult, exam or treatment rooms)",
  plumbed_rooms: "Private rooms with a sink",
  offices: "Private offices",
  conference: "Conference rooms",
  restrooms: "Restrooms",
  break_room: "Break room or kitchenette",
  open_floor: "Open floor area (open office, salon floor, studio, sales floor)",
  shampoo_bowls: "Shampoo bowls",
  pedicure_stations: "Pedicure stations",
  styling_stations: "Styling stations",
  nail_stations: "Nail stations",
  treatment_beds: "Treatment beds",
  ventilation: "Ventilation / exhaust",
  kitchen_hood: "Kitchen hood",
  storage: "Storage or file room",
  server_room: "Server / IT room",
  warehouse: "Warehouse, workshop or garage bay",
  roll_up_door: "Roll-up door or loading dock",
  heavy_power: "Heavy electrical power",
  lab: "Lab",
} as const;
export type Element = keyof typeof ELEMENTS;

/**
 * ASSUMED cost (USD) to add one unit of an element, low–high. Used two ways:
 *  - already in the space → counted as build-out the tenant does not have to pay for
 *  - missing → estimated cost to add it
 */
export const COSTS: Record<Element, [number, number]> = {
  reception: [8_000, 25_000],
  waiting: [3_000, 10_000],
  private_rooms: [8_000, 20_000], // walls, door, power, finishes for one room
  plumbed_rooms: [4_000, 10_000], // adding a sink and plumbing run to a room
  offices: [8_000, 20_000],
  conference: [12_000, 30_000],
  restrooms: [25_000, 60_000],
  break_room: [10_000, 30_000],
  open_floor: [0, 0], // area, not a fixture
  shampoo_bowls: [2_500, 6_000],
  pedicure_stations: [3_000, 8_000],
  styling_stations: [1_500, 4_000],
  nail_stations: [1_000, 3_000],
  treatment_beds: [0, 0], // furniture: the tenant brings it
  ventilation: [10_000, 40_000],
  kitchen_hood: [30_000, 100_000],
  storage: [3_000, 10_000],
  server_room: [10_000, 30_000],
  warehouse: [0, 0], // can't be added to a suite
  roll_up_door: [8_000, 20_000],
  heavy_power: [10_000, 40_000],
  lab: [25_000, 75_000],
};
/** ASSUMED cost to demolish one enclosed room when a tenant needs open floor instead. */
export const REMOVE_ROOM_COST: [number, number] = [3_000, 8_000];

export type Need = { element: Element; min: number; why: string };
export type Profile = {
  key: string;
  name: string;
  category: string; // matches Role 1's history `category`
  needs: Need[];
  wants_open_floor?: boolean; // extra small rooms cost money to remove
  max_private_rooms?: number;
};

export const PROFILES: Profile[] = [
  { key: "medical", name: "Medical practice", category: "medical", needs: [
    { element: "reception", min: 1, why: "patient check-in" },
    { element: "waiting", min: 1, why: "patient waiting" },
    { element: "plumbed_rooms", min: 3, why: "exam rooms need sinks" },
    { element: "offices", min: 1, why: "provider office" },
    { element: "restrooms", min: 1, why: "patient restroom" },
  ] },
  { key: "dental", name: "Dental office", category: "dental", needs: [
    { element: "reception", min: 1, why: "patient check-in" },
    { element: "plumbed_rooms", min: 4, why: "operatories need water and drains" },
    { element: "lab", min: 1, why: "sterilization / lab area" },
    { element: "restrooms", min: 1, why: "patient restroom" },
  ] },
  { key: "medspa", name: "Med-spa / esthetician", category: "beauty", needs: [
    { element: "reception", min: 1, why: "client check-in" },
    { element: "plumbed_rooms", min: 2, why: "treatment rooms with sinks" },
    { element: "private_rooms", min: 3, why: "private treatment rooms" },
    { element: "restrooms", min: 1, why: "client restroom" },
  ] },
  { key: "salon", name: "Hair salon", category: "beauty", wants_open_floor: true, max_private_rooms: 2, needs: [
    { element: "reception", min: 1, why: "front desk" },
    { element: "open_floor", min: 1, why: "styling floor" },
    { element: "shampoo_bowls", min: 3, why: "plumbed shampoo area" },
    { element: "ventilation", min: 1, why: "color and chemical fumes" },
    { element: "restrooms", min: 1, why: "client restroom" },
  ] },
  { key: "nails", name: "Nail salon", category: "beauty", wants_open_floor: true, max_private_rooms: 1, needs: [
    { element: "reception", min: 1, why: "front desk" },
    { element: "open_floor", min: 1, why: "nail floor" },
    { element: "pedicure_stations", min: 3, why: "plumbed pedicure spas" },
    { element: "ventilation", min: 1, why: "acetone and acrylic fumes" },
    { element: "restrooms", min: 1, why: "client restroom" },
  ] },
  { key: "legal", name: "Law firm", category: "legal", needs: [
    { element: "reception", min: 1, why: "client reception" },
    { element: "offices", min: 5, why: "attorney offices with doors" },
    { element: "conference", min: 1, why: "client meetings and depositions" },
    { element: "storage", min: 1, why: "file room" },
    { element: "restrooms", min: 1, why: "client restroom" },
  ] },
  { key: "construction", name: "Construction company", category: "construction", needs: [
    { element: "offices", min: 2, why: "estimators and project managers" },
    { element: "conference", min: 1, why: "plan reviews" },
    { element: "warehouse", min: 1, why: "equipment and materials" },
    { element: "roll_up_door", min: 1, why: "truck and equipment access" },
    { element: "heavy_power", min: 1, why: "tools and shop equipment" },
  ] },
  { key: "office", name: "General office", category: "office", needs: [
    { element: "reception", min: 1, why: "front desk" },
    { element: "open_floor", min: 1, why: "team seating" },
    { element: "offices", min: 2, why: "managers and calls" },
    { element: "conference", min: 1, why: "meetings" },
    { element: "break_room", min: 1, why: "staff kitchenette" },
  ] },
  { key: "food", name: "Café / restaurant", category: "food", wants_open_floor: true, max_private_rooms: 1, needs: [
    { element: "kitchen_hood", min: 1, why: "cooking requires a hood" },
    { element: "ventilation", min: 1, why: "kitchen exhaust" },
    { element: "open_floor", min: 1, why: "seating" },
    { element: "restrooms", min: 1, why: "customer restroom" },
    { element: "storage", min: 1, why: "dry storage" },
  ] },
  { key: "retail", name: "Retail store", category: "retail", wants_open_floor: true, max_private_rooms: 1, needs: [
    { element: "open_floor", min: 1, why: "sales floor" },
    { element: "storage", min: 1, why: "stockroom" },
    { element: "restrooms", min: 1, why: "staff restroom" },
  ] },
  { key: "fitness", name: "Fitness studio", category: "fitness", wants_open_floor: true, max_private_rooms: 2, needs: [
    { element: "open_floor", min: 1, why: "workout floor" },
    { element: "reception", min: 1, why: "check-in" },
    { element: "restrooms", min: 2, why: "changing and showers" },
    { element: "ventilation", min: 1, why: "air exchange" },
  ] },
];

// Checked in this order. A trailing * means "word starting with" (dermatolog* matches dermatologist).
const KEYWORDS: Record<string, string[]> = {
  nails: ["nail*", "manicur*", "pedicur*"],
  dental: ["dental", "dentist*", "orthodont*"],
  medspa: ["med spa", "medspa", "esthetic*", "esthetician*", "aesthetic*", "laser", "facial*", "cosmetic*", "spa", "massage"],
  medical: ["medical", "doctor*", "physician*", "clinic*", "dermatolog*", "pediatric*", "urgent care", "physical therap*", "chiropract*"],
  salon: ["hair", "salon*", "barber*", "stylist*"],
  legal: ["law", "legal", "attorney*", "lawyer*"],
  construction: ["construction", "contractor*", "builder*", "roofing", "plumbing company", "electrician*"],
  food: ["cafe", "café", "coffee", "restaurant*", "bakery", "food", "kitchen"],
  retail: ["retail", "store", "shop", "boutique*"],
  fitness: ["fitness", "gym*", "yoga", "pilates"],
  office: ["office*", "startup*", "agency", "accounting", "insurance", "consult*", "tech", "software"],
};
const matches = (text: string, w: string) =>
  new RegExp(`\\b${w.replace(/\*$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${w.endsWith("*") ? "" : "\\b"}`).test(text);

/**
 * Finds the profile for a business described in plain words. Built-in profiles match by keyword;
 * anything else gets a custom profile written by Gemini (one request, then cached).
 */
export async function profileFor(business: string): Promise<Profile> {
  const text = business.toLowerCase();
  for (const [key, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => matches(text, w))) return PROFILES.find((p) => p.key === key)!;
  }
  const answer = await askVisionJSON<Omit<Profile, "key">>([], `A business owner describes their business as: "${business}".
List what they need from a commercial space, using ONLY these element names:
${Object.entries(ELEMENTS).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}
Reply as JSON only:
{"name": short business type, "category": one of [medical, dental, beauty, legal, construction, office, food, retail, fitness, industrial, other],
 "wants_open_floor": true or false, "max_private_rooms": number or null,
 "needs": [{"element": one element name, "min": number, "why": a few words}]}
Include 3 to 6 needs, the ones that would make build-out expensive if missing.`);
  return {
    key: "custom",
    name: answer.name,
    category: answer.category,
    wants_open_floor: answer.wants_open_floor,
    max_private_rooms: answer.max_private_rooms ?? undefined,
    needs: (answer.needs ?? []).filter((n) => n.element in ELEMENTS).map((n) => ({ ...n, min: Math.max(1, Math.round(n.min)) })),
  };
}
