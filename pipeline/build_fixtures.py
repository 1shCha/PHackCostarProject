#!/usr/bin/env python3
"""Build REAL fixtures for one demo suite from the CoStar kit.

Writes fixtures/real/<key>/{suite,history,tenant_mix,pricing}.json in the shapes from contracts/README.md.
Matterport, Vexcel and letter fixtures are not built here (Role 2 / Claude produce those).

Standard library only, so it runs anywhere:
    python3 pipeline/build_fixtures.py
    python3 pipeline/build_fixtures.py --address "2000 Dairy Ashford" --suite 550 --key dairy_550

This is a starting point for Role 1. It is deliberately simple; refine the rules in the real agents.
Nothing it writes may be committed: fixtures/real/ is gitignored because the repo is public.
"""
import argparse
import csv
import json
import os
import re
import statistics
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- helpers ----------

def rows(kit, name):
    with open(os.path.join(kit, "data", name + ".jsonl"), encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def norm_suite(s):
    """'Suite 0900 ' -> '900'. Keeps codes like '2-0100' intact."""
    if not s:
        return None
    t = s.strip().upper()
    t = re.sub(r"^(SUITE|STE\.?|UNIT|#|NO\.?)\s*", "", t).strip()
    t = re.sub(r"^0+(?=\d)", "", t)
    return t or None


def day(ts):
    return ts[:10] if ts else None


def rent_psf_yr(rate, basis):
    """Kit rule: convert using the record's own basis (1 Monthly, 2 Yearly), never by city."""
    if not rate:
        return None
    if basis == 1:
        return round(rate * 12, 2)
    if basis == 2:
        return round(rate, 2)
    return None  # unknown basis: leave out rather than guess


# Build-out categories that matter for SecondLife. Order matters: first match wins.
CATEGORY_KEYWORDS = [
    ("dental", r"dental|dentist|orthodont|endodont|periodont|oral surg|smile"),
    ("dermatology", r"dermatolog|skin|laser|aesthetic|cosmetic|medspa|med spa"),
    ("plastic_surgery", r"plastic surg"),
    ("physical_therapy", r"physical therap|rehab|physiother|chiropract"),
    ("imaging", r"imaging|radiolog|mri\b|diagnostic"),
    ("surgery", r"surgery center|surgical|\basc\b|ambulatory"),
    ("pediatrics", r"pediatric|children"),
    ("orthopedics", r"orthop|sports med|spine"),
    ("medical", r"medical|clinic|health|physician|\bmd\b|doctor|hospital|cardio|oncolog|urolog|obgyn|ob/gyn|women's care|eye|vision|optom|ophthal|pharma"),
    ("restaurant", r"restaurant|cafe|coffee|grill|kitchen|pizza|taco|bakery|bar\b"),
    ("law", r"\blaw\b|attorney|legal|llp\b"),
    ("finance", r"bank|capital|financial|wealth|insurance|invest"),
]
MEDICAL_INDUSTRY = "HealthCareAndSocialAssistance"


def categorize(name, industry):
    n = (name or "").lower()
    for cat, pat in CATEGORY_KEYWORDS:
        if re.search(pat, n):
            return cat, "name"
    if industry == MEDICAL_INDUSTRY:
        return "medical", "industry"
    if industry in (None, "", "Unknown"):
        return "unknown", "none"
    return "office", "industry"


# Same specialty in the building = competition; these pairs help each other (hand-written, small on purpose).
COMPLEMENTS = {
    "dermatology": ["plastic_surgery", "medical", "imaging"],
    "plastic_surgery": ["dermatology", "surgery", "imaging"],
    "orthopedics": ["physical_therapy", "imaging", "surgery"],
    "physical_therapy": ["orthopedics", "imaging"],
    "dental": ["pediatrics"],
    "pediatrics": ["dental", "medical"],
    "imaging": ["orthopedics", "medical", "surgery"],
    "surgery": ["imaging", "orthopedics", "plastic_surgery"],
}
CANDIDATES = ["dermatology", "plastic_surgery", "dental", "orthopedics", "physical_therapy", "imaging", "surgery", "pediatrics"]


# ---------- build ----------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kit", default=os.environ.get("COSTAR_KIT_DIR", os.path.join(ROOT, "data", "kit")))
    ap.add_argument("--address", default="6655 Travis", help="start of the street address")
    ap.add_argument("--suite", default="900")
    ap.add_argument("--key", default="travis_900")
    args = ap.parse_args()

    kit = os.path.abspath(args.kit)
    if not os.path.exists(os.path.join(kit, "data", "location-occupancy.jsonl")):
        raise SystemExit(f"CoStar kit not found at {kit}. Unzip it so data/kit/data/*.jsonl exists, or pass --kit.")
    enums = json.load(open(os.path.join(kit, "schemas", "enums.json")))
    en = lambda t, v: enums.get(t, {}).get(str(v), v)
    want_suite = norm_suite(args.suite)

    # 1. Find the listed space
    listing = space = None
    for r in rows(kit, "commercial-listing-summary"):
        a = r.get("address") or {}
        addr = f"{a.get('streetNumber', '')} {a.get('streetName', '')}"
        if not addr.lower().startswith(args.address.lower()):
            continue
        for s in (r.get("forLeaseSummary") or {}).get("spaces") or []:
            if norm_suite(s.get("suite")) == want_suite:
                listing, space = r, s
                break
        if space:
            break
    if not space:
        raise SystemExit(f"No listed space found for '{args.address}' suite {args.suite}.")
    pid = listing["propertyId"]
    floor_id = space.get("propertyFloorId")
    a = listing.get("address") or {}

    # 2. Property: submarket, matterport model
    prop = next((p for p in rows(kit, "commercial-property") if p["id"] == pid), {})
    submarket = prop.get("primarySubmarketId") or listing.get("primarySubmarketId")
    models = [r["MatterportModelId"] for r in csv.DictReader(open(os.path.join(kit, "commercial-properties.csv")))
              if r["PropertyId"] == str(pid) and r["MatterportModelId"]]

    sqft = space.get("squareFeetMax") or space.get("squareFeetMin")
    suite_out = {
        "key": args.key,
        "property_id": pid,
        "address": f"{a.get('streetNumber', '')} {a.get('streetName', '')} {a.get('streetType', '') or ''}".strip(),
        "building_name": listing.get("buildingName"),
        "city": (a.get("city") or "").title(),
        "suite": space.get("suite", "").strip(),
        "floor": str(en("FloorName", space.get("floorName"))),
        "sqft": sqft,
        "use": en("SpaceUse", space.get("spaceUse")),
        "asking_rent_psf_yr": rent_psf_yr(space.get("rateLow") or space.get("rateHigh"), space.get("rateBasis")),
        "service_type": en("ServiceType", space.get("serviceType")),
        "listing_notes": [n["value"] for n in (space.get("notes") or [])],
        "matterport_model_id": models[0] if models else "",
        "matterport_model_ids": models,
        "lat": a.get("latitude"),
        "lon": a.get("longitude"),
        "submarket_id": submarket,
    }

    # 3. Companies (only fields we need)
    comp = {}
    for r in rows(kit, "company-detail"):
        p = r.get("profile") or {}
        comp[r["id"]] = {
            "name": r.get("name") or p.get("companyName"),
            "industry": en("IndustryType", p.get("industryType", 0)),
            "status": en("LocationBusinessStatus", r.get("businessStatus")),
            "suite": r.get("suite"),
            "employees": r.get("numEmployees"),
        }

    # 4. Tenancies in this building + signed deals for comps
    building_occ, deals = [], []
    prop_submarket = {}
    for p in rows(kit, "commercial-property"):
        prop_submarket[p["id"]] = (p.get("primarySubmarketId"), (p.get("primaryAddress") or {}).get("streetNumber", "") + " " + (p.get("primaryAddress") or {}).get("streetName", ""))
    for o in rows(kit, "location-occupancy"):
        if o["propertyId"] == pid:
            building_occ.append(o)
        d = o.get("leaseDeal") or {}
        if d.get("rateActual"):
            rate = rent_psf_yr(d["rateActual"], d.get("rateBasis"))
            if rate:
                sm, paddr = prop_submarket.get(o["propertyId"], (None, ""))
                t = comp.get(o.get("tenantLocationId"), {})
                cat, _ = categorize(t.get("name"), t.get("industry"))
                deals.append({
                    "property_id": o["propertyId"], "submarket_id": sm, "address": paddr.strip(),
                    "suite": next((s.get("suite", "").strip() for s in o.get("spaces") or [] if s.get("suite")), ""),
                    "signed": day(d.get("signDate") or d.get("commencementDate")),
                    "sqft": sum((s.get("squareFeetOccupied") or 0) for s in o.get("spaces") or []) or None,
                    "rent_psf_yr": rate, "service_type": en("ServiceType", d.get("serviceType")),
                    "industry": t.get("industry"), "category": cat,
                    "free_months": d.get("freeMonths"), "ti_psf": d.get("tenantImprovementAllowancePerSquareFeet"),
                })

    # 5. History with match levels
    timeline, seen = [], set()
    for o in building_occ:
        spaces = o.get("spaces") or []
        t = comp.get(o.get("tenantLocationId"), {})
        own = {norm_suite(s.get("suite")) for s in spaces if s.get("suite")}
        company_suite = norm_suite(t.get("suite"))
        on_floor = any(s.get("propertyFloorId") == floor_id for s in spaces)
        occ_sqft = sum((s.get("squareFeetOccupied") or 0) for s in spaces) or None
        if want_suite in own:
            match, why = "confirmed", f"Tenant record names Suite {args.suite}"
        elif not own and company_suite == want_suite:
            match, why = "confirmed", f"Tenant's address lists Suite {args.suite}"
        elif on_floor and not own and not company_suite:
            score, reasons = 1, ["same floor"]
            if occ_sqft and sqft and abs(occ_sqft - sqft) / sqft <= 0.2:
                score += 2
                reasons.append(f"similar size ({int(occ_sqft):,} vs {int(sqft):,} sq ft)")
            match = "likely" if score >= 3 else "same_floor"
            why = ", ".join(reasons).capitalize()
        else:
            continue
        frm, to = day(o.get("fromDate")), day(o.get("toDate"))
        if frm and to and frm == to:
            continue  # zero-length record: placeholder, not a real tenancy
        dedupe = (o.get("tenantLocationId"), frm)
        if dedupe in seen:
            continue
        seen.add(dedupe)
        cat, _ = categorize(t.get("name"), t.get("industry"))
        timeline.append({
            "tenant": t.get("name") or "Unknown tenant", "industry": t.get("industry") or "Unknown", "category": cat,
            "from": frm, "to": to, "sqft": occ_sqft, "match": match, "why_matched": why,
            "why_ended": en("LocationOccupancyExpirationReason", o.get("expirationReason")) if to else "",
            "multi_suite": len(own) > 1,
        })
    timeline.sort(key=lambda x: x["from"] or "")
    notes = []
    if any(e["sqft"] and sqft and e["sqft"] < 0.6 * sqft for e in timeline if e["match"] == "confirmed"):
        notes.append("The suite is larger today than some past tenancies: history may describe part of the space.")
    if any(e["multi_suite"] for e in timeline):
        notes.append("Some tenancies span several suites; their size is not all in this suite.")
    buildout = []
    for n in suite_out["listing_notes"]:
        if re.search(r"(?i)built[- ]?out|second generation|2nd gen|medical|dental|exam|operating|procedure|plumb|lab", n):
            buildout.append({"feature": n[:140], "source": "listing note", "confidence": "confirmed"})
    for e in timeline:
        if e["category"] not in ("office", "unknown", "law", "finance") and e["match"] != "same_floor":
            buildout.append({"feature": f"{e['category'].replace('_', ' ').title()} build-out from past tenant ({e['tenant']})",
                             "source": "past tenant", "confidence": e["match"]})
    history_out = {"timeline": timeline, "likely_buildout": buildout, "notes": notes}

    # 6. Tenant mix: current, active tenants in the building
    by_cat, unknown, total = defaultdict(list), 0, 0
    for o in building_occ:
        if o.get("toDate"):
            continue
        total += 1
        t = comp.get(o.get("tenantLocationId"))
        if not t:
            unknown += 1
            continue
        if t["status"] not in ("Active", 1):
            continue
        cat, _ = categorize(t["name"], t["industry"])
        sp = (o.get("spaces") or [{}])[0]
        by_cat[cat].append({"name": t["name"], "suite": (sp.get("suite") or t.get("suite") or "").strip(),
                            "floor": str(en("FloorName", sp.get("floorName"))) if sp.get("floorName") else ""})
    present = set(by_cat)
    conflicts = [{"category": c, "reason": f"{len(by_cat[c])} {c.replace('_', ' ')} tenant(s) already in the building"}
                 for c in CANDIDATES if c in present]
    complements = []
    for c in CANDIDATES:
        if c in present:
            continue
        helpers = [h for h in COMPLEMENTS.get(c, []) if h in present]
        if helpers:
            complements.append({"category": c, "reason": f"No {c.replace('_', ' ')} in the building; {', '.join(helpers)} tenants could refer patients"})
    mix_out = {
        "as_of": "last CoStar research (a current tenant may have left since)",
        "total_current": total, "unknown_tenants": unknown,
        "by_category": sorted(({"category": c, "count": len(v), "tenants": v} for c, v in by_cat.items()), key=lambda x: -x["count"]),
        "conflicts": conflicts, "complements": complements,
    }

    # 7. Pricing comps: same building, else same submarket; same service type as the listing when possible
    svc = suite_out["service_type"]
    def pick(pool):
        same_svc = [d for d in pool if d["service_type"] == svc]
        return (same_svc, svc) if len(same_svc) >= 3 else (pool, "all service types")
    basis, pool = "building", [d for d in deals if d["property_id"] == pid]
    if len(pool) < 3:
        basis, pool = "submarket", [d for d in deals if d["submarket_id"] == submarket]
    pool, svc_label = pick(pool)
    pool.sort(key=lambda d: d["signed"] or "", reverse=True)
    rents = sorted(d["rent_psf_yr"] for d in pool)
    pricing_out = {
        "target_rent_psf_yr": round(statistics.median(rents), 2) if rents else None,
        "range_psf_yr": [rents[len(rents) // 4], rents[(len(rents) * 3) // 4]] if len(rents) >= 4 else None,
        "service_type": svc_label, "basis": basis, "n_deals": len(pool),
        "comps": [{k: d[k] for k in ("address", "suite", "signed", "sqft", "rent_psf_yr", "service_type", "industry", "free_months", "ti_psf")}
                  for d in pool[:12]],
        "releasing_value_yr": round(statistics.median(rents) * sqft) if rents and sqft else None,
        "buildout_savings": None,
        "_partial": "Simple median of signed rents. Role 1: weight by recency/size/industry and add build-out savings with a cited cost basis.",
    }

    out = os.path.join(ROOT, "fixtures", "real", args.key)
    os.makedirs(out, exist_ok=True)
    for name, obj in (("suite", suite_out), ("history", history_out), ("tenant_mix", mix_out), ("pricing", pricing_out)):
        with open(os.path.join(out, name + ".json"), "w") as fh:
            json.dump(obj, fh, indent=2)
    print(f"Wrote real fixtures to {out}")
    print(f"  suite: {suite_out['address']} #{suite_out['suite']}, {sqft} sq ft, asking {suite_out['asking_rent_psf_yr']} ({svc})")
    print(f"  history: {len(timeline)} entries ({Counter(e['match'] for e in timeline)})")
    print(f"  tenant mix: {total} current, {unknown} unknown, categories {sorted(present)}")
    print(f"  pricing: {len(pool)} comps ({basis}, {svc_label}), median {pricing_out['target_rent_psf_yr']}")


if __name__ == "__main__":
    main()
