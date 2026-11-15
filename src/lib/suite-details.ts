// Real per-suite details from the hosted CoStar database: who's in the building, rent comps, and
// nearby companies in the same kind of business whose leases end soon (the "who should lease next" list).

import "server-only";
import { callBackendTool, usesRemoteBackend } from "./backend";
import { INDUSTRIES } from "./search";

type Tenant = { company_name: string; industry: string | null; suite: string | null; occupied_sqft: number | null; lease_expiration: string | null };
type Deal = { rent_kind: string; rent_psf_yr: number; service_type: string | null; signed_date: string | null; free_months: number | null; ti_psf: number | null };
type NearbyDeal = Deal & { address: string | null; building_name: string | null; distance_mi: number };
type Expiring = {
  company_name: string; industry: string | null; occupied_sqft: number | null; num_employees: number | null;
  lease_expiration: string | null; address: string | null; city: string | null; distance_mi: number;
};

export type SuiteDetailsInput = { property_id: string; latitude: number | null; longitude: number | null; category: string; sqft: number | null };

// "HealthCareAndSocialAssistance" → "Health care and social assistance"
export const readableIndustry = (label: string | null) =>
  label ? label.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bAnd\b/g, "and").replace(/\bOr\b/g, "or").replace(/^./, (c) => c.toUpperCase()) : "Industry not recorded";

export async function suiteDetails(input: SuiteDetailsInput) {
  if (!usesRemoteBackend()) throw new Error("Suite details need the hosted database (BACKEND_API_URL).");
  const industries = INDUSTRIES[input.category] ?? [];
  const sizeLo = input.sqft ? Math.round(input.sqft * 0.6) : null;
  const sizeHi = input.sqft ? Math.round(input.sqft * 1.6) : null;
  const [tenants, comps, expiring] = await Promise.all([
    callBackendTool<{ tenants: Tenant[]; truncated: boolean }>("get_building_tenants", { property_id: input.property_id }),
    callBackendTool<{ building: Deal[]; nearby: NearbyDeal[] }>("get_rent_comps", { property_id: input.property_id }),
    input.latitude !== null && input.longitude !== null
      ? callBackendTool<{ companies: Expiring[] }>("find_expiring_leases", {
          latitude: input.latitude, longitude: input.longitude, industries, sqft_min: sizeLo, sqft_max: sizeHi, radius_miles: 10,
        })
      : Promise.resolve({ companies: [] as Expiring[] }),
  ]);

  // Building tenants grouped by industry; same-kind businesses are the likely referral partners or competitors.
  const groups = new Map<string, Tenant[]>();
  for (const t of tenants.tenants) {
    const key = readableIndustry(t.industry);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const sameKind = tenants.tenants.filter((t) => t.industry && industries.includes(t.industry));
  const tenant_mix = {
    as_of: "CoStar current tenants",
    total_current: tenants.tenants.length,
    unknown_tenants: tenants.tenants.filter((t) => !t.industry).length,
    by_category: [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, list]) => ({ category, count: list.length, tenants: list.slice(0, 6).map((t) => ({ name: t.company_name, suite: t.suite ?? "", floor: "" })) })),
    conflicts: [] as { category: string; reason: string }[],
    complements: sameKind.length
      ? [{ category: readableIndustry(sameKind[0].industry), reason: `${sameKind.length} tenant${sameKind.length > 1 ? "s" : ""} in the same kind of business already here: ${sameKind.slice(0, 3).map((t) => t.company_name).join(", ")}.` }]
      : [],
  };

  // Rent comps: signed deals first (building, then nearby), then the building's asking history.
  const signedHere = comps.building.filter((d) => d.rent_kind === "actual");
  const askingHere = comps.building.filter((d) => d.rent_kind === "asking");
  const toComp = (d: Deal, address: string, suite: string) => ({
    address, suite, signed: d.signed_date ?? "", sqft: 0, rent_psf_yr: d.rent_psf_yr, service_type: d.service_type ?? "",
    industry: d.rent_kind === "actual" ? "signed" : "asking", free_months: d.free_months, ti_psf: d.ti_psf,
  });
  const compsOut = [
    ...signedHere.map((d) => toComp(d, "This building", "")),
    ...comps.nearby.map((d) => toComp({ ...d, rent_kind: "actual" }, `${d.address ?? d.building_name ?? "Nearby"} (${d.distance_mi} mi)`, "")),
    ...askingHere.slice(0, 6).map((d) => toComp(d, "This building", "")),
  ];
  const signedRents = [...signedHere, ...comps.nearby].map((d) => d.rent_psf_yr).sort((a, b) => a - b);
  const median = signedRents.length ? signedRents[Math.floor(signedRents.length / 2)] : null;

  // Who should lease next: nearby same-kind companies with leases ending in the next 24 months.
  const prospects = {
    companies: expiring.companies.map((c) => ({
      name: c.company_name,
      industry: readableIndustry(c.industry),
      category: input.category,
      current_address: [c.address, c.city].filter(Boolean).join(", "),
      lease_expires: c.lease_expiration ?? "",
      sqft: c.occupied_sqft ?? 0,
      employees: c.num_employees ?? 0,
      distance_mi: c.distance_mi,
      reason: `Lease ends ${c.lease_expiration ?? "soon"}${c.occupied_sqft ? `, uses ${Math.round(c.occupied_sqft).toLocaleString()} sq ft` : ""}, ${c.distance_mi} mi away`,
    })),
    coverage_note: "Only companies with a recorded lease expiration are included (about 1 in 9 tenants in CoStar).",
  };

  return {
    tenant_mix,
    comps: compsOut,
    signed_median: median,
    signed_count: signedRents.length,
    prospects,
  };
}

export type SuiteDetails = Awaited<ReturnType<typeof suiteDetails>>;
