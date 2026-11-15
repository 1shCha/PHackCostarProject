"use client";

// SecondLife app screens (design from Figma). Real data arrives through the `card` prop.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "@/agents";
import AskSpace from "@/components/AskSpace";
import VoiceLayer, { type NavCommand } from "@/components/VoiceLayer";
import { Tour3D } from "./Tour3D";

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
        <button className={mode === "landlord" ? "active" : ""} onClick={() => setMode("landlord")}>
          I have space to lease
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
        {mode === "tenant" ? (
          <>
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
          </>
        ) : (
          <>
            <h1>
              Your empty suite has a history. <em>Let’s use it.</em>
            </h1>
            <p className="hero-sub">
              We read the space you already have, then find the businesses most likely to value it.
            </p>
            <div className="search-card">
              <div>
                <label>Choose your space</label>
                <div className="picker">
                  2000 Dairy Ashford Rd · Suite 550 · 6,303 sq ft · Houston <span>⌄</span>
                </div>
              </div>
              <button className="primary" onClick={start}>
                Find my next tenant <Icon name="chevron" />
              </button>
            </div>
          </>
        )}
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
  ["History agent", "Found 2 past tenants for Suite 900", "clock"],
  ["Space Inspector", "Labeling room 4 of 8 from 33 scans", "scan"],
  ["Fit agent", "Checking exam rooms, sinks and reception", "check"],
  ["Site agent", "Counting parking from aerial imagery", "map"],
  ["Pricing agent", "Comparing signed deals in the building and area", "layers"],
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
              : "Finding the next life for Suite 550."}
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

const resultCards = [
  {
    badge: "✦ Best match",
    level: "best",
    address: "6655 Travis St",
    suite: "Suite 900",
    size: "6,692",
    rent: "$28",
    signed: "$26.50–$29",
    detail: "Former plastic surgery suite · operating room still in place",
    build: "5 rooms with sinks",
    score: "94%",
    reason: "Saves a full medical build-out",
    unknown: false,
  },
  {
    badge: "Good fit",
    level: "good",
    address: "Medical office",
    suite: "Suite 410",
    size: "3,100",
    rent: "$26",
    signed: "$24–$27",
    detail: "Former dental office · plumbing in every room",
    build: "4 rooms with sinks",
    score: "86%",
    reason: "Plumbing is already distributed",
    unknown: false,
  },
  {
    badge: "Good fit",
    level: "good",
    address: "Medical plaza",
    suite: "Suite 220",
    size: "2,450",
    rent: "$24",
    signed: "$23–$25",
    detail: "Former physical therapy clinic",
    build: "Open treatment floor",
    score: "79%",
    reason: "Strong medical adjacency",
    unknown: false,
  },
  {
    badge: "Possible",
    level: "possible",
    address: "Office tower",
    suite: "Suite 1500",
    size: "5,200",
    rent: "$31",
    signed: "Not recorded",
    detail: "Standard office · needs full build-out",
    build: "No 3D scan for this space yet",
    score: "61%",
    reason: "Right size, costly conversion",
    unknown: true,
  },
];

function HistoryRibbon({ simple = false }: { simple?: boolean }) {
  return (
    <div className="history-ribbon" title="Space history by industry">
      <span className="medical" style={{ width: simple ? "58%" : "68%" }} />
      <span className="office" style={{ width: "22%" }} />
      <span className="vacant" />
    </div>
  );
}

