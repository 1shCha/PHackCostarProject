// Tenant search: "I'm a barber looking for 1,500–2,000 sq ft in Houston" → ranked real suites.
// Reads listed suites, past tenants and rents from the hosted CoStar API (or local DuckDB), and scores what's
// built in with the Role 2 inspection (data/spatial/inspect_<model>.json) when a suite has been labeled.
//
// Score (0–100) = size fit (30) + past tenants in the same kind of business (30) + what's built in (40).
// Suites without room labels get a neutral built-in score from their building type, and say so.

import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { queryDuckDB } from "./duckdb";
import { callBackendTool, usesRemoteBackend } from "./backend";
import { fitFor } from "./spatial/buildout";
import { profileFor, type Profile } from "./spatial/profiles";

/** Profile category → CoStar industry labels that count as "the same kind of business". */
const INDUSTRIES: Record<string, string[]> = {
  medical: ["HealthCareAndSocialAssistance"],
  dental: ["HealthCareAndSocialAssistance"],
  beauty: ["PersonalServices"],
  legal: ["LawFirms", "ProfessionalScientificAndTechnicalServices"],
  office: ["ProfessionalScientificAndTechnicalServices", "FinancialInstitutions", "Insurance", "RealEstate", "Information",
    "Accountants", "EngineersOrArchitects", "ComputersOrDataProcessing", "ManagementOfCompaniesAndEnterprises", "AdministrativeAndSupportServices"],
  construction: ["EngineersOrArchitects", "Manufacturing", "Wholesaler", "Utilities"],
  industrial: ["Manufacturing", "Wholesaler", "Transportation"],
  food: ["AccommodationAndFoodServices"],
  retail: ["RetailersOrWholesalers"],
  fitness: ["ArtsEntertainmentAndRecreation", "PersonalServices"],
};
/** Building types that suit a category before we've seen inside. */
const GOOD_BUILDINGS: Record<string, string[]> = {
  beauty: ["GeneralRetail"], food: ["GeneralRetail"], retail: ["GeneralRetail"], fitness: ["GeneralRetail", "Flex"],
  construction: ["Industrial", "Flex"], industrial: ["Industrial", "Flex"],
  medical: ["Office"], dental: ["Office"], legal: ["Office"], office: ["Office"],
};
const READABLE: Record<string, string> = {
  HealthCareAndSocialAssistance: "Health care", PersonalServices: "Personal services", LawFirms: "Law firm",
  ProfessionalScientificAndTechnicalServices: "Professional services", FinancialInstitutions: "Finance",
  AccommodationAndFoodServices: "Food service", RetailersOrWholesalers: "Retail", RealEstate: "Real estate",
};
const readable = (label: string | null) => (label ? READABLE[label] ?? label.replace(/([a-z])([A-Z])/g, "$1 $2") : "Unknown industry");

export type SearchQuery = { business: string; sqft_min: number | null; sqft_max: number | null; city: string | null };

/** Pulls size and city out of a sentence. The whole sentence is used to pick the business profile. */
export function parseQuery(text: string): SearchQuery {
  const t = text.toLowerCase().replace(/,(?=\d{3})/g, "");
  const num = (n: string, k?: string) => Math.round(parseFloat(n) * (k ? 1000 : 1));
  const range = t.match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(k)?/);
  const single = t.match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:sq\.?\s*f(?:ee|oo)?t|sf|square)/);
  let sqft_min: number | null = null, sqft_max: number | null = null;
  if (range) {
    sqft_min = num(range[1], range[2] ?? range[4]);
    sqft_max = num(range[3], range[4]);
  } else if (single) {
    const n = num(single[1], single[2]);
    [sqft_min, sqft_max] = [Math.round(n * 0.8), Math.round(n * 1.2)];
  }
  if (sqft_min !== null && sqft_max !== null && sqft_min > sqft_max) [sqft_min, sqft_max] = [sqft_max, sqft_min];
  const city = /\bhouston\b/.test(t) ? "Houston" : /\b(los angeles|l\.?a\.?)\b/.test(t) ? "Los Angeles" : null;
  return { business: text, sqft_min, sqft_max, city };
}

