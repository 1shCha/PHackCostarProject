"use client";

// SecondLife app screens (design from Figma). Real data arrives through the `card` prop.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "@/agents";
import AskSpace from "@/components/AskSpace";
import VoiceLayer, { type NavCommand } from "@/components/VoiceLayer";
import AerialMap, { SUITE_900, type AerialPin } from "@/components/AerialMap";
import { Tour3D } from "./Tour3D";
import type { SearchResponse, SearchResult } from "@/lib/search";
import type { SuiteDetails } from "@/lib/suite-details";

type Mode = "tenant" | "landlord";
type Screen = "home" | "agents" | "results" | "space" | "offer" | "landlord" | "outreach";
type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "eye"
  | "layers"
  | "map"
  | "scan"
  | "spark";

const paths: Record<IconName, React.ReactNode> = {
  arrow: (
    <>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: (
    <>
      <path d="m7 7 10 10" />
      <path d="m17 7-10 10" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3-9 5 9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <path d="M8 12h8M12 8v8" />
    </>
  ),
  spark: <path d="m12 2 1.5 5.1L18 10l-4.5 2.9L12 18l-1.5-5.1L6 10l4.5-2.9L12 2Z" />,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Logo() {
  return (
    <div className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
      <svg viewBox="0 0 38 38" aria-hidden="true">
        <path d="M7 27V12l12-6 12 6v15l-12 6-12-6Z" fill="#5E2B35" />
        <path d="M12 25V15l7-3.5 7 3.5v10l-7 3.5L12 25Z" fill="#A9CCE0" />
        <path d="M19 11.5v17" stroke="#5E2B35" strokeWidth="2" />
      </svg>
      <span>SecondLife</span>
    </div>
  );
}

function Source({
  source,
  confidence = "Confirmed",
  dark = false,
}: {
  source: string;
  confidence?: "Confirmed" | "Likely" | "Unknown";
  dark?: boolean;
}) {
  return (
    <span
      className={`source-pair ${dark ? "on-dark" : ""}`}
      title={`${source} record · ${confidence.toLowerCase()} confidence`}
    >
      <span>{source}</span>
      <b className={confidence.toLowerCase()}>{confidence}</b>
    </span>
  );
}

function Header({
  mode,
  setMode,
  goHome,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  goHome: () => void;
}) {
  return (
    <header className="topbar">
      <button className="logo-button" onClick={goHome} aria-label="SecondLife home">
        <Logo />
      </button>
      <div className="mode-toggle" aria-label="Choose your journey">
        <button className={mode === "tenant" ? "active" : ""} onClick={() => setMode("tenant")}>
          I’m looking for space
        </button>
      </div>
    </header>
  );
}

function Back({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button className="back" onClick={onClick}>
      <Icon name="arrow" /> {label}
    </button>
  );
}

function Footer() {
  return (
    <footer>
      <Logo />
      <span>Built for CoStar’s AI for the Built World track</span>
      <span>Evidence, not guesswork.</span>
    </footer>
  );
}

function LayersStrip() {
  return (
    <div className="layers-strip">
      <div>
        <span className="layer-icon">
          <Icon name="clock" />
        </span>
        <p>
          <b>What was here</b>
          <small>Lease history · CoStar</small>
        </p>
      </div>
      <Icon name="chevron" />
      <div>
        <span className="layer-icon">
          <Icon name="scan" />
        </span>
        <p>
          <b>What’s built in</b>
          <small>Rooms & features · 3D scan</small>
        </p>
      </div>
      <Icon name="chevron" />
      <div>
        <span className="layer-icon">
          <Icon name="map" />
        </span>
        <p>
          <b>How people get there</b>
          <small>Access & parking · aerial</small>
        </p>
      </div>
    </div>
  );
}

function Home({
  mode,
  start,
  query,
  setQuery,
}: {
  mode: Mode;
  start: () => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  return (
    <main className="home">
      <section className="hero">
        <div className="eyebrow">
          <Icon name="spark" size={16} /> Space intelligence, not just listings
        </div>

            <h1>
              Every commercial space remembers <em>who was there.</em>
            </h1>
            <p className="hero-sub">
              We connect lease history, 3D scans and aerial context to find the business that values
              a space most.
            </p>
            <div className="search-card">
              <div>
                <label>Describe your ideal space</label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && start()}
                  aria-label="Describe your ideal space"
                />
              </div>
              <button className="primary" onClick={start}>
                Find my space <Icon name="chevron" />
              </button>
            </div>
          
        <p className="broker-note">
          <span>
            <Icon name="check" size={14} />
          </span>{" "}
          SecondLife drafts. Your broker reviews and sends.
        </p>
      </section>
      <LayersStrip />
      <section className="home-proof">
        <span>One address, three evidence layers</span>
        <p>See what a listing alone can’t tell you.</p>
      </section>
    </main>
  );
}

const agents = [
  ["History agent", "Reading CoStar tenant history for each suite", "clock"],
  ["Space Inspector", "Checking which suites have 3D scans and room labels", "scan"],
  ["Fit agent", "Matching labeled rooms to what your business needs", "check"],
  ["Site agent", "Loading Vexcel aerial imagery", "map"],
  ["Pricing agent", "Reading asking and signed rents from CoStar", "layers"],
] as const;

function AgentRoom({ mode, done, back }: { mode: Mode; done: () => void; back: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const progress = window.setInterval(() => setStep((s) => Math.min(s + 1, 5)), 520);
    const next = window.setTimeout(done, 3200);
    return () => {
      window.clearInterval(progress);
      window.clearTimeout(next);
    };
  }, [done]);
  return (
    <main className="page narrow agents-page">
      <Back onClick={back} />
      <div className="agent-heading">
        <div className="agent-pulse">
          <Icon name="spark" size={24} />
        </div>
        <div>
          <p className="kicker">Your agent team is working</p>
          <h1>
            {mode === "tenant"
              ? "Reading between the listings."
              : "Finding the next life for your space."}
          </h1>
        </div>
      </div>
      <p className="muted">
        Five specialists are connecting history, physical space and market evidence.
      </p>
      <div className="agent-list">
        {agents.map(([name, finding, icon], i) => {
          const state = i < step ? "done" : i === step ? "running" : "waiting";
          return (
            <div className={`agent-row ${state}`} key={name}>
              <span className="agent-icon">
                <Icon name={icon} />
              </span>
              <div>
                <h3>{name}</h3>
                <p>{state === "waiting" ? "Waiting for evidence…" : finding}</p>
              </div>
              <span className="status">
                {state === "done" ? (
                  <>
                    <Icon name="check" size={14} /> Done
                  </>
                ) : state === "running" ? (
                  "Running"
                ) : (
                  "Queued"
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="progress">
        <span style={{ width: `${Math.max(8, step * 20)}%` }} />
      </div>
      <button className="text-button" onClick={done}>
        Skip to matches <Icon name="chevron" />
      </button>
    </main>
  );
}


// ---------- Live search (GET /api/search, see src/lib/search.ts) ----------
type SearchState =
  | { status: "loading" }
  | { status: "done"; data: SearchResponse }
  | { status: "error"; error: string };

/** Share of a suite's recorded history that was the same kind of business / other / not recorded. */
function LiveRibbon({ r }: { r: SearchResult }) {
  const known = r.past_tenants.length;
  const same = r.same_kind_before ? Math.max(1, Math.round((r.past_tenants.length / Math.max(known, 1)) * 0.6 * 100)) : 0;
  const other = known ? 80 - same : 0;
  return (
    <div className="history-ribbon" title="Space history by industry">
      <span className="medical" style={{ width: `${same}%` }} />
      <span className="office" style={{ width: `${other}%` }} />
      <span className="vacant" />
    </div>
  );
}

/** Turns a search result into the Space Card's data: real suite, history, rooms and fit; the rest from the base card. */
function cardFor(r: SearchResult | null, base: Card, details: SuiteDetails | null = null): Card {
  if (!r) return base;
  const rent = r.asking_rent ?? r.signed_rent_in_building;
  return {
    ...base,
    suite: {
      ...base.suite,
      key: r.suite_id,
      address: r.address,
      city: r.city,
      suite: r.suite.replace(/^Suite /, ""),
      sqft: r.sqft,
      use: r.property_type ?? base.suite.use,
      asking_rent_psf_yr: (r.asking_rent ?? base.suite.asking_rent_psf_yr) as number,
      listing_notes: r.reasons,
      matterport_model_id: (r.model_id ?? "") as string,
      lat: r.latitude ?? base.suite.lat,
      lon: r.longitude ?? base.suite.lon,
    },
    history: {
      ...base.history,
      timeline: r.past_tenants.map((p) => ({
        ...base.history.timeline[0],
        tenant: p.company ?? "Tenant name not recorded",
        industry: p.industry,
        category: "",
        from: p.from ?? "",
        to: p.to as string,
        why_matched: "",
        why_ended: "",
      })),
      likely_buildout: [],
    },
    inspect: (r.inspect as Card["inspect"]) ?? {
      ...base.inspect,
      floorplan: { url: "", width: 1000, height: 600 },
      rooms: [],
      counts: {} as Card["inspect"]["counts"],
    },
    // No labeled scan: no room checks (never Suite 900's medical checklist).
    fit: (r.fit as unknown as Card["fit"]) ?? ({ checks: [], accessibility: [] }),
    prospects: details?.prospects ?? { companies: [], coverage_note: "Nearby companies with leases ending soon aren't available right now." },
    site: { ...base.site, parking_stalls: null as unknown as number, notes: [], frontage: "" },
    pricing: {
          ...base.pricing,
          target_rent_psf_yr: (rent ?? base.pricing.target_rent_psf_yr) as number,
          range_psf_yr: (() => {
            const pts = [details?.signed_median, r.signed_rent_in_building, r.asking_rent, rent].filter((n): n is number => typeof n === "number" && n > 0);
            return (pts.length ? [Math.min(...pts), Math.max(...pts)] : [0, 0]) as [number, number];
          })(),
          basis: details ? "and around this building (2 mi)" : "this building",
          n_deals: details ? details.signed_count : r.signed_deals_in_building,
          comps: (details?.comps ?? []) as unknown as Card["pricing"]["comps"],
          buildout_savings: r.fit
            ? { ...base.pricing.buildout_savings, low: r.fit.buildout.already_in_place.low, high: r.fit.buildout.already_in_place.high,
                assumption: "Build-out already in place for this business, from the scan (rough assumed unit costs)" }
            : { low: 0, high: 0, assumption: "No labeled scan for this suite, so built-in value isn't estimated." },
        },
    // Building neighbors and the letter are Suite 900 samples until Role 1 / Role 3 fill them for every suite.
    tenant_mix: details?.tenant_mix ?? { ...base.tenant_mix, by_category: [], conflicts: [], complements: [], total_current: 0, unknown_tenants: 0 },
    negotiate: {
          ...base.negotiate,
          subject: `Letter of intent: ${r.suite}`,
          asks: [
            rent ? `Base rent ${money(Math.min(rent, r.signed_rent_in_building ?? rent))}/sf/yr` : "Base rent at the building's signed level",
            "3 months free rent",
            r.fit && r.fit.buildout.to_add.high ? `Landlord contribution toward ${r.fit.buildout.to_add.summary.replace(/ to add.*/, "")} of missing build-out` : "Use existing build-out as-is",
          ],
        },
  };
}

function Results({
  search,
  back,
  open,
}: {
  search: SearchState;
  back: () => void;
  open: (r: SearchResult | null) => void;
}) {
  if (search.status === "loading") {
    return (
      <main className="page results-page">
        <Back onClick={back} label="Change search" />
        <p className="kicker">Searching CoStar listings, tenant history and 3D scans…</p>
      </main>
    );
  }
  if (search.status === "error") {
    return (
      <main className="page results-page">
        <Back onClick={back} label="Change search" />
        <p className="kicker">Search unavailable</p>
        <h1>We couldn’t reach the CoStar database.</h1>
        <p>{search.error} Try again in a moment.</p>
      </main>
    );
  }
  const { data } = search;
  const range = data.query.sqft_min !== null ? `${data.query.sqft_min.toLocaleString()}–${data.query.sqft_max?.toLocaleString()} sq ft` : "any size";
  return (
    <main className="page results-page">
      <Back onClick={back} label="Change search" />
      <div className="page-title-row">
        <div>
          <p className="kicker">
            {data.results.length} of {data.total} listed spaces worth a closer look
          </p>
          <h1>Ranked for a {data.profile.name.toLowerCase()}.</h1>
          <p>Ranked by size, who was there before, and what is already built in.</p>
        </div>
        <div className="filter-button">
          {data.query.city ?? "Houston & LA"} · {range}
        </div>
      </div>
      {data.results.length === 0 && <p>No listed spaces match that size. Try a wider range.</p>}
      {/* A clear window onto the background aerial, where the result pins sit */}
      <div className="results-window" aria-hidden="true" />
      <div className="result-grid">
        {data.results.map((r, i) => {
          const level = i === 0 ? "best" : r.badge === "Good fit" ? "good" : "possible";
          const unknown = r.scan !== "labeled";
          const latest = r.past_tenants[r.past_tenants.length - 1];
          const buildReason = r.reasons.find((x) => /needs already|build-out|scan/.test(x));
          return (
            <article className={`result-card ${level}`} key={r.suite_id} onClick={() => open(r)}>
              <div className="card-top">
                <span className="match-badge">{i === 0 ? "✦ Best match" : r.badge}</span>
                <span className="score">{r.score}% fit</span>
              </div>
              <h2>{r.address}</h2>
              <p className="suite">
                {r.suite} · {r.city}
              </p>
              <LiveRibbon r={r} />
              <div className="ribbon-key">
                <span>Same kind</span>
                <span>Other</span>
                <span>Vacant</span>
              </div>
              <p className="result-detail">
                {r.same_kind_before
                  ? r.reasons[0]
                  : latest
                    ? `Last recorded: ${latest.company ?? "tenant"} (${latest.industry})`
                    : "No recorded tenant history"}
              </p>
              <div className={`build-proof ${unknown ? "unknown-box" : ""}`}>
                <Icon name={unknown ? "eye" : "scan"} />
                <span>
                  {r.scan === "labeled" ? buildReason : r.scan === "scanned" ? "3D scan available, rooms not labeled yet" : "No 3D scan for this space yet"}
                  <Source source="Matterport scan" confidence={r.scan === "labeled" ? "Confirmed" : "Unknown"} />
                </span>
              </div>
              <div className="result-numbers">
                <div>
                  <b>{r.sqft.toLocaleString()}</b>
                  <small>sq ft</small>
                </div>
                <div>
                  <b>{r.asking_rent ? money(r.asking_rent) : "—"}</b>
                  <small>/sf/yr asking</small>
                </div>
              </div>
              <p className="deal-line">
                Tenants in this building signed <b>{r.signed_rent_in_building ? `${money(r.signed_rent_in_building)}/sf/yr` : "not recorded"}</b>
              </p>
              <Source source="CoStar" confidence={r.asking_rent ? "Confirmed" : "Unknown"} />
              <div className="top-reason">
                <Icon name="spark" size={15} />
                <span>
                  <b>Why it fits</b>
                  {r.fit ? r.fit.buildout.already_in_place.summary : r.reasons[r.reasons.length - 1]}
                </span>
              </div>
              <button className={i === 0 ? "primary full" : "secondary full"} onClick={() => open(r)}>
                {i === 0 ? "Explore this space" : "View evidence"} <Icon name="chevron" />
              </button>
            </article>
          );
        })}
      </div>
    </main>
  );
}


/** 3×3 live Vexcel tiles centered on a building, with a pin. */
function VexcelTiles({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  if (!lat || !lon) return <div className="vexcel-tiles empty">No coordinates for this building.</div>;
  const z = 18;
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x0 = Math.floor(fx) - 1;
  const y0 = Math.floor(fy) - 1;
  const pinX = ((fx - x0) / 3) * 100;
  const pinY = ((fy - y0) / 3) * 100;
  return (
    <div className="vexcel-tiles" role="img" aria-label={`Vexcel aerial around ${label}`}>
      {[0, 1, 2].flatMap((dy) =>
        [0, 1, 2].map((dx) => (
          // eslint-disable-next-line @next/next/no-img-element -- server-proxied map tiles
          <img key={`${dx}-${dy}`} src={`/api/aerial/${z}/${x0 + dx}/${y0 + dy}`} alt="" loading="lazy" />
        )),
      )}
      <span className="vexcel-pin" style={{ left: `${pinX}%`, top: `${pinY}%` }} />
    </div>
  );
}

function ChapterHeading({
  number,
  time,
  title,
  text,
}: {
  number: string;
  time: string;
  title: string;
  text: string;
}) {
  return (
    <div className="chapter-heading">
      <span>{number}</span>
      <div>
        <p>{time}</p>
        <h2>{title}</h2>
        <small>{text}</small>
      </div>
    </div>
  );
}

function EvidenceTitle({
  children,
  source,
  confidence = "Confirmed",
}: {
  children: React.ReactNode;
  source: string;
  confidence?: "Confirmed" | "Likely" | "Unknown";
}) {
  return (
    <div className="evidence-title">
      <h3>{children}</h3>
      <Source source={source} confidence={confidence} />
    </div>
  );
}

// ---------- Helpers that turn agent data into display text ----------
type Confidence = "Confirmed" | "Likely" | "Unknown";
type TimelineEntry = Card["history"]["timeline"][number];

const toConfidence = (match?: string | null): Confidence =>
  match === "confirmed" ? "Confirmed" : match === "likely" ? "Likely" : "Unknown";
const yearOf = (date?: string | null) => (date ? date.slice(0, 4) : "Now");
const money = (n?: number | null) => (n == null ? "—" : `$${Number(n).toFixed(2).replace(/\.00$/, "")}`);
const titleCase = (text: string) => text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const prettyUse = (use: string) =>
  ({ OfficeMedical: "Medical office", Medical: "Medical", Office: "Office", OfficeRetail: "Office / retail", Retail: "Retail" })[
    use
  ] ?? titleCase(use);
const yearsBetween = (from?: string | null, to?: string | null) => {
  const start = from ? new Date(from).getTime() : Date.now();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(0.5, (end - start) / (365.25 * 24 * 3600 * 1000));
};

/** Timeline entries in order, plus a "For lease" band after the last tenant left. */
function timelineWithVacancy(timeline: TimelineEntry[]) {
  const sorted = [...timeline].sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
  const lastEnd = sorted.reduce<string | null>((latest, e) => (e.to && (!latest || e.to > latest) ? e.to : latest), null);
  const stillOccupied = sorted.some((e) => !e.to);
  return { sorted, vacantSince: stillOccupied ? null : lastEnd };
}

/** Floor plan image with the labeled room outlines and feature pins drawn on top (coordinates are image pixels). */
function FloorPlanLive({ inspect, selectPin }: { inspect: Card["inspect"]; selectPin: (name: string) => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const { url, width, height } = inspect.floorplan;
  const showImage = Boolean(url) && !imageFailed;
  return (
    <div className="floorplan floorplan-live">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Floor plan from scan">
        {showImage && <image href={url} width={width} height={height} onError={() => setImageFailed(true)} />}
        {inspect.rooms.map((room) => {
          const pts = room.polygon.map(([x, y]) => `${x},${y}`).join(" ");
          const cx = room.polygon.reduce((sum, p) => sum + p[0], 0) / room.polygon.length;
          const cy = room.polygon.reduce((sum, p) => sum + p[1], 0) / room.polygon.length;
          return (
            <g key={room.id} className="fp-room" onClick={() => selectPin(room.display)}>
              <polygon points={pts} />
              <text x={cx} y={cy}>
                {room.display}
              </text>
              <text x={cx} y={cy + 15} className="fp-conf">
                {Math.round(room.confidence * 100)}%
              </text>
            </g>
          );
        })}
        {inspect.rooms.flatMap((room) =>
          room.features.map((f, i) => (
            <g
              key={`${room.id}-${i}`}
              className="fp-pin"
              onClick={() => selectPin(`${room.display}: ${titleCase(f.type)}`)}
            >
              <circle cx={f.x} cy={f.y} r={9} />
              <text x={f.x} y={f.y + 4}>+</text>
            </g>
          )),
        )}
      </svg>
      {!showImage && <span className="placeholder-label">Floor plan from scan</span>}
    </div>
  );
}

function SpaceCard({
  card,
  back,
  offer,
  match = "Match",
}: {
  card: Card;
  back: () => void;
  offer: () => void;
  match?: string;
}) {
  const [pin, setPin] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);
  const [counter, setCounter] = useState("");
  const [suggested, setSuggested] = useState(false);
  const [showDeals, setShowDeals] = useState(false);
  const [activeAsks, setActiveAsks] = useState([true, true, true]);

  const { suite: s, history, inspect, pricing, tenant_mix: mix, fit, negotiate } = card;
  const { sorted: timeline, vacantSince } = timelineWithVacancy(history.timeline);
  const longest = [...timeline].sort((a, b) => yearsBetween(b.from, b.to) - yearsBetween(a.from, a.to))[0];
  const hasProcedure = inspect.rooms.some((r) => r.label === "procedure");
  const hasScan = Boolean(s.matterport_model_id) || inspect.rooms.length > 0;
  const bestNextUse = mix.complements[0]?.category;
  const totalSqft = inspect.rooms.reduce((sum, r) => sum + (r.area_sqft ?? 0), 0);
  const freeMonths = pricing.comps.map((c) => c.free_months).filter((m): m is number => typeof m === "number");
  const typicalFree = freeMonths.length ? `${Math.min(...freeMonths)}–${Math.max(...freeMonths)} mo.` : "—";
  const [low, high] = pricing.range_psf_yr ?? [pricing.target_rent_psf_yr, pricing.target_rent_psf_yr];
  const targetPos = high > low ? ((pricing.target_rent_psf_yr - low) / (high - low)) * 100 : 50;
  const bars = [
    ...timeline.map((e, i) => ({ label: e.tenant, years: yearsBetween(e.from, e.to), cls: i === 0 ? "laser" : "plastic" })),
    ...(vacantSince ? [{ label: "For lease", years: yearsBetween(vacantSince, null), cls: "lease" }] : []),
  ];
  const years = [...new Set(timeline.flatMap((e) => [yearOf(e.from), ...(e.to ? [yearOf(e.to)] : [])]))].sort();

  return (
    <main className="page space-page">
      <Back onClick={back} label="All matches" />
      <section className="space-hero glass">
        <div className="space-hero-top">
          <div>
            <p className="kicker light">{match}</p>
            <h1>{s.address}</h1>
            <p className="space-suite">
              Suite {s.suite} · {s.city}
            </p>
          </div>
          <div className="hero-actions">
            <button className="ghost" onClick={() => setCompared(!compared)}>
              {compared ? "Added to compare" : "Compare"}
            </button>
            <button className="primary" onClick={offer}>
              Draft offer for my broker
            </button>
          </div>
        </div>
        <div className="hero-stats">
          <span>
            <b>{s.sqft ? Math.round(s.sqft).toLocaleString() : "—"}</b> sq ft listed
          </span>
          <span>
            <b>{prettyUse(s.use)}</b>
          </span>
          <span>
            <b>{money(s.asking_rent_psf_yr)}</b>/sf/yr {titleCase(s.service_type)}
          </span>
        </div>
        <p className="space-summary">{s.listing_notes[0] ?? "Listing notes not recorded."}</p>
        <div className="hero-sources">
          <Source source="CoStar" dark />
          {s.matterport_model_id && <Source source="Matterport scan" dark />}
        </div>
      </section>

      <AskSpace card={card} />

      <section className="chapter" id="space-then">
        <ChapterHeading
          number="01"
          time="THEN"
          title={
            longest
              ? `${longest.tenant} shaped this space for ${Math.round(yearsBetween(longest.from, longest.to))} years.`
              : "No past tenants recorded for this space yet."
          }
          text="Every past tenant left something behind in the space."
        />
        <div className="content-card">
          <EvidenceTitle source="CoStar">Who was here</EvidenceTitle>
          <div className="big-timeline">
            <div className="timeline-years">
              {years.map((y) => (
                <span key={y}>{y}</span>
              ))}
              <span>Now</span>
            </div>
            <div className="timeline-bars" style={{ gridTemplateColumns: bars.map((b) => `${b.years}fr`).join(" ") }}>
              {bars.map((b) => (
                <span key={b.label} className={b.cls}>
                  {b.label}
                </span>
              ))}
            </div>
          </div>
          <div className="timeline-notes">
            {timeline.map((e) => (
              <div key={`${e.tenant}-${e.from}`}>
                <b>
                  {yearOf(e.from)}–{e.to ? yearOf(e.to) : "now"}
                </b>
                <strong>{e.tenant}</strong>
                <span>{titleCase(e.category)}</span>
                <Source source="CoStar" confidence={toConfidence(e.match)} />
                {e.match !== "confirmed" && <small>{e.why_matched}</small>}
              </div>
            ))}
            {vacantSince && (
              <div>
                <b>{yearOf(vacantSince)}–now</b>
                <strong>For lease</strong>
                <span>Vacant</span>
                <Source source="CoStar" confidence="Confirmed" />
              </div>
            )}
          </div>
          {history.likely_buildout.length > 0 && (
            <div className="built-chips">
              <span>Likely built in</span>
              {history.likely_buildout.slice(0, 4).map((b) => (
                <b key={b.feature}>{b.feature.length > 48 ? `${b.feature.slice(0, 46)}…` : b.feature}</b>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="chapter" id="space-now">
        <ChapterHeading
          number="02"
          time="NOW"
          title={
            !hasScan
              ? "No 3D scan of this suite yet."
              : hasProcedure
                ? "The procedure room is still here."
                : `${inspect.rooms.length} rooms are already built in.`
          }
          text={hasScan ? "A scan turns every room into evidence you can act on." : "What we know comes from CoStar: size, rent and who was here before."}
        />
        {!hasScan && (
          <div className="content-card">
            <EvidenceTitle source="CoStar">What we can and can’t see</EvidenceTitle>
            <p>
              This suite has no Matterport scan, so its rooms, sinks and offices can’t be checked yet. Ask the landlord for a
              walkthrough or a scan. Size ({s.sqft ? Math.round(s.sqft).toLocaleString() : "—"} sq ft), rent and past tenants
              above are from CoStar.
            </p>
          </div>
        )}
        {hasScan && (<>
        <div className="content-card">
          <EvidenceTitle source="Matterport scan">What’s built in</EvidenceTitle>
          <div className="plan-layout">
            <FloorPlanLive inspect={inspect} selectPin={setPin} />
            <div className="room-list">
              <p>{inspect.rooms.length} rooms detected</p>
              {inspect.rooms.map((room) => (
                <button key={room.id} onClick={() => setPin(room.display)}>
                  <span>{room.display}</span>
                  <b>{Math.round(room.confidence * 100)}%</b>
                </button>
              ))}
              <small>
                {totalSqft > 0
                  ? `Measured ${Math.round(totalSqft).toLocaleString()} sq ft across ${inspect.rooms.length} rooms.`
                  : `Room labels from the 3D scan. ${Object.entries(inspect.counts)
                      .map(([k, v]) => `${v} ${titleCase(k).toLowerCase()}`)
                      .join(" · ")}`}
              </small>
            </div>
          </div>
        </div>
        <div className="tour-card">
          <div className="tour-visual tour-live">
            <Tour3D modelId={card.suite.matterport_model_id} title={`Suite ${card.suite.suite}`} />
          </div>
          <div>
            <EvidenceTitle source="Matterport scan">Walk it yourself</EvidenceTitle>
            <p>Drag inside the scan to look around, or say “show me inside” and walk it room by room by voice.</p>
            <Source source="Matterport scan" confidence="Confirmed" />
          </div>
        </div>
        </>)}
        <div className="split-grid">
          {hasScan && (
          <div className="content-card fit-card">
            <EvidenceTitle source="Matterport scan">Does it fit your business</EvidenceTitle>
            {[...fit.checks, ...fit.accessibility].map((c) => {
              const item = "need" in c ? c.need : c.check;
              const state = c.status === "pass" ? "Pass" : c.status === "fail" ? "Fail" : "Partial";
              return (
                <div className="check-row" key={item}>
                  <span className={state.toLowerCase()}>{state === "Pass" ? <Icon name="check" size={14} /> : "—"}</span>
                  <p>
                    <b>{item}</b>
                    <small>{c.evidence}</small>
                  </p>
                  <Source source="Matterport scan" confidence={state === "Pass" ? "Confirmed" : "Likely"} />
                </div>
              );
            })}
            <p className="screening-note">
              Accessibility screening is directional, not a compliance review.
            </p>
          </div>
          )}
          <div className="content-card access-card">
            <EvidenceTitle source="Vexcel aerial">Getting there</EvidenceTitle>
            <VexcelTiles lat={s.lat} lon={s.lon} label={s.address} />
            <p className="muted">Live Vexcel aerial around {s.address || "the building"}. Parking and access aren’t counted yet.</p>
          </div>
        </div>
      </section>

      <section className="chapter next-chapter" id="space-next">
        <ChapterHeading
          number="03"
          time="NEXT"
          title={bestNextUse ? "It already sits among businesses like yours." : "Find the right next tenant."}
          text="The best next use builds on the work the space has already done."
        />
        <div className="pricing-grid">
          <div className="content-card pricing-card">
            <EvidenceTitle source="CoStar">What it should cost</EvidenceTitle>
            <p>Target starting rent</p>
            <div className="big-rent">
              {money(pricing.target_rent_psf_yr)}
              <small>/sf/yr</small>
            </div>
            <div className="rent-range">
              <span style={{ width: "100%" }} />
              <i style={{ left: `${Math.max(0, Math.min(100, targetPos))}%` }} />
              <div>
                <b>{money(low)}</b>
                <b>{money(high)}</b>
              </div>
            </div>
            <p className="muted">
              {pricing.n_deals
                ? `Based on ${pricing.n_deals} signed deals ${pricing.basis.startsWith("and") ? `in ${pricing.basis.replace(/^and /, "")}` : `in ${pricing.basis || "this building"}`}.`.replace("in around", "in and around")
                : "No signed deals recorded in this building, so this is the listing's asking rent."}
            </p>
            <div className="price-details">
              <span>
                <b>{typicalFree}</b>typical free rent
              </span>
              <span>
                <b>
                  {pricing.buildout_savings
                    ? `$${Math.round(pricing.buildout_savings.low / 1000)}K–$${Math.round(pricing.buildout_savings.high / 1000)}K`
                    : "—"}
                </b>
                estimated build-out savings
              </span>
            </div>
            <button className="text-button" onClick={() => setShowDeals(!showDeals)}>
              {showDeals ? "Hide deal details" : "See all deals"} <Icon name="chevron" />
            </button>
            {showDeals && (
              <div className="deal-details">
                {pricing.comps.slice(0, 6).map((c) => (
                  <span key={`${c.address}-${c.suite}-${c.signed}`}>
                    <b>
                      {c.address}
                      {c.suite ? ` · Ste ${c.suite}` : ""}
                    </b>
                    {money(c.rent_psf_yr)}
                    {c.free_months ? ` · ${c.free_months} months free` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="content-card neighbor-card">
            <span className="mini-spark">
              <Icon name="spark" />
            </span>
            <h3>Good neighbors</h3>
            <p>
              {mix.conflicts[0]?.reason ??
                (mix.total_current
                  ? `${mix.total_current} current tenant${mix.total_current > 1 ? "s" : ""} in the building, from CoStar.`
                  : "The building’s current tenant list isn’t connected yet.")}
            </p>
            <ul>
              {mix.complements.slice(0, 3).map((c) => (
                <li key={c.category}>{c.reason}</li>
              ))}
            </ul>
            {mix.complements.length > 0 && (
              <div className="insight">
                Neighbors in related businesses could send clients your way.
                <Source source="CoStar" confidence="Likely" />
              </div>
            )}
          </div>
        </div>
        <div className="content-card offer-preview">
          <div>
            <p className="kicker">Draft for your broker to review</p>
            <h3>Start with the space’s strongest evidence.</h3>
            <p>
              SecondLife has drafted a clear opening position—not a message sent on your behalf.
            </p>
          </div>
          <div className="ask-chips">
            {negotiate.asks.slice(0, 3).map((ask, index) => (
              <button
                className={activeAsks[index] ? "selected" : ""}
                key={ask}
                onClick={() =>
                  setActiveAsks((current) =>
                    current.map((value, i) => (i === index ? !value : value)),
                  )
                }
              >
                {activeAsks[index] && <Icon name="check" size={13} />}
                {ask}
              </button>
            ))}
          </div>
          <div className="reply-box">
            <textarea
              value={counter}
              onChange={(e) => setCounter(e.target.value)}
              placeholder="Paste landlord reply…"
            />
            <button onClick={() => setSuggested(Boolean(counter.trim()))}>Suggest counter</button>
          </div>
          {suggested && (
            <div className="counter-suggestion">
              <Icon name="spark" />
              <span>
                <b>Suggested counter</b>Hold at {money(Math.min(pricing.target_rent_psf_yr || s.asking_rent_psf_yr, s.asking_rent_psf_yr || pricing.target_rent_psf_yr))}/sf/yr
                and ask that the existing improvements stay with the space.
              </span>
            </div>
          )}
          <button className="primary wide-button" onClick={offer}>
            Draft offer for my broker <Icon name="chevron" />
          </button>
        </div>
      </section>
      {pin && (
        <div className="modal-backdrop" onClick={() => setPin(null)}>
          <div className="panorama-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPin(null)}>
              <Icon name="close" />
            </button>
            <div className="panorama-art">
              <span>Matterport panorama</span>
              <div className="panorama-room" />
            </div>
            <div>
              <p className="kicker">Scan evidence</p>
              <h3>{pin}</h3>
              <p>Labeled by AI from the Matterport scan photos. Ready for broker review.</p>
              <Source source="Matterport scan" confidence="Confirmed" />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function OfferDraft({ back, card, business }: { back: () => void; card: Card; business: string }) {
  const s = card.suite;
  const p = card.pricing;
  const signed = p.range_psf_yr[0] || p.target_rent_psf_yr;
  const opening = Math.min(...[signed, s.asking_rent_psf_yr].filter((n) => n > 0));
  const [sent, setSent] = useState(false);
  const [rent, setRent] = useState(Number.isFinite(opening) ? `${money(opening)}/sf/yr` : "");
  const pastSame = card.history.timeline[card.history.timeline.length - 1]?.tenant;
  return (
    <main className="page narrow draft-page">
      <Back onClick={back} label="Back to space" />
      <p className="kicker">Offer workspace</p>
      <h1>A clear first move, ready for your broker.</h1>
      <div className="review-banner">
        <Icon name="eye" />
        <span>
          <b>Draft only</b>Nothing is sent until your broker reviews it.
        </span>
      </div>
      <div className="letter">
        <div className="letter-head">
          <Logo />
          <span>Letter of intent · Draft</span>
        </div>
        <p>
          Re: {s.address}, Suite {s.suite}, {s.city}
          {s.sqft ? ` (${Math.round(s.sqft).toLocaleString()} sq ft)` : ""}
        </p>
        <p>
          On behalf of a {business.toLowerCase()}, we are pleased to submit the following non-binding proposal for the
          premises:
        </p>
        <label>
          Base rent
          <input value={rent} onChange={(e) => setRent(e.target.value)} />
        </label>
        <label>
          Free rent
          <input defaultValue="" placeholder="To negotiate (no comparable free-rent data yet)" />
        </label>
        <label>
          Existing improvements
          <input defaultValue={card.inspect.rooms.length ? "Existing rooms and fixtures to remain, as shown in the scan" : "Existing improvements to remain, subject to inspection"} />
        </label>
        <p>
          {s.asking_rent_psf_yr ? `The listing asks ${money(s.asking_rent_psf_yr)}/sf/yr` : "The listing's asking rent isn't recorded"}
          {p.n_deals ? `; ${p.n_deals} signed deals in the building support the opening rent above` : ""}.
          {pastSame ? ` The suite was previously occupied by ${pastSame}.` : ""}
        </p>
        <p>
          Sincerely,
          <br />
          Tenant representative
        </p>
      </div>
      <div className="draft-actions">
        <button className="secondary" onClick={back}>
          Keep editing space
        </button>
        <button className="primary" onClick={() => setSent(true)}>
          {sent ? "Shared with broker" : "Share with my broker"} <Icon name="chevron" />
        </button>
      </div>
      {sent && (
        <div className="success-message">
          <Icon name="check" /> Draft shared. Your broker stays in control.
        </div>
      )}
    </main>
  );
}

export default function SecondLifeApp({ card }: { card: Card }) {
  const [mode, setModeState] = useState<Mode>("tenant");
  const [screen, setScreen] = useState<Screen>("home");
  const [query, setQuery] = useState("I'm a dermatologist looking for 5,000–7,000 sq ft in Houston");
  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const setMode = (next: Mode) => {
    setModeState(next);
    go("home");
  };
  const backScreen = useMemo(
    () =>
      ({
        agents: "home",
        results: "home",
        space: "results",
        offer: "space",
        landlord: "home",
        outreach: "landlord",
        home: "home",
      }) as Record<Screen, Screen>,
    [],
  );
  const [search, setSearch] = useState<SearchState>({ status: "loading" });
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const runSearch = useCallback((text: string) => {
    setSearch({ status: "loading" });
    setPicked(null);
    fetch(`/api/search?q=${encodeURIComponent(text)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setSearch({ status: "done", data: body as SearchResponse });
      })
      .catch((e: Error) => setSearch({ status: "error", error: e.message }));
  }, []);
  const start = () => {
    if (mode === "tenant") runSearch(query); // runs while the agent screen plays
    go("agents");
  };
  const openResult = (r: SearchResult | null) => {
    setPicked(r);
    go("space");
  };
  // Neighbors, rent comps and nearby expiring leases for the open suite (hosted database).
  const [details, setDetails] = useState<{ id: string; data: SuiteDetails | null } | null>(null);
  const profileCategory = search.status === "done" ? search.data.profile.category : "";
  useEffect(() => {
    if (!picked?.property_id) return;
    let live = true;
    const qs = new URLSearchParams({ property_id: picked.property_id, category: profileCategory, sqft: String(picked.sqft) });
    if (picked.latitude !== null && picked.longitude !== null) {
      qs.set("lat", String(picked.latitude));
      qs.set("lon", String(picked.longitude));
    }
    fetch(`/api/suite-details?${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SuiteDetails | null) => live && setDetails({ id: picked.suite_id, data }))
      .catch(() => live && setDetails({ id: picked.suite_id, data: null }));
    return () => {
      live = false;
    };
  }, [picked, profileCategory]);
  const spaceCard = useMemo(
    () => cardFor(picked, card, details && picked && details.id === picked.suite_id ? details.data : null),
    [picked, card, details],
  );
  const searchRef = useRef(search);
  const pendingOpen = useRef<{ rank?: number; suite?: string } | null>(null);
  useEffect(() => {
    searchRef.current = search;
    // An "open …" that arrived before any search: open the match once the real search is back.
    if (search.status !== "done" || !pendingOpen.current) return;
    const want = pendingOpen.current;
    pendingOpen.current = null;
    const bare = (x: string) => x.toLowerCase().replace(/^suite\s*/, "").replace(/\s+/g, "");
    const results = search.data.results;
    const r = (want.suite ? results.find((x) => bare(x.suite) === bare(want.suite!)) : results[(want.rank ?? 1) - 1]) ?? results[0];
    if (r) {
      setPicked(r);
      setScreen("space");
    } else setScreen("results");
  }, [search]);
  const matchLabel = picked
    ? `${search.status === "done" && search.data.results[0]?.suite_id === picked.suite_id ? "Your best match" : "Match"} · ${picked.score}% fit`
    : undefined;
  const finishAgents = useCallback(() => {
    setScreen((current) => (current === "agents" ? (modeRef.current === "tenant" ? "results" : "landlord") : current));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const modeRef = useRef(mode);
  const screenRef = useRef(screen);
  useEffect(() => {
    modeRef.current = mode;
    screenRef.current = screen;
  }, [mode, screen]);

  // Voice commands that move around the app. Returns what the voice should say, when it has something specific.
  const onNav = useCallback(
    (c: NavCommand): string | void => {
      const sections: Partial<Record<string, string>> = {
        history: "space-then",
        fit: "space-now",
        pricing: "space-next",
        neighbors: "space-next",
      };
      switch (c.kind) {
        case "nav.search":
          setQuery(c.text);
          setModeState("tenant");
          modeRef.current = "tenant";
          runSearch(c.text);
          go("agents");
          return;
        case "nav.open": {
          if (modeRef.current !== "tenant") {
            go("landlord");
            return "Opening your best prospects.";
          }
          const s = searchRef.current;
          const results = s.status === "done" ? s.data.results : [];
          const bare = (x: string) => x.toLowerCase().replace(/^suite\s*/, "").replace(/\s+/g, "");
          let r: SearchResult | null = null;
          if (!results.length) {
            // No search yet: run the real one (the search box text), then open the match. Never the sample card.
            pendingOpen.current = { rank: c.rank, suite: c.suite };
            runSearch(query);
            go("agents");
            return c.suite ? `Finding Suite ${c.suite.toUpperCase()}.` : "Finding your best match.";
          }
          if (c.suite) {
            r = results.find((x) => bare(x.suite) === bare(c.suite!)) ?? null;
            if (!r) return `I don't see Suite ${c.suite.toUpperCase()} in these matches. Say "open the best match" or "open the second match".`;
          } else {
            r = results[(c.rank ?? 1) - 1] ?? null;
            if (!r) return `There are only ${results.length} matches.`;
          }
          openResult(r);
          return r ? `Opening ${r.suite} at ${r.address}.` : `Opening Suite ${card.suite.suite}.`;
        }
        case "nav.offer":
          setModeState("tenant");
          go("offer");
          return;
        case "nav.back":
          go(backScreen[screenRef.current]);
          return;
        case "nav.home":
          go("home");
          return;
        case "nav.mode":
          if (c.mode === "landlord") return "Landlord mode isn't connected to real data yet, so it's switched off for now.";
          setModeState("tenant");
          modeRef.current = "tenant";
          go("home");
          return;
        case "nav.scroll": {
          const id = sections[c.topic];
          if (screenRef.current === "space" && id) {
            window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
          }
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openResult and go only call state setters
    [backScreen, runSearch, card, query],
  );
  // Full-screen aerial behind every page: the Medical Center on home, the results as pins, the open suite up close.
  const resultPins = useMemo<AerialPin[]>(
    () =>
      search.status === "done"
        ? search.data.results
            .filter((r) => r.latitude !== null && r.longitude !== null)
            .map((r, i) => ({
              id: r.suite_id,
              lat: r.latitude as number,
              lon: r.longitude as number,
              label: `${r.suite} · ${r.address}`,
              sub: `${r.sqft.toLocaleString()} sq ft${r.asking_rent ? ` · $${r.asking_rent}/sf` : ""}`,
              best: i === 0,
            }))
        : [],
    [search],
  );
  const suiteSpot = spaceCard.suite.lat ? { lat: spaceCard.suite.lat, lon: spaceCard.suite.lon } : SUITE_900;
  const bg =
    screen === "results" && resultPins.length
      ? { key: `results-${resultPins.map((p) => p.id).join(",")}`, pins: resultPins, center: SUITE_900, zoom: 12, pitch: 50, spin: 1.2 }
      : screen === "space" || screen === "offer"
        ? { key: `suite-${spaceCard.suite.key}`, pins: [], center: suiteSpot, zoom: 17.4, pitch: 62, spin: 3.5 }
        : { key: "city", pins: [], center: SUITE_900, zoom: 15.6, pitch: 60, spin: 2.5 };

  return (
    <div className={`app-shell screen-${screen}`}>
      <div className="app-bg" aria-hidden={screen !== "results"}>
        <AerialMap
          viewKey={bg.key}
          center={bg.center}
          zoom={bg.zoom}
          pitch={bg.pitch}
          pins={bg.pins}
          spin={bg.spin}
          onPick={(id) => {
            const r = search.status === "done" ? search.data.results.find((x) => x.suite_id === id) : undefined;
            if (r) openResult(r);
          }}
        />
      </div>
      <div className="app-veil" />
      <p className="aerial-hint app-hint">
        {screen === "results" && resultPins.length ? "Live Vexcel aerial · tap a pin to open that suite" : "Live Vexcel aerial · drag to explore"}
      </p>
      <Header mode={mode} setMode={setMode} goHome={() => go("home")} />
      {screen === "home" && <Home mode={mode} start={start} query={query} setQuery={setQuery} />}
      {screen === "agents" && <AgentRoom mode={mode} done={finishAgents} back={() => go("home")} />}
      {screen === "results" && <Results search={search} back={() => go("home")} open={openResult} />}
      {screen === "space" && (
        <SpaceCard card={spaceCard} match={matchLabel} back={() => go("results")} offer={() => go("offer")} />
      )}
      {screen === "offer" && (
        <OfferDraft back={() => go("space")} card={spaceCard} business={search.status === "done" ? search.data.profile.name : "Tenant"} />
      )}
      {screen !== "home" && <Footer />}
      {screen === "home" && <Footer />}
      <VoiceLayer
        card={picked ? spaceCard : card}
        mode={mode}
        onNav={onNav}
        suiteOpen={(screen === "space" || screen === "offer") && !!picked}
      />
      <button className="floating-back" onClick={() => go(backScreen[screen])} aria-label="Go back">
        <Icon name="arrow" />
      </button>
    </div>
  );
}