function Results({ back, open }: { back: () => void; open: () => void }) {
  return (
    <main className="page results-page">
      <Back onClick={back} label="Change search" />
      <div className="page-title-row">
        <div>
          <p className="kicker">4 spaces worth a closer look</p>
          <h1>Built for care, not just available.</h1>
          <p>
            Ranked by what is already there, what similar tenants paid, and how patients arrive.
          </p>
        </div>
        <div className="filter-button">Houston · 2,000–7,000 sq ft</div>
      </div>
      <div className="result-grid">
        {resultCards.map((card, i) => (
          <article className={`result-card ${card.level}`} key={card.suite} onClick={open}>
            <div className="card-top">
              <span className="match-badge">{card.badge}</span>
              <span className="score">{card.score} fit</span>
            </div>
            <h2>{card.address}</h2>
            <p className="suite">{card.suite} · Houston</p>
            <HistoryRibbon simple={i > 0} />
            <div className="ribbon-key">
              <span>Medical</span>
              <span>Office</span>
              <span>Vacant</span>
            </div>
            <p className="result-detail">{card.detail}</p>
            <div className={`build-proof ${card.unknown ? "unknown-box" : ""}`}>
              <Icon name={card.unknown ? "eye" : "scan"} />
              <span>
                {card.build}
                <Source
                  source="Matterport scan"
                  confidence={card.unknown ? "Unknown" : i === 0 ? "Confirmed" : "Likely"}
                />
              </span>
            </div>
            <div className="result-numbers">
              <div>
                <b>{card.size}</b>
                <small>sq ft</small>
              </div>
              <div>
                <b>{card.rent}</b>
                <small>/sf/yr asking</small>
              </div>
            </div>
            <p className="deal-line">
              Similar tenants signed <b>{card.signed}/sf/yr</b>
            </p>
            <Source source="CoStar" confidence={card.unknown ? "Unknown" : "Confirmed"} />
            <div className="top-reason">
              <Icon name="spark" size={15} />
              <span>
                <b>Why it fits</b>
                {card.reason}
              </span>
            </div>
            <button className={i === 0 ? "primary full" : "secondary full"} onClick={open}>
              {i === 0 ? "Explore this space" : "View evidence"} <Icon name="chevron" />
            </button>
          </article>
        ))}
      </div>
    </main>
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

function SpaceCard({ card, back, offer }: { card: Card; back: () => void; offer: () => void }) {
  const [pin, setPin] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);
  const [counter, setCounter] = useState("");
  const [suggested, setSuggested] = useState(false);
  const [showDeals, setShowDeals] = useState(false);
  const [activeAsks, setActiveAsks] = useState([true, true, true]);

  const { suite: s, history, inspect, pricing, tenant_mix: mix, fit, site, negotiate } = card;
  const { sorted: timeline, vacantSince } = timelineWithVacancy(history.timeline);
  const longest = [...timeline].sort((a, b) => yearsBetween(b.from, b.to) - yearsBetween(a.from, a.to))[0];
  const hasProcedure = inspect.rooms.some((r) => r.label === "procedure");
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
      <section className="space-hero">
        <div className="space-hero-top">
          <div>
            <p className="kicker light">Your best match · 94% fit</p>
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
          <Source source="Matterport scan" dark />
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
          text="The space was shaped by care long before it became a listing."
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
            hasProcedure
              ? "The procedure room is still here."
              : `${inspect.rooms.length} rooms are already built in.`
          }
          text="A scan turns every room into evidence you can act on."
        />
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
            <EvidenceTitle source="Matterport scan">Walk the reception</EvidenceTitle>
            <p>
              A glass check-in window separates the patient waiting area from staff circulation. The
              reception desk and millwork appear intact.
            </p>
            <Source source="Matterport scan" confidence="Confirmed" />
          </div>
        </div>
        <div className="split-grid">
          <div className="content-card fit-card">
            <EvidenceTitle source="Matterport scan">Does it fit your practice</EvidenceTitle>
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
          <div className="content-card access-card">
            <EvidenceTitle source="Vexcel aerial">Getting there</EvidenceTitle>
            <div className="aerial">
              <span className="road r1" />
              <span className="road r2" />
              <span className="building-shape">6655</span>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <i key={n} />
              ))}
              <span className="placeholder-label">Vexcel aerial</span>
            </div>
            <div className="access-stats">
              <div>
                <b>{site.parking_stalls ?? "—"}</b>
                <span>parking spaces</span>
              </div>
              <div>
                <b>2</b>
                <span>street frontages</span>
              </div>
              <div>
                <b>1</b>
                <span>covered drop-off</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="chapter next-chapter" id="space-next">
        <ChapterHeading
          number="03"
          time="NEXT"
          title={bestNextUse ? `Perfect for a ${titleCase(bestNextUse).toLowerCase()} practice.` : "Find the right next tenant."}
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
              Based on {pricing.n_deals} signed deals ({pricing.basis}, {titleCase(pricing.service_type)}).
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
            <p>{mix.conflicts[0]?.reason ?? "No direct competitor in the building."}</p>
            <ul>
              {mix.complements.slice(0, 3).map((c) => (
                <li key={c.category}>{c.reason}</li>
              ))}
            </ul>
            <div className="insight">
              Medical neighbors could refer patients.
              <Source source="CoStar" confidence="Likely" />
            </div>
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
                <b>Suggested counter</b>Hold $26.75 rent, reduce free rent to 4 months, and request
                the operating-room equipment remain.
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
              <p>Visible in scan 18 of 33. AI-labeled and ready for broker review.</p>
              <Source source="Matterport scan" confidence="Confirmed" />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function OfferDraft({ back }: { back: () => void }) {
  const [sent, setSent] = useState(false);
  const [rent, setRent] = useState("$26.75/sf/yr");
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
        <p>Re: 6655 Travis St, Suite 900, Houston, TX</p>
        <p>
          On behalf of a dermatology practice, we are pleased to submit the following non-binding
          proposal for the premises:
        </p>
        <label>
          Base rent
          <input value={rent} onChange={(e) => setRent(e.target.value)} />
        </label>
        <label>
          Free rent
          <input defaultValue="5 months following commencement" />
        </label>
        <label>
          Existing improvements
          <input defaultValue="Operating room, sinks, reception and millwork to remain" />
        </label>
        <p>
          The existing medical build-out is central to this proposal and should be delivered in its
          current condition, subject to inspection.
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

const prospects = [
  [
    "Blue Ridge Engineering",
    "Civil engineering",
    "5,800–6,500 sq ft",
    "Mar 2026",
    "1.2 mi",
    "Growing team + similar floor plan",
  ],
  [
    "Horizon Infrastructure",
    "Project consulting",
    "6,100 sq ft",
    "Aug 2025",
    "3.4 mi",
    "Lease timing and parking needs align",
  ],
  [
    "Fieldstone Public Affairs",
    "Public administration",
    "5,500–7,000 sq ft",
    "Jan 2026",
    "4.1 mi",
    "Past use proves space fit",
  ],
];

function LandlordView({ back, outreach }: { back: () => void; outreach: (name: string) => void }) {
  return (
    <main className="page landlord-page">
      <Back onClick={back} label="Choose another space" />
      <div className="landlord-hero">
        <div>
          <p className="kicker">2000 Dairy Ashford Rd · Houston</p>
          <h1>Who should lease Suite 550?</h1>
          <p>6,303 sq ft · asking $17.50/sf/yr</p>
        </div>
        <Source source="CoStar" confidence="Confirmed" />
      </div>
      <section>
        <div className="section-heading">
          <div>
            <p className="kicker">What the market remembers</p>
            <h2>Suite history and rent trail</h2>
          </div>
          <Source source="CoStar" />
        </div>
        <div className="rent-trail">
          <div>
            <small>2016–2018</small>
            <h3>Construction firm</h3>
            <b>$18.45</b>
            <span>signed rent</span>
            <Source source="CoStar" />
          </div>
          <div>
            <small>2019–2025</small>
            <h3>Public administration</h3>
            <b>$18.00</b>
            <span>asking rent</span>
            <Source source="CoStar" confidence="Likely" />
          </div>
          <div>
            <small>2025 listing</small>
            <h3>Available</h3>
            <b>$19.00</b>
            <span>asking rent</span>
            <Source source="CoStar" confidence="Likely" />
          </div>
          <div className="now">
            <small>Now</small>
            <h3>Ready for its next life</h3>
            <b>$17.50</b>
            <span>asking rent</span>
            <Source source="CoStar" />
          </div>
        </div>
      </section>
      <section className="best-use">
        <div className="best-use-copy">
          <span className="mini-spark">
            <Icon name="spark" />
          </span>
          <p className="kicker">Best next use</p>
          <h2>Project teams that need room to gather.</h2>
          <p>
            Engineering, infrastructure and public-sector consulting teams can reuse the existing
            mix of private offices and collaboration rooms.
          </p>
          <ol>
            <li>
              <span>01</span>Prior tenants validate the floor plan
            </li>
            <li>
              <span>02</span>Parking supports field teams
            </li>
            <li>
              <span>03</span>Below-market asking rent creates urgency
            </li>
          </ol>
        </div>
        <div className="industry-rents">
          <p>Expected rent by industry</p>
          <div>
            <span>Engineering</span>
            <b>$18.10</b>
          </div>
          <div>
            <span>Public affairs</span>
            <b>$17.80</b>
          </div>
          <div>
            <span>General office</span>
            <b>$17.20</b>
          </div>
          <small>
            /sf/yr estimate · <Source source="CoStar" confidence="Likely" />
          </small>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <div>
            <p className="kicker">Leases ending soon, nearby</p>
            <h2>Who’d love this space next</h2>
          </div>
          <p>Prospects are suggestions—not contacts.</p>
        </div>
        <div className="prospect-grid">
          {prospects.map(([name, industry, size, end, distance, why], i) => (
            <article className="prospect-card" key={name}>
              <div className="prospect-index">0{i + 1}</div>
              <h3>{name}</h3>
              <p>{industry}</p>
              <div className="prospect-meta">
                <span>
                  <b>{size}</b>current need
                </span>
                <span>
                  <b>{end}</b>lease end
                </span>
                <span>
                  <b>{distance}</b>away
                </span>
              </div>
              <div className="why-match">
                <Icon name="spark" size={15} />
                <span>
                  <b>Why they match</b>
                  {why}
                </span>
              </div>
              <Source source="CoStar" confidence={i === 0 ? "Confirmed" : "Likely"} />
              <button className="primary full" onClick={() => outreach(name)}>
                Draft outreach <Icon name="chevron" />
              </button>
            </article>
          ))}
        </div>
      </section>
      <div className="unknown-state">
        <span>?</span>
        <div>
          <b>One data gap</b>
          <p>
            No 3D scan for Suite 550 yet. Physical fit is inferred from prior use and listing plans.
          </p>
        </div>
        <Source source="Matterport scan" confidence="Unknown" />
      </div>
    </main>
  );
}

function Outreach({ name, back }: { name: string; back: () => void }) {
  const [sent, setSent] = useState(false);
  return (
    <main className="page narrow draft-page">
      <Back onClick={back} label="Back to prospects" />
      <p className="kicker">Outreach draft</p>
      <h1>A specific reason to look, not another blast.</h1>
      <div className="review-banner">
        <Icon name="eye" />
        <span>
          <b>Draft for your broker to review</b>SecondLife never contacts prospects on its own.
        </span>
      </div>
      <div className="email-card">
        <div>
          <span>To</span>
          <b>{name}</b>
        </div>
        <div>
          <span>Subject</span>
          <b>A space that already works like your team does</b>
        </div>
        <textarea
          defaultValue={`Hi ${name} team,\n\nYour current lease may be approaching a decision point, and we thought Suite 550 at 2000 Dairy Ashford might be worth a look.\n\nThe 6,303 sq ft suite was previously used by project-based teams, with a mix of private offices and collaboration space, strong parking, and an asking rent of $17.50/sf/yr.\n\nWould a short walkthrough be useful?\n\nBest,\nYour broker`}
        />
      </div>
      <div className="draft-actions">
        <button className="secondary" onClick={back}>
          Save for later
        </button>
        <button className="primary" onClick={() => setSent(true)}>
          {sent ? "Ready for broker" : "Send to broker for review"} <Icon name="chevron" />
        </button>
      </div>
      {sent && (
        <div className="success-message">
          <Icon name="check" /> Added to your broker’s review queue.
        </div>
      )}
    </main>
  );
}

export default function SecondLifeApp({ card }: { card: Card }) {
  const [mode, setModeState] = useState<Mode>("tenant");
  const [screen, setScreen] = useState<Screen>("home");
  const [prospect, setProspect] = useState(prospects[0][0]);
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
  const start = () => go("agents");
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

  // Voice commands that move around the app.
  const onNav = useCallback(
    (c: NavCommand) => {
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
          go("agents");
          return;
        case "nav.open":
          go(modeRef.current === "tenant" ? "space" : "landlord");
          return;
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
          setModeState(c.mode);
          modeRef.current = c.mode;
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
    [backScreen],
  );
  return (
    <div className="app-shell">
      <Header mode={mode} setMode={setMode} goHome={() => go("home")} />
      {screen === "home" && <Home mode={mode} start={start} query={query} setQuery={setQuery} />}
      {screen === "agents" && <AgentRoom mode={mode} done={finishAgents} back={() => go("home")} />}
      {screen === "results" && <Results back={() => go("home")} open={() => go("space")} />}
      {screen === "space" && <SpaceCard card={card} back={() => go("results")} offer={() => go("offer")} />}
      {screen === "offer" && <OfferDraft back={() => go("space")} />}
      {screen === "landlord" && (
        <LandlordView
          back={() => go("home")}
          outreach={(name) => {
            setProspect(name);
            go("outreach");
          }}
        />
      )}
      {screen === "outreach" && <Outreach name={prospect} back={() => go("landlord")} />}
      {screen !== "home" && <Footer />}
      {screen === "home" && <Footer />}
      <VoiceLayer card={card} mode={mode} onNav={onNav} />
      <button className="floating-back" onClick={() => go(backScreen[screen])} aria-label="Go back">
        <Icon name="arrow" />
      </button>
    </div>
  );
}
