import Link from "next/link";

const DEMO_SUITES = [
  { key: "travis_900", label: "6655 Travis St · Suite 900", note: "Former medical suite, Houston" },
  { key: "dairy_550", label: "2000 Dairy Ashford Rd · Suite 550", note: "Three industries over time, Houston" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 p-8">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">SecondLife</p>
        <h1 className="mt-2 text-4xl font-semibold leading-tight text-stone-900">
          Every commercial space remembers who was there.
        </h1>
        <p className="mt-3 text-lg text-stone-600">
          We read a suite&apos;s tenant history, check what&apos;s built into it, and match it to the business that values it most.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/space/travis_900?mode=tenant" className="rounded-xl border border-stone-200 bg-white p-6 hover:border-emerald-500">
          <p className="text-lg font-semibold">I&apos;m looking for space</p>
          <p className="mt-1 text-sm text-stone-500">&quot;I&apos;m a dermatologist, 2,000–3,000 sq ft, Houston&quot;</p>
        </Link>
        <Link href="/space/dairy_550?mode=landlord" className="rounded-xl border border-stone-200 bg-white p-6 hover:border-emerald-500">
          <p className="text-lg font-semibold">I have space to lease</p>
          <p className="mt-1 text-sm text-stone-500">&quot;Who should lease this suite, and for how much?&quot;</p>
        </Link>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-stone-400">Demo suites</p>
        <ul className="mt-2 space-y-1 text-sm">
          {DEMO_SUITES.map((s) => (
            <li key={s.key}>
              <Link className="text-emerald-700 hover:underline" href={`/space/${s.key}?mode=tenant`}>{s.label}</Link>
              <span className="text-stone-400"> · {s.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
