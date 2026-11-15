// An empty card in the agreed shape (data/demo.json is only the shape reference, never shown).
// Anything without a real source stays empty here, and the screens show "not available" instead of inventing it.

import type { Card } from "./index";

export function blankCard(): Card {
  return {
    suite: {
      key: "",
      property_id: 0,
      address: "",
      city: "",
      suite: "",
      floor: "",
      sqft: 0,
      use: "",
      asking_rent_psf_yr: 0,
      service_type: "",
      listing_notes: [],
      matterport_model_id: "",
      lat: 0,
      lon: 0,
    },
    history: { timeline: [], likely_buildout: [], notes: [] },
    inspect: { floorplan: { url: "", width: 1000, height: 600 }, rooms: [], counts: {} as Card["inspect"]["counts"] },
    fit: { checks: [], accessibility: [] },
    site: { image_url: "", captured: "", parking_stalls: null as unknown as number, frontage: "", notes: [] },
    pricing: {
      target_rent_psf_yr: 0,
      range_psf_yr: [0, 0],
      service_type: "",
      basis: "",
      n_deals: 0,
      comps: [],
      releasing_value_yr: 0,
      buildout_savings: { low: 0, high: 0, assumption: "" },
    },
    tenant_mix: { as_of: "", total_current: 0, unknown_tenants: 0, by_category: [], conflicts: [], complements: [] },
    prospects: { companies: [], coverage_note: "" },
    negotiate: { mode: "tenant", subject: "", letter: "", asks: [], fallbacks: [] },
  };
}
