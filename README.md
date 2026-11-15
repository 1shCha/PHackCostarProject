# 🏢 SecondLife

> **Every commercial space remembers who was there.**
> SecondLife reads a suite's tenant history, checks what's built into it, and matches it to the business that values it most.

🏆 Built for CoStar's **AI for the Built World** track

---

## 📚 Contents

- [The problem](#-the-problem)
- [What SecondLife does](#-what-secondlife-does)
- [Features](#-features)
- [Team](#-team)
- [Quick start](#-quick-start)
- [Configuration](#-configuration)
- [Architecture](#%EF%B8%8F-architecture)
- [Chat API](#-chat-api)
- [Agent tools](#-agent-tools)
- [Testing](#-testing)
- [Evidence and honesty rules](#%EF%B8%8F-evidence-and-honesty-rules)
- [Contributing](#-contributing)

---

## 🤔 The problem

A commercial listing gives you square footage, a price, and a few photos. It doesn't answer the questions a business owner actually has:

- 🧾 **Who was here before?** Did a business like mine use this suite?
- 🛠️ **What's already built in?** Exam rooms, sinks, a reception area, private offices?
- 🚗 **How do people get there?** Parking, loading, outdoor space?

Today, finding out takes site visits, broker calls, and guesswork.

## ✨ What SecondLife does

Describe the space you want in plain English, for example:

> *"I'm a barber looking for 1,500–2,000 sq ft in Houston."*

SecondLife returns **real, ranked suites**, each backed by three layers of evidence:

| | Layer | Source | What it tells you |
|---|---|---|---|
| 📜 | **What was here** | CoStar lease history | Past tenants, tenant mix, rent comps |
| 🧱 | **What's built in** | Matterport 3D scans | Rooms, labels, visible features (sinks, cabinets…) |
| 🛰️ | **How people get there** | Vexcel aerial imagery | Parking, loading areas, outdoor space |

### 🎯 Fit score (0–100)

| Points | Signal |
|---:|---|
| **30** | 📐 Size fit |
| **30** | 🔁 Same kind of business here before (CoStar industry, plus tenant names where labels are broad: law firms, salons, cafés) |
| **40** | 🧰 What's built in (AI-labeled scan rooms; unscanned suites get a neutral score and say so) |

## 🚀 Features

- 🔎 **Natural-language search** over real CoStar listings
- 🗺️ **Live aerial map** (Vexcel) that orbits behind every page and flies to result pins and the open suite
- 🏬 **Suite page:** who was here, what's likely built in, floor plan from the scan, getting there, target rent, good neighbors
- 🚶 **3D walkthrough tour** from Matterport panoramas ("take me to the exam room")
- 🎙️ **Voice mode** with natural TTS (Gemini, with a browser voice as fallback) to open results and drive the tour
- 💬 **Ask the space:** a chat agent that answers with **citations** (`[S1]`, `[S2]`) to source records
- 📝 **Offer workspace:** a draft letter of intent with a suggested counter, ready for broker review

## 👥 Team

| Role | Who | Focus | Main files |
|---|---|---|---|
| 1️⃣ CoStar data | **Ishaan** | Suites, history, tenant mix, pricing, prospects | `src/agents/costar.ts`, `src/lib/tools/` |
| 2️⃣ Matterport + Vexcel | **Riley** | Rooms and features from 3D scans, fit, aerial view | `src/agents/spatial.ts`, `src/lib/spatial/` |
| 3️⃣ Product | **Cherry** | Agent orchestration, the letter, UI, voice and tour | `src/agents/index.ts`, `src/app/`, `src/components/` |

---

## ⚡ Quick start

```bash
npm install
cp .env.example .env.local   # then fill in your keys
npm run dev
```

Open 👉 http://localhost:3000

## 🔑 Configuration

All keys go in the git-ignored **`.env.local`**. See [`.env.example`](.env.example) for the full list.

| Variable | Required | Purpose |
|---|:---:|---|
| `BACKEND_API_URL`, `BACKEND_API_KEY` | ✅ | Hosted DuckDB API (preferred data source) |
| `GEMINI_API_KEY` | ✅ | Chat agent, vision analysis, TTS |
| `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN` | ✅ | 3D scan metadata and panoramas |
| `VEXCEL_API_KEY` | ✅ | Aerial imagery |
| `NEXT_PUBLIC_MATTERPORT_SDK_KEY` | ✅ | In-browser 3D tour (safe to expose; allow-list your domains) |
| `ANTHROPIC_API_KEY` | ➖ | Automatic Claude fallback |
| `ANTHROPIC_MODEL` | ➖ | Defaults to `claude-sonnet-5-5` |
| `ANTHROPIC_WORKSPACE_ID` | ➖ | Only for keys not scoped to a workspace |
| `GEMINI_CHAT_MODEL` / `GEMINI_MODEL` | ➖ | Chat model override (default `gemini-3.8-flash`) |
| `GEMINI_VISION_MODEL` / `ANTHROPIC_VISION_MODEL` | ➖ | Image-analysis model overrides |
| `CHAT_PROVIDER` | ➖ | Set to `anthropic` to answer chat with Claude first |
| `DUCKDB_PATH` | ➖ | Local database fallback (used only when **both** backend settings are absent) |
| `SPATIAL_CACHE_DIR` | ➖ | Override the spatial cache location |

> 🔒 Never expose `BACKEND_API_KEY` or any provider key through `NEXT_PUBLIC_` variables or client components.

<details>
<summary>🦆 <b>Hosted API vs. local DuckDB</b></summary>

- With **both** `BACKEND_API_URL` and `BACKEND_API_KEY` set, the property, suite, tenant-history, spatial-context, search and health tools use the hosted API. Set them in your hosting dashboard too.
- To use a local database instead, remove both backend settings and set `DUCKDB_PATH` to `commercial_clean.duckdb` (absolute, or relative to the repo root).
- Partial configuration or remote failures report an error. The app never silently switches to local data.
- The local database opens `READ_ONLY` with external access disabled. Restart the app after changing `DUCKDB_PATH`, and close any DuckDB writer/UI session that holds the file.
- Health check: `GET /api/data/health` returns `status: "ok"`, the engine version, access mode, and row counts. An unavailable database returns `503`.

</details>

---

## 🏗️ Architecture

```
Browser (Next.js 15 · React 19 · Tailwind 4 · MapLibre)
   │
   ├── /api/search         ranked suites + fit scores
   ├── /api/suite-details  neighbors, rent comps, prospects
   ├── /api/chat           cited Q&A agent (Gemini → Claude fallback)
   ├── /api/voice-intent   voice commands
   ├── /api/tts            natural voice
   ├── /api/aerial/[z]     Vexcel tile proxy (keeps key server-side)
   ├── /api/floorplan/[id] floor plans from scans
   └── /api/tour-places    named tour stops
          │
          ├── 📊 CoStar data  → hosted DuckDB API (Render) or local DuckDB
          ├── 🧱 Matterport   → room geometry + panorama vision analysis
          └── 🛰️ Vexcel       → aerial extracts + vision analysis
```

**Source-first routing:** tenant questions start with DuckDB 📊, interior questions with Matterport 🧱, and parking or outdoor questions with Vexcel 🛰️. A keyword router picks the primary source, and other sources can then fill in missing evidence.

**Provider-independent agent:** Gemini and Claude adapters share one set of tool schemas. Gemini runs first, and on a rate limit, timeout, network or 5xx error, Claude gets one fresh attempt.

## 💬 Chat API

```bash
curl http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"question":"Who previously occupied Suite 900 at 6655 Travis St, Houston, TX?"}'
```

**Request:** `{ question: string }` (1–8000 chars, 32 KiB max body)
**Response:** `{ answer, sources, tool_calls, model, provider, fallback, routing }`

<details>
<summary>📋 <b>Details: citations, limits, errors</b></summary>

- **Citations:** source references get IDs like `S1`, and the answer cites `[S1]`. Only cited sources are returned. Unknown or missing citations cause an explicit error.
- **Fallback:** `provider` is `gemini` or `anthropic`, and `fallback` is `null` or e.g. `{ from: "gemini", reason: "RATE_LIMITED" }`. Invalid input, credential, database, citation and loop-limit errors do **not** trigger fallback.
- **Limits:** max 8 model turns and 12 tool calls per attempt. The 110 s overall budget gives Gemini ≤ 30 s and Claude ≤ 75 s. Each SDK request times out at 30 s with no automatic retries.
- **Stateless:** single question per request, no stored conversation, no client-supplied transcripts.

| Status | Meaning |
|---:|---|
| `400` | Invalid input |
| `413` | Body too large |
| `429` | Final provider quota/rate limit |
| `502` | Provider, incomplete response, citation or loop-limit failure |
| `503` | Missing configuration or database failure |
| `504` | Cancellation or timeout |

Errors look like `{ error: { code, message } }`. If both providers fail, `error.attempts` lists each provider and its sanitized error code.

</details>

## 🧰 Agent tools

Seven server-only tools are shared by both model providers.

| Tool | Source | What it does |
|---|---|---|
| `find_properties` | 📊 CoStar | Search buildings by name/address, with optional city/state |
| `find_suites` | 📊 CoStar | List a property's suites or match a label (`Suite 900` = `STE. 900` = `#900`) |
| `get_tenant_history` | 📊 CoStar | Supported and candidate history, plus issues, for one suite |
| `get_spatial_context` | 📊 CoStar | Coordinates and candidate Matterport models for a property |
| `get_matterport_rooms` | 🧱 Matterport | Room counts, approximate area, labels, panorama IDs |
| `inspect_matterport_features` | 🧱 Matterport | AI vision over 1–2 panoramas for visible features |
| `inspect_vexcel_site` | 🛰️ Vexcel | AI vision over an aerial extract (20–150 m half-width) for parking, loading, outdoor space |

```ts
import { find_properties, find_suites, get_tenant_history } from "@/lib/tools/costar";

const properties = await find_properties({ query: "6655 Travis St", city: "Houston", state: "TX" });
const suites = await find_suites({ property_id: "238587", suite: "Suite 900" });
const history = await get_tenant_history({ suite_id: suites.items[0].suite_id });
```

<details>
<summary>🔬 <b>Tool behavior in detail</b></summary>

**Search tools**
- `find_properties({ query, city?, state?, limit?, offset? })`: every query token must appear in the name/address. Exact matches rank first. No typo matching or abbreviation expansion.
- `find_suites({ property_id, suite?, property_floor_id?, limit?, offset? })`: repeated labels on different floors stay separate. `0900` is distinct from `900`.
- Both return `{ items, total, limit, offset }` (default 20, max 100) and never silently pick a match.

**Tenant history**
- `get_tenant_history({ suite_id })` returns `status: "ok"` with `supported_history`, `candidate_history` and `issues`, or `status: "not_found"`.
- IDs and line numbers are strings, dates are JSON-safe, and missing values stay `null`. Raw source payloads are never returned.
- Invalid inputs throw `ToolValidationError`. Database failures are operational errors, separate from empty results.

**Spatial tools**
- Matterport rooms exclude voids, rooms under 2 m² and unusable boundaries. Multi-floor models omit panorama-to-room lists.
- Feature inspection samples up to four faces per panorama. Repeated views may show the same object, so don't sum them into an inventory.
- Vexcel pins the newest dated collection. Its output is **not** a parcel survey, a stall count, or evidence of ownership or compliance.
- Vision output is runtime-validated: recognized feature/status values and real image IDs only.
- Metadata, images and reports are cached in git-ignored `cache/spatial-tools/` with no automatic expiry. Delete the cache to refresh.

</details>

---

## 🧪 Testing

| Command | What it checks | Uses quota? |
|---|---|:---:|
| `npm run test:costar-tools` | Data tools against an isolated synthetic database | ❌ |
| `npm run test:tenant-agent` | Model adapters, dispatcher, HTTP validation, fallback | ❌ |
| `npm run test:spatial` | HTTP/vision fixtures and routing | ❌ |
| `npm run test:backend` | Remote client safety and remote search | ❌ |
| `npm run check:duckdb` | Read-only access to your local database | ❌ |
| `npm run check:costar-tools` | Real database, two known suites | ❌ |
| `npm run check:tenant-agent:offline` | Scripted model with real data tools | ❌ |
| `npm run check:backend` | Remote property → suite → history → cited answer | ❌ |
| `npm run check:remote-search` | Remote vs. local search parity (needs `DUCKDB_PATH`) | ❌ |
| `npm run check:tenant-agent` | Live Gemini + Claude fallback + data | ⚠️ |
| `npm run check:spatial` | Live Matterport and Vexcel tools | ⚠️ |
| `npm run check:spatial-agent` | Four live routing / combined-source cases | ⚠️ |

> Live checks print verification status, never private tenant records or images.

## 🛡️ Evidence and honesty rules

**Evidence, not guesswork.** SecondLife is built to say what it knows and nothing more:

- ✅ Every chat answer cites its sources
- 🔀 Uncertain tenant history is kept separate from supported history
- 👀 `not_observed` in a scan means *not seen in the sample*, never *proven absent*
- 🛰️ Missing imagery is `no_coverage`, never *zero parking*
- 📅 Missing records don't prove vacancy, and lease expiration is never treated as an occupancy end
- 🚫 No sample or placeholder data is shown, so a suite without data gets a plain empty state
- 🤝 Everything is a **draft for a broker to review**

> ⚠️ Listing and tenant records are source snapshots, not a live availability feed.

## 🤝 Contributing

- 🌿 Work on your own branch and open small pull requests.
- 🔐 Keep keys in `.env.local`. Never commit `.env` or `.env.local`.
- 🚫 **Never commit the CoStar kit.** Put it in `data/kit/` (git-ignored). This repo is public.
- 🦆 The database stays outside Git.
