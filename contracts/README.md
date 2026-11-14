# Agent contracts

Every agent returns JSON in exactly these shapes. The frontend and orchestrator depend on them.
**Changing a shape? Tell the team in Discord first, then update this file and `web/src/lib/types.ts`.**

Example values for each live in `fixtures/demo/travis_900/<name>.json`.

Conventions:
- Rent is always **dollars per square foot per year** (`*_psf_yr`), with its `service_type` named.
- Every fact that came from a guess or inference carries a `confidence`: `"confirmed" | "likely" | "same_floor" | "estimate"`.
- Invented placeholder values carry `"_fake": true`.

---

## Role 1 · CoStar Brain

### `suite(property_id, suite)` → `suite.json`
```json
{ "key": "travis_900", "property_id": 0, "address": "", "city": "Houston", "suite": "900",
  "floor": "9", "sqft": 0, "use": "OfficeMedical",
  "asking_rent_psf_yr": 0, "service_type": "FullService",
  "listing_notes": [""], "matterport_model_id": "", "lat": 0, "lon": 0 }
```

### `history(property_id, suite)` → `history.json`
```json
{ "timeline": [ { "tenant": "", "industry": "", "category": "medical",
                  "from": "YYYY-MM-DD", "to": "YYYY-MM-DD | null", "sqft": 0,
                  "match": "confirmed | likely | same_floor", "why_matched": "", "why_ended": "" } ],
  "likely_buildout": [ { "feature": "", "source": "listing note | past tenant | scan", "confidence": "" } ],
  "notes": [""] }
```

### `tenant_mix(property_id)` → `tenant_mix.json`
```json
{ "as_of": "last CoStar research", "total_current": 0, "unknown_tenants": 0,
  "by_category": [ { "category": "dental", "count": 0, "tenants": [ { "name": "", "suite": "", "floor": "" } ] } ],
  "conflicts": [ { "category": "", "reason": "" } ],
  "complements": [ { "category": "", "reason": "" } ] }
```

### `pricing(property_id, suite, industry)` → `pricing.json`
```json
{ "target_rent_psf_yr": 0, "range_psf_yr": [0, 0], "service_type": "",
  "basis": "building | submarket | city", "n_deals": 0,
  "comps": [ { "address": "", "suite": "", "signed": "YYYY-MM-DD", "sqft": 0, "rent_psf_yr": 0,
               "service_type": "", "industry": "", "free_months": null, "ti_psf": null } ],
  "releasing_value_yr": 0, "buildout_savings": { "low": 0, "high": 0, "assumption": "" } }
```

### `prospects(property_id, suite)` → `prospects.json`
```json
{ "companies": [ { "name": "", "industry": "", "category": "", "current_address": "",
                   "lease_expires": "YYYY-MM-DD", "sqft": 0, "employees": 0, "distance_mi": 0,
                   "reason": "" } ],
  "coverage_note": "Only tenants with a known lease expiration are searched." }
```

### `negotiate(mode, context)` → `negotiate.json`
```json
{ "mode": "tenant | landlord", "subject": "", "letter": "", "asks": [""], "fallbacks": [""] }
```

## Role 2 · Spatial Eyes

### `inspect(model_id)` → `inspect.json`
Pixel coordinates are in the floor plan image's own pixel space (origin top-left).
```json
{ "floorplan": { "url": "", "width": 0, "height": 0 },
  "rooms": [ { "id": "", "label": "exam_room", "display": "Exam room", "confidence": 0.0,
               "area_sqft": 0, "polygon": [[0,0],[0,0],[0,0]],
               "features": [ { "type": "sink", "x": 0, "y": 0, "pano_url": "" } ] } ],
  "counts": { "exam_room": 0, "sink": 0 } }
```

### `fit(model_id, needs)` → `fit.json`
```json
{ "checks": [ { "need": "", "status": "pass | fail | unknown", "evidence": "" } ],
  "accessibility": [ { "check": "", "status": "pass | fail | unknown", "evidence": "" } ] }
```

### `site(lat, lon)` → `site.json`
```json
{ "image_url": "", "captured": "YYYY-MM-DD", "parking_stalls": 0, "frontage": "", "notes": [""] }
```

## Orchestrator → frontend

### Progress events (streamed from `POST /run`, Server-Sent Events)
```json
{ "type": "progress", "agent": "History", "status": "working | done | error", "message": "" }
```
### Final result
```json
{ "type": "result", "card": { "suite": {}, "history": {}, "tenant_mix": {}, "pricing": {},
                               "prospects": {}, "inspect": {}, "fit": {}, "site": {},
                               "negotiate": {}, "summary": "" } }
```
