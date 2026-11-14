import type { Card, Confidence } from "@/lib/types";
import { FloorPlan } from "./FloorPlan";

const MATCH_STYLE: Record<Confidence, string> = {
  confirmed: "bg-emerald-100 text-emerald-800",
  likely: "bg-sky-100 text-sky-800",
  same_floor: "bg-stone-100 text-stone-600",
  estimate: "bg-amber-100 text-amber-800",
};
const MATCH_LABEL: Record<Confidence, string> = {
  confirmed: "Confirmed", likely: "Likely this suite", same_floor: "Same floor", estimate: "Estimate",
};

function Section({ title, source, children }: { title: string; source?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
        {source === "placeholder" && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">placeholder data</span>
        )}
      </div>
      {children}
    </section>
  );
}

const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

export function SpaceCard({ card }: { card: Card }) {
  const { suite, history, tenant_mix, pricing, prospects, inspect, fit, site, negotiate } = card;

  return (
    <div className="space-y-4">
      {suite && (
        <header className="rounded-xl bg-stone-900 p-6 text-white">
          <p className="text-sm text-stone-400">{suite.building_name || suite.city}</p>
          <h1 className="text-2xl font-semibold">
            {suite.address} · Suite {suite.suite}
          </h1>
          <p className="mt-1 text-stone-300">
            {suite.sqft ? `${Math.round(suite.sqft).toLocaleString()} sq ft` : ""} · {suite.use} · asking {money(suite.asking_rent_psf_yr)}/sf/yr ({suite.service_type})
          </p>
          {card.summary && <p className="mt-4 text-lg leading-snug text-emerald-200">{card.summary}</p>}
        </header>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {history && (
          <Section title="Who was here" source={history._source}>
            <ol className="space-y-3">
              {history.timeline.map((e, i) => (
                <li key={i} className="border-l-2 border-stone-200 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-stone-900">{e.tenant}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${MATCH_STYLE[e.match]}`}>{MATCH_LABEL[e.match]}</span>
                  </div>
                  <p className="text-sm text-stone-500">
                    {e.from?.slice(0, 4)}–{e.to ? e.to.slice(0, 4) : "now"} · {e.category.replace(/_/g, " ")}
                    {e.sqft ? ` · ${Math.round(e.sqft).toLocaleString()} sq ft` : ""}
                  </p>
                  <p className="text-xs text-stone-400">{e.why_matched}</p>
                </li>
              ))}
            </ol>
            {history.likely_buildout.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase text-stone-400">Likely built in</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-stone-700">
                  {history.likely_buildout.map((b, i) => (
                    <li key={i}>{b.feature} <span className="text-stone-400">({b.source})</span></li>
                  ))}
                </ul>
              </div>
            )}
            {history.notes.map((n, i) => <p key={i} className="mt-2 text-xs text-amber-700">{n}</p>)}
          </Section>
        )}

        {inspect && (
          <Section title="Inside the space (3D scan)" source={inspect._source}>
            <FloorPlan data={inspect} />
          </Section>
        )}

        {tenant_mix && (
          <Section title="Who's in the building now" source={tenant_mix._source}>
            <div className="flex flex-wrap gap-2">
              {tenant_mix.by_category.map((c) => (
                <span key={c.category} className="rounded-full bg-stone-100 px-3 py-1 text-sm">
                  {c.category.replace(/_/g, " ")}: <b>{c.count}</b>
                </span>
              ))}
              {tenant_mix.unknown_tenants > 0 && (
                <span className="rounded-full bg-stone-50 px-3 py-1 text-sm text-stone-500">unidentified: {tenant_mix.unknown_tenants}</span>
              )}
            </div>
            {tenant_mix.conflicts.map((c, i) => <p key={i} className="mt-3 text-sm text-rose-700">⚠️ {c.reason}</p>)}
            {tenant_mix.complements.slice(0, 3).map((c, i) => <p key={i} className="mt-2 text-sm text-emerald-700">✓ {c.reason}</p>)}
            <p className="mt-3 text-xs text-stone-400">As of {tenant_mix.as_of}</p>
          </Section>
        )}

        {pricing && (
          <Section title="What it should rent for" source={pricing._source}>
            <p className="text-3xl font-semibold text-stone-900">
              {money(pricing.target_rent_psf_yr)}<span className="text-base font-normal text-stone-500">/sf/yr</span>
            </p>
            <p className="text-sm text-stone-500">
              {pricing.range_psf_yr ? `range ${money(pricing.range_psf_yr[0])}–${money(pricing.range_psf_yr[1])} · ` : ""}
              {pricing.n_deals} signed deals · {pricing.basis} · {pricing.service_type}
            </p>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-stone-400">
                <tr><th>Signed</th><th>Where</th><th>Sq ft</th><th className="text-right">Rent</th></tr>
              </thead>
              <tbody>
                {pricing.comps.slice(0, 6).map((c, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-1">{c.signed?.slice(0, 7) ?? "—"}</td>
                    <td>{c.address} {c.suite && `#${c.suite}`}</td>
                    <td>{c.sqft ? Math.round(c.sqft).toLocaleString() : "—"}</td>
                    <td className="text-right">{money(c.rent_psf_yr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {fit && (
          <Section title="Does it fit" source={fit._source}>
            <ul className="space-y-1 text-sm">
              {[...fit.checks, ...fit.accessibility].map((c, i) => (
                <li key={i}>
                  {c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "❔"} <b>{c.need ?? c.check}</b>{" "}
                  <span className="text-stone-500">{c.evidence}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {site && (
          <Section title="From above (aerial)" source={site._source}>
            {site.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.image_url} alt="Aerial view" className="w-full rounded-lg" />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg bg-stone-100 text-sm text-stone-400">Vexcel image goes here</div>
            )}
            <p className="mt-2 text-sm text-stone-600">{site.parking_stalls} parking stalls · {site.frontage}</p>
          </Section>
        )}

        {prospects && (
          <Section title="Who could lease it next" source={prospects._source}>
            <ul className="space-y-2 text-sm">
              {prospects.companies.map((c, i) => (
                <li key={i}>
                  <b>{c.name}</b> <span className="text-stone-500">· lease ends {c.lease_expires} · {c.sqft.toLocaleString()} sq ft · {c.distance_mi} mi</span>
                  <p className="text-xs text-stone-500">{c.reason}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-stone-400">{prospects.coverage_note}</p>
          </Section>
        )}

        {negotiate && (
          <Section title={negotiate.mode === "landlord" ? "Outreach draft" : "Offer letter draft"} source={negotiate._source}>
            <p className="font-medium">{negotiate.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{negotiate.letter}</p>
            <ul className="mt-3 list-disc pl-5 text-sm">{negotiate.asks.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </Section>
        )}
      </div>
    </div>
  );
}