function savedInspection(modelId: string | null) {
  if (!modelId || !/^[A-Za-z0-9]{6,20}$/.test(modelId)) return null;
  const file = path.join(process.cwd(), "data", "spatial", `inspect_${modelId}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

type Row = {
  suite_id: string; suite: string; city: string; sqft: number; building_name: string | null; street: string | null;
  property_type: string | null; model_ids: string[] | null; latitude: number | null; longitude: number | null;
  asking: number | null; signed: number | null; n_signed: string | number | null; past: { company: string | null; industry: string | null; from: string | null; to: string | null }[] | null;
};

async function candidates(q: SearchQuery): Promise<Row[]> {
  if (usesRemoteBackend()) {
    return callBackendTool<Row[]>("search_candidates", { sqft_min: q.sqft_min, sqft_max: q.sqft_max, city: q.city });
  }
  // 15% slack on each side so a 1,450 sf suite still shows for "1,500–2,000".
  const lo = q.sqft_min !== null ? q.sqft_min * 0.85 : 0;
  const hi = q.sqft_max !== null ? q.sqft_max * 1.15 : 1e9;
  return (await queryDuckDB(`
    WITH listed AS (
      SELECT suite_id, max(coalesce(square_feet_max, square_feet_min)) AS sqft
      FROM suite_listing_links GROUP BY suite_id),
    picked AS (
      SELECT s.suite_id, s.suite_normalized AS suite, s.city, l.sqft, s.property_id, p.building_name, p.property_type_label AS property_type,
        p.latitude, p.longitude,
        trim(concat_ws(' ', json_extract_string(p.address, '$.streetNumber'), json_extract_string(p.address, '$.streetDirection'),
          json_extract_string(p.address, '$.streetName'), json_extract_string(p.address, '$.streetType'))) AS street
      FROM listed l JOIN suites s USING (suite_id) JOIN properties p USING (property_id)
      WHERE l.sqft BETWEEN ? AND ? AND (?::VARCHAR IS NULL OR lower(s.city) = lower(?::VARCHAR))),
    scan AS (
      SELECT pk.suite_id, list(DISTINCT m.model_id ORDER BY m.model_id) AS model_ids
      FROM picked pk JOIN property_models pm ON pm.property_id = pk.property_id JOIN matterport_models m USING (model_id)
      WHERE normalize_suite(m.name) = pk.suite AND m.room_count > 1 GROUP BY pk.suite_id),
    asking AS (
      SELECT dl.suite_id, median(r.annual_per_sqft_low) AS asking
      FROM suite_deal_links dl JOIN rent_evidence r USING (evidence_id)
      WHERE dl.match_status = 'supported' AND r.rent_kind = 'asking' AND r.is_usable AND r.period_label = 'Yearly'
      GROUP BY dl.suite_id),
    signed AS (
      SELECT property_id, median(annual_per_sqft_low) AS signed, count(*) AS n_signed FROM rent_evidence
      WHERE rent_kind = 'actual' AND is_usable AND period_label = 'Yearly' GROUP BY property_id),
    past AS (
      SELECT suite_id, list({company: company_name, industry: resolved_industry_label,
        "from": strftime(timeline_start, '%Y-%m-%d'), "to": strftime(to_date, '%Y-%m-%d')} ORDER BY timeline_start) AS past
      FROM suite_history GROUP BY suite_id)
    SELECT pk.suite_id, pk.suite, pk.city, pk.sqft, pk.building_name, pk.street, pk.property_type, pk.latitude, pk.longitude,
      sc.model_ids, a.asking, sg.signed, sg.n_signed, ps.past
    FROM picked pk LEFT JOIN scan sc USING (suite_id) LEFT JOIN asking a USING (suite_id)
      LEFT JOIN signed sg ON sg.property_id = pk.property_id LEFT JOIN past ps USING (suite_id)`,
    [lo, hi, q.city, q.city])) as unknown as Row[];
}

function sizeScore(sqft: number, q: SearchQuery) {
  if (q.sqft_min === null || q.sqft_max === null) return 30;
  if (sqft >= q.sqft_min && sqft <= q.sqft_max) return 30;
  return 15; // within the 15% slack
}

function rank(r: Row, q: SearchQuery, profile: Profile) {
  const want = INDUSTRIES[profile.category] ?? [];
  // CoStar can hold several records for one tenancy: merge them per company (earliest start, latest end).
  const merged = new Map<string, NonNullable<Row["past"]>[number]>();
  for (const p of r.past ?? []) {
    if (!p.company && !p.industry) continue;
    const key = (p.company ?? `unnamed-${p.industry}-${p.from}`).toLowerCase();
    const prev = merged.get(key);
    if (!prev) merged.set(key, { ...p });
    else {
      if (p.from && (!prev.from || p.from < prev.from)) prev.from = p.from;
      prev.to = !prev.to || !p.to ? null : p.to > prev.to ? p.to : prev.to; // no end date = still there
      prev.industry ??= p.industry;
    }
  }
  const past = [...merged.values()].sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
  const same = past.filter((p) => p.industry && want.includes(p.industry)).reverse(); // most recent first
  const history = same.length ? 30 : past.some((p) => p.industry) ? 5 : 10; // unknown history is better than a mismatch
  // A suite can have several scans with the same name: prefer one we've labeled.
  const modelId = (r.model_ids ?? []).find((m) => savedInspection(m)) ?? r.model_ids?.[0] ?? null;
  const inspection = savedInspection(modelId);
  const fit = inspection ? fitFor(inspection, profile, same.map((p) => ({
    tenant: p.company ?? "Past tenant", category: profile.category, from: p.from ?? "", to: p.to ?? "" }))) : null;
  const goodBuilding = (GOOD_BUILDINGS[profile.category] ?? []).includes(r.property_type ?? "");
  const built = fit ? Math.round(fit.score * 0.4) : goodBuilding ? 25 : 15;
  const score = sizeScore(r.sqft, q) + history + built;

  const reasons: string[] = [];
  if (same.length) reasons.push(`Past ${readable(same[0].industry).toLowerCase()} tenant: ${same[0].company ?? "name not recorded"}${same[0].from ? ` (${same[0].from.slice(0, 4)}${same[0].to ? `–${same[0].to.slice(0, 4)}` : ""})` : ""}`);
  if (fit) {
    const passed = fit.checks.filter((c) => c.status === "pass").length;
    reasons.push(`${passed} of ${fit.checks.length} ${profile.name.toLowerCase()} needs already in the scan`);
    if (fit.buildout.already_in_place.high) reasons.push(fit.buildout.already_in_place.summary);
  } else if (modelId) reasons.push("3D scan available; rooms not labeled yet");
  else reasons.push("No 3D scan for this suite");
  if (goodBuilding && !fit) reasons.push(`${r.property_type} building suits a ${profile.name.toLowerCase()}`);

  return {
    suite_id: r.suite_id,
    model_id: modelId,
    address: r.street || r.building_name || "Address not recorded",
    building: r.building_name,
    suite: `Suite ${r.suite}`,
    city: r.city,
    latitude: r.latitude === null ? null : Number(r.latitude), // building location, for the aerial map
    longitude: r.longitude === null ? null : Number(r.longitude),
    sqft: Math.round(r.sqft),
    property_type: r.property_type,
    asking_rent: r.asking !== null ? Math.round(r.asking * 100) / 100 : null, // $/sf/yr
    signed_rent_in_building: r.signed !== null ? Math.round(r.signed * 100) / 100 : null,
    signed_deals_in_building: Number(r.n_signed ?? 0),
    past_tenants: past.map((p) => ({ company: p.company, industry: readable(p.industry), from: p.from, to: p.to })),
    same_kind_before: same.length > 0,
    scan: (modelId ? (inspection ? "labeled" : "scanned") : "none") as "labeled" | "scanned" | "none",
    fit, // full fit for this business (null when the suite has no room labels)
    inspect: inspection as unknown, // room labels for the Space Card (null when not labeled)
    score,
    score_parts: { size: sizeScore(r.sqft, q), history, built_in: built },
    reasons,
  };
}

const SCAN_ORDER = { labeled: 0, scanned: 1, none: 2 } as const;

export type SearchResponse = Awaited<ReturnType<typeof searchSpaces>>;
export type SearchResult = SearchResponse["results"][number];

export async function searchSpaces(text: string, limit = 8) {
  const q = parseQuery(text);
  const [profile, rows] = await Promise.all([profileFor(text), candidates(q)]);
  const ranked = rows.map((r) => rank(r, q, profile))
    .sort((a, b) => b.score - a.score || SCAN_ORDER[a.scan] - SCAN_ORDER[b.scan] || a.sqft - b.sqft);
  return {
    query: q,
    profile: { key: profile.key, name: profile.name, category: profile.category },
    total: ranked.length,
    results: ranked.slice(0, limit).map((r, i) => ({
      ...r,
      badge: i === 0 ? "Best match" : r.score >= 70 ? "Good fit" : "Possible",
    })),
    notes: [
      "Rents and past tenants come from CoStar; built-in features come from Matterport scans labeled by SecondLife.",
      "Build-out dollar figures are rough assumptions (src/lib/spatial/profiles.ts), not quotes.",
    ],
  };
}
