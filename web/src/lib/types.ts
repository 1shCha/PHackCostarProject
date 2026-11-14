// Mirrors contracts/README.md. Change both together.

export type Confidence = "confirmed" | "likely" | "same_floor" | "estimate";

export interface Suite {
  key: string;
  property_id: number;
  address: string;
  building_name?: string;
  city: string;
  suite: string;
  floor: string;
  sqft: number | null;
  use: string;
  asking_rent_psf_yr: number | null;
  service_type: string;
  listing_notes: string[];
  matterport_model_id: string;
  lat: number | null;
  lon: number | null;
}

export interface TimelineEntry {
  tenant: string;
  industry: string;
  category: string;
  from: string | null;
  to: string | null;
  sqft: number | null;
  match: Confidence;
  why_matched: string;
  why_ended: string;
}

export interface History {
  timeline: TimelineEntry[];
  likely_buildout: { feature: string; source: string; confidence: string }[];
  notes: string[];
}

export interface TenantMix {
  as_of: string;
  total_current: number;
  unknown_tenants: number;
  by_category: { category: string; count: number; tenants: { name: string; suite: string; floor: string }[] }[];
  conflicts: { category: string; reason: string }[];
  complements: { category: string; reason: string }[];
}

export interface Comp {
  address: string;
  suite: string;
  signed: string | null;
  sqft: number | null;
  rent_psf_yr: number;
  service_type: string;
  industry: string | null;
  free_months: number | null;
  ti_psf: number | null;
}

export interface Pricing {
  target_rent_psf_yr: number | null;
  range_psf_yr: [number, number] | null;
  service_type: string;
  basis: string;
  n_deals: number;
  comps: Comp[];
  releasing_value_yr: number | null;
  buildout_savings: { low: number; high: number; assumption: string } | null;
}

export interface Prospects {
  companies: {
    name: string; industry: string; category: string; current_address: string;
    lease_expires: string; sqft: number; employees: number; distance_mi: number; reason: string;
  }[];
  coverage_note: string;
}

export interface Feature { type: string; x: number; y: number; pano_url: string }
export interface Room {
  id: string; label: string; display: string; confidence: number;
  area_sqft: number | null; polygon: [number, number][]; features: Feature[];
}
export interface Inspect {
  floorplan: { url: string; width: number; height: number };
  rooms: Room[];
  counts: Record<string, number>;
}

export interface Check { need?: string; check?: string; status: "pass" | "fail" | "unknown"; evidence: string }
export interface Fit { checks: Check[]; accessibility: Check[] }

export interface Site { image_url: string; captured: string; parking_stalls: number; frontage: string; notes: string[] }

export interface Negotiate { mode: string; subject: string; letter: string; asks: string[]; fallbacks: string[] }

type Meta = { _fake?: boolean; _source?: "real" | "placeholder" };

export interface Card {
  suite?: Suite & Meta;
  history?: History & Meta;
  tenant_mix?: TenantMix & Meta;
  pricing?: Pricing & Meta;
  prospects?: Prospects & Meta;
  inspect?: Inspect & Meta;
  fit?: Fit & Meta;
  site?: Site & Meta;
  negotiate?: Negotiate & Meta;
  summary?: string;
}

export interface ProgressEvent {
  type: "progress";
  agent: string;
  status: "working" | "done" | "error";
  message: string;
  field?: keyof Card;
  value?: unknown;
}
export interface ResultEvent { type: "result"; card: Card }
export type AgentEvent = ProgressEvent | ResultEvent;
