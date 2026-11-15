// Industry-neutral words for describing a space. The labeler uses these for every suite, whoever is searching;
// business profiles (profiles.ts) then decide which of them matter for a given tenant.

export const ROOM_LABELS = {
  // front of house
  reception: "Reception",
  waiting: "Waiting area",
  showroom: "Showroom",
  sales_floor: "Sales floor",
  // private rooms
  private_office: "Private office",
  conference: "Conference room",
  consult_room: "Consult room",
  exam_room: "Exam room",
  treatment_room: "Treatment room",
  procedure: "Procedure room",
  nurse_station: "Nurse station",
  // open work
  open_workspace: "Open workspace",
  styling_floor: "Styling floor",
  nail_floor: "Nail / pedicure area",
  studio: "Studio / fitness floor",
  // wet rooms
  break_room: "Break room",
  kitchen: "Commercial kitchen",
  restroom: "Restroom",
  lab: "Lab",
  wash_area: "Wash / shampoo area",
  // back of house
  storage: "Storage",
  file_room: "File room",
  server_utility: "Server / utility room",
  workshop: "Workshop",
  warehouse: "Warehouse",
  garage_bay: "Garage bay",
  hallway: "Hallway",
  other: "Other",
} as const;

// Each feature has a definition so the model can tell similar things apart.
export const FEATURES = {
  reception_desk: "check-in desk facing the entrance or waiting area, usually with a raised ledge for visitors",
  counter: "built-in counter along a wall that does not face visitors (workroom, kitchenette, supply area)",
  nurse_station: "staff station inside a clinical area, often a counter with computers between exam rooms",
  desks: "individual freestanding work desks for staff",
  workstation: "cubicle or benching workstation with partitions",
  lab_counter: "counter with a sink, lab equipment or chemical-resistant top, often with a backsplash",
  sink: "a sink with a faucet in a room that is not a restroom (count only clearly visible sinks)",
  toilet: "toilet",
  floor_drain: "drain set into the floor",
  shampoo_bowl: "salon shampoo bowl / backwash unit",
  pedicure_station: "pedicure spa chair or foot basin",
  nail_station: "manicure table",
  styling_station: "salon station with a mirror and styling chair",
  treatment_bed: "spa, esthetics or massage treatment bed",
  exam_table: "medical exam table or exam chair",
  cabinets: "built-in wall or base cabinets",
  shelving: "heavy storage shelving or racking",
  medical_gas: "wall-mounted medical gas or vacuum outlets",
  ventilation_exhaust: "visible exhaust fans, ducted ventilation or fume extraction",
  kitchen_hood: "exhaust hood over a cooking area",
  appliances: "refrigerator, microwave, dishwasher or similar",
  glass_partition: "interior glass wall or glass window between spaces",
  conference_table: "large shared meeting table",
  server_rack: "rack of IT or network equipment",
  roll_up_door: "overhead roll-up or garage door",
  loading_dock: "loading dock or dock door",
  heavy_power: "large electrical panels, 3-phase equipment or heavy-duty outlets",
  grab_bars: "accessibility grab bars",
} as const;

export type Label = keyof typeof ROOM_LABELS;
export type Feature = keyof typeof FEATURES;

// Older answers used a few different names.
const LABEL_ALIASES: Record<string, Label> = { office: "private_office", exam: "exam_room", kitchenette: "break_room" };
export const asLabel = (s: string): Label => (s in ROOM_LABELS ? (s as Label) : LABEL_ALIASES[s] ?? "other");
export const asFeature = (s: string): Feature | null => (s in FEATURES ? (s as Feature) : null);

/** Enclosed rooms that a tenant could use as offices, exam or treatment rooms. */
export const PRIVATE_ROOMS: Label[] = ["private_office", "conference", "consult_room", "exam_room", "treatment_room", "procedure"];
/** Open floor area types. */
export const OPEN_AREAS: Label[] = ["open_workspace", "styling_floor", "nail_floor", "studio", "sales_floor", "showroom", "waiting"];
