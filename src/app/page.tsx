import { runAll } from "@/agents";
import { Tour3D } from "@/components/Tour3D";

// The Space Card. Runs every agent on the server and shows the results.
export default async function Home() {
  const card = await runAll("travis_900");
  const { suite, history, tenant_mix, pricing, prospects, inspect, negotiate } = card;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="rounded-xl bg-stone-900 p-6 text-white">
        <p className="text-sm text-stone-400">SecondLife</p>
        <h1 className="text-2xl font-semibold">{suite.address} · Suite {suite.suite}</h1>
        <p className="text-stone-300">
          {suite.sqft.toLocaleString()} sq ft · {suite.use} · asking ${suite.asking_rent_psf_yr}/sf/yr
        </p>
      </header>

      <Box title="Walk through the space">
        <Tour3D modelId={suite.matterport_model_id} title={`Suite ${suite.suite}`} />
      </Box>

      <Box title="Who was here">
        {history.timeline.map((t, i) => (
          <p key={i}>
            <b>{t.tenant}</b> · {t.from.slice(0, 4)}–{t.to.slice(0, 4)} · {t.category} <Tag>{t.match}</Tag>
          </p>
        ))}
      </Box>

      <Box title="Inside the space">
        {inspect.rooms.map((r) => (
          <p key={r.id}>{r.display} ({Math.round(r.confidence * 100)}%) {r.features.map((f) => f.type).join(", ")}</p>
        ))}
      </Box>

      <Box title="Who's in the building">
        {tenant_mix.conflicts.map((c, i) => <p key={i} className="text-rose-700">⚠️ {c.reason}</p>)}
        {tenant_mix.complements.map((c, i) => <p key={i} className="text-emerald-700">✓ {c.reason}</p>)}
      </Box>

      <Box title="What it should rent for">
        <p className="text-2xl font-semibold">${pricing.target_rent_psf_yr}/sf/yr</p>
        <p className="text-sm text-stone-500">from {pricing.n_deals} signed deals</p>
      </Box>

      <Box title="Who could lease it next">
        {prospects.companies.map((c, i) => <p key={i}><b>{c.name}</b> · lease ends {c.lease_expires}</p>)}
      </Box>

      <Box title="Offer letter">
        <p className="font-medium">{negotiate.subject}</p>
        <p className="text-sm">{negotiate.letter}</p>
      </Box>
    </main>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-2 text-sm font-semibold uppercase text-stone-500">{title}</h2>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-stone-100 px-1.5 text-xs text-stone-600">{children}</span>;
}
