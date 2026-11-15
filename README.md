# SecondLife

Every commercial space remembers who was there. SecondLife reads a suite's tenant history, checks what's built into it, and matches it to the business that values it most.

## Run it

```bash
npm install
npm run dev
```
Open http://localhost:3000

## Who works where

| Role | Your file | What you do |
|---|---|---|
| 1 · CoStar data | `src/agents/costar.ts` | suite, history, tenant mix, pricing, prospects from the CoStar kit |
| 2 · Matterport + Vexcel | `src/agents/spatial.ts` | rooms and pins from the 3D scan, fit, aerial view |
| 3 · Product | `src/agents/index.ts` + `src/app/page.tsx` | runs all agents, Claude writes the letter, the screen |

`data/demo.json` is the sample answer for every agent. **Your function must return the same shape.** Edit only your own file to avoid conflicts.

## Rules

- Work on your own branch, open small pull requests.
- Copy `.env.example` to `.env` for keys. Never commit `.env`.
- Never commit the CoStar kit. Put it in `data/kit/` (ignored by git). This repo is public.

## DuckDB backend

The backend reads an existing consolidated database with `@duckdb/node-api`.
Set `DUCKDB_PATH` in the ignored `.env.local` file to the absolute path of
`commercial_clean.duckdb` (or a path relative to the repository root). See
`.env.example`. The database stays outside Git; it is not copied into the app.

Run `npm run check:duckdb` to verify read-only access, the expected views,
parameter binding, and JSON serialization against your configured database.
Then run `npm run dev` and request `GET /api/data/health`. A successful response
has `status: "ok"`, the engine version, access mode, and counts for properties,
suites, suite history, and rent evidence. BIGINT counts serialize as strings.
An unavailable database returns HTTP 503; details are logged only on the server.
This endpoint runs on every request and does not return tenant or rent records.

Server code can import `queryDuckDB` from `src/lib/duckdb.ts` and pass trusted SQL
with positional parameters (`?`). It returns JSON-safe rows. The module is
server-only, opens the file in `READ_ONLY` mode with external access disabled,
reuses the database instance, and closes each query connection. Do not pass
arbitrary client or LLM SQL to it; agent tools will supply reviewed queries.
Restart the app after changing `DUCKDB_PATH` or rebuilding/replacing the database.
Close any DuckDB writer/UI session if it prevents the backend from opening it.

Deployment requires a Node.js server with the database mounted at `DUCKDB_PATH`
and native DuckDB bindings available; the path on your laptop is local setup.
The existing demo page still uses sample data. The tenant-history agent is
available through `POST /api/chat`; connecting a chat UI is the next step. The database's availability and tenant records describe source
snapshots, not a live availability feed.

## Property, suite, and tenant-history tools

These server-only functions live in `src/lib/tools/costar.ts`. They use the same
`DUCKDB_PATH` and read-only connection as the health endpoint. They are backend
functions registered with the Gemini tenant-history agent described below.

```ts
import { find_properties, find_suites, get_tenant_history } from "@/lib/tools/costar";

const properties = await find_properties({ query: "6655 Travis St", city: "Houston", state: "TX" });
// Present multiple matches for clarification before choosing a property.
const suites = await find_suites({ property_id: "238587", suite: "Suite 900" });
// Preserve separate floor candidates; use the selected result's stable suite_id.
const history = await get_tenant_history({ suite_id: suites.items[0].suite_id });
```

- `find_properties({ query, city?, state?, limit?, offset? })` searches building
  names and primary addresses. Case, whitespace, and punctuation are normalized;
  every query token must occur in the name/address text. Exact names, street
  addresses, or full addresses rank before partial matches, then by property ID.
  City/state filters are case-insensitive exact matches. There is no typo matching
  or street-abbreviation expansion. Punctuation is a separator, never a SQL wildcard.
- `find_suites({ property_id, suite?, property_floor_id?, limit?, offset? })` lists
  recorded suites or filters by the database's exact normalized label. `Suite 900`,
  `STE. 900`, and `#900` match `900`; `0900` is distinct. Repeated labels on different
  floors remain separate results. Listing references do not duplicate suite rows.
  Missing property metadata is flagged in `warnings`.
- Both searches return `{ items, total, limit, offset }`. Defaults are 20 items and
  offset 0; limits must be integers from 1 to 100. Results never silently select a
  match. Empty pages retain the total match count.
- `get_tenant_history({ suite_id })` returns `status: "ok"` with suite identity,
  `supported_history`, `candidate_history`, and `issues`, or `status: "not_found"`
  for an unknown suite. An existing suite may have empty history. History arrays
  contain all suite-scoped source occurrences, ordered by timeline start (nulls
  last), occupancy ID, then history ID. Company names are not deduplication keys.

All identifiers and source-line numbers are strings, dates are JSON-safe strings,
and unavailable values stay null. Source references retain dataset, source line,
source file, record ID, and JSON Pointer when available. An unresolved source
record retains its dataset/line locator with null file and record ID. Raw source
payloads are never returned. History includes occupancy and company references;
suite identity includes its listing references, and issues carry their own evidence.

Invalid inputs throw `ToolValidationError`; unavailable databases and query failures
remain operational errors. Callers must handle these separately from empty results.
SQL is fixed by server code and values are bound as parameters.

Suites reflect the supplied listing catalog, not every possible suite or live
availability. Supported history records an association of suite label and floor;
it does not establish unchanged physical boundaries. Candidate history remains
uncertain. Overlaps, date problems, and conflicting evidence are retained in
`issues`. Missing records do not prove vacancy, and lease expiration is never
substituted for an occupancy end or evidence of current tenancy.

Verification:

```bash
npm run test:costar-tools   # isolated synthetic database; no private data needed
npm run check:costar-tools # real configured database; two known suite examples
npm run check:duckdb
```

The integration check compares both example suites with direct SQL and resolves
source references and JSON Pointers without saving or printing private records.

## Tenant-history agent and Claude fallback

Set `GEMINI_API_KEY` in the ignored `.env.local` file alongside `DUCKDB_PATH`.
The chat agent chooses `GEMINI_CHAT_MODEL`, then `GEMINI_MODEL`, then defaults to
`gemini-3.8-flash`. A chat-specific override leaves the spatial vision model alone.
Add `ANTHROPIC_API_KEY` to enable automatic Claude fallback. Claude uses
`ANTHROPIC_MODEL`, defaulting to `claude-sonnet-5-5`. If a key is not scoped to a
workspace, also set `ANTHROPIC_WORKSPACE_ID`; a workspace-scoped key needs no extra
setting. Model access and quota depend on the corresponding provider account.

Tool declarations and dispatch are provider independent. Gemini and Claude
adapters translate the same schemas into their native SDK formats, preserving
model content, thought signatures and tool-call IDs. The common loop executes
reviewed DuckDB queries, annotates sources and validates citations. Provider
objects and keys are not returned or logged. Implementation references:
[Gemini SDK](https://googleapis.github.io/js-genai/release_docs/),
[Claude tool results](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls),
and [Claude workspace authentication](https://platform.claude.com/docs/en/manage-claude/authentication).

With `npm run dev` running, send one question:

```bash
curl http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"question":"Who previously occupied Suite 900 at 6655 Travis St, Houston, TX?"}'
```

`POST /api/chat` accepts only `{ question: string }` (1–8000 characters; maximum
32 KiB request body). It returns `{ answer, sources, tool_calls, model, provider, fallback, routing }` with no
caching. Source references are assigned IDs such as `S1`, and the answer cites
`[S1]`. Only cited references are returned in `sources`. Unknown citations or
missing citations after evidence retrieval cause an explicit error. Citation
identity checks do not independently prove that every generated claim follows
from the cited evidence.

The agent is instructed to clarify ambiguous properties/suites, separate supported
history from uncertain candidates and retain date issues. Matterport/Vexcel tools
are available as described below; rent and availability tools remain unsupported. This is a
single-question endpoint: it accepts no client-supplied model/tool transcripts,
stores no conversation state, and has no chat UI or authentication layer yet.

Gemini runs first. Quota/rate limits (429), request timeouts, network failures
and temporary service errors (5xx) trigger one Claude attempt when its key is
configured. Claude starts from the original question, with a fresh transcript and
citation registry; read-only DuckDB calls may repeat. There is no switch back to
Gemini. Successful responses identify `provider` (`gemini` or `anthropic`) and
`fallback` (`null`, or `{ from: "gemini", reason: "RATE_LIMITED" }`, for example).
Only the answering provider's sources and tool-call summary are returned.

Invalid input, missing/invalid credentials or model configuration, database
failures, citation failures and loop-limit errors do not trigger fallback.
Ambiguity prompts are normal successful responses. Client cancellation stops the
request without starting Claude. With no Claude key, the original Gemini error
is returned.

Each provider attempt permits at most eight model turns and twelve tool calls.
The request has a 110-second overall abort budget: Gemini gets up to 30 seconds
and Claude up to 75 seconds, each constrained by the overall deadline. Individual
SDK requests time out after 30 seconds and automatic SDK retries are disabled.
Errors return `{ error: { code, message } }`: invalid input (400), oversized body
(413), final provider quota/rate limits (429), missing configuration/database
failures (503), cancellation/timeout (504), or provider/incomplete-response/
citation/loop-limit failures (502). If both providers fail, `error.attempts` lists
their provider names and sanitized error codes.

```bash
npm run test:tenant-agent          # deterministic model/dispatcher/HTTP validation tests
npm run check:tenant-agent:offline # scripted model + actual DuckDB tools; no Gemini calls
npm run check:tenant-agent         # live Gemini + Claude fallback + DuckDB; consumes API quota
```

The live check verifies all three tools were called, the answer mentions an actual
supported tenant, and its citations reference the selected suite's evidence. It
prints verification status and call names rather than private tenant records.
An exhausted Gemini quota exercises Claude fallback when its key is configured.
If neither provider is available, the live check fails explicitly. The offline check verifies orchestration and real data
access but does not establish live model behavior.

## Spatial backend and source-first routing

The backend now exposes seven tools to both model providers: the three DuckDB
property/suite/history tools plus `get_spatial_context`, `get_matterport_rooms`,
`inspect_matterport_features`, and `inspect_vexcel_site`. No chat UI is required;
use the existing `POST /api/chat` endpoint or invoke tools in a server-side script.
The legacy demo-card pipeline is separate and remains unchanged.

Source order follows the question: tenant history starts with DuckDB, interior
rooms/features with Matterport, and parking/outdoors with Vexcel. Property/suite
resolution and DuckDB coordinate/scan lookup are allowed before domain evidence.
A transparent keyword router recognizes the supported vocabulary and uses the
first mentioned domain for mixed questions; unknown wording leaves the primary
source unset and the model follows the source-first instructions. The execution
policy prevents a different domain from running before an attempt at the selected
primary source. It then permits other sources to supply missing evidence. This
is a bounded routing baseline, not a general intent classifier. `routing` reports
`primary_source`, `requested_sources`, and `unsupported_capabilities`.

Rent and availability tools were deliberately excluded from this increment. Those
questions are identified as unsupported rather than answered from tenant history.

### Tools and evidence limits

- `get_spatial_context({ property_id, suite_id? })` reads property coordinates and
  candidate model links from DuckDB. A suite ID must belong to the selected
  property. Links are building-level associations; a matching model name is only
  a suite hint. Shared models and index/segment conflicts remain visible. Empty
  model lists and missing properties are explicit results.
- `get_matterport_rooms({ model_id })` retrieves/caches actual model metadata and
  returns geometry-derived room counts, approximate area, Matterport's labels and
  panorama IDs. Void classifications, rooms below 2 square metres and unusable
  boundaries are excluded. No dummy inspection is substituted. Capture date and
  suite extent remain unverified. Multi-floor models omit panorama-to-room lists
  because the existing geometry association is two-dimensional.
- `inspect_matterport_features({ model_id, room_id?, max_panoramas? })` analyzes up
  to four horizontal faces from each selected panorama: one panorama by default,
  maximum two. Room IDs can target a single-floor scan; multi-floor room targeting
  requires verified floor association and is rejected for now. The default sample
  uses sorted panorama IDs. Reports include visible features, image IDs, evidence
  descriptions, limitations and sampled/available panorama counts. Sampling is
  explicitly non-exhaustive. Repeated views may show the same object; do not sum
  observations into a unique sink or cabinet inventory. `not_observed` means not
  visible in the sample, never proven absent.
- `inspect_vexcel_site({ latitude, longitude, half_width_m? })` validates coordinates,
  obtains ortho coverage, pins the newest dated collection and retrieves an aerial
  extract of a coordinate vicinity. The default square extends 80 metres from the
  center in each direction; allowed half-widths are 20–150 metres. Images are
  analyzed for visible parking, stalls, loading areas, outdoor space and trees.
  Collection capture date is retained but not certified as an exact pixel timestamp.
  This is not a verified parcel or evidence of parking ownership, available stalls
  today, legal boundaries, accessibility compliance or a certified count. Missing
  imagery is `no_coverage`, not zero parking.

New image analysis uses Gemini with Claude fallback for transient provider errors,
independently of conversational fallback. Provider output is runtime-validated:
observations must use recognized feature/status values and actual supplied image
IDs; unavailable/uncertain observations cannot have numerical counts. A rejected
report or unavailable visual provider is an explicit source failure. Validation
checks provenance and structure, not the correctness of visual interpretation.
Human review is still needed for consequential measurements and inventories.

Spatial references use dataset `matterport` or `vexcel`, `source_type`, record/image
IDs, capture/retrieval dates, scope and an `asset_path` to the private local image.
They have `source_line: null` rather than invented CSV line numbers. The common
citation registry supports both database and image evidence. Source failures
return `SOURCE_UNAVAILABLE` tool errors and `tool_calls.status: "unavailable"`,
allowing the model to explain missing evidence or use a relevant alternative;
they do not silently switch conversation providers or become empty successful data.

### Configuration and testing

Add `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`, and `VEXCEL_API_KEY` to `.env.local`.
Optional `GEMINI_VISION_MODEL` and `ANTHROPIC_VISION_MODEL` select image-analysis
models; the latter falls back to `ANTHROPIC_MODEL`. The defaults match the chat
providers. Keys stay on the server, and Vexcel uses the API-key header rather than
URLs. Network requests have time/size limits and do not log provider bodies.
Matterport downloads accept only HTTPS Matterport image hosts.

Metadata snapshots, content-hashed images and validated visual reports are stored
under ignored `cache/spatial-tools/`. `SPATIAL_CACHE_DIR` can override the location
for isolated tests. Cached metadata/reports are snapshots without automatic expiry;
remove the cache to refresh them. Reports are keyed by image content, analysis task
and model overrides. Only cached images are retained, not credential-bearing URLs
in returned evidence. Existing spatial scripts are not changed by this pipeline.

```bash
npm run test:spatial        # isolated HTTP/vision fixtures and routing checks
npm run test:costar-tools   # also tests coordinate/model context and suite mismatch
npm run test:tenant-agent   # both provider adapters and fallback regressions
npm run check:spatial       # live metadata, interior and aerial tools; consumes quota
npm run check:spatial-agent # also evaluates four live routing/combined-source cases
```

Live checks use Suite 900's recorded building association and independently verify
artifact hashes, observation image references, metadata limits and provider call
order. They do not establish suite extent, exact object counts or universal model
accuracy. The four agent cases cover rooms, sinks/cabinets, parking/outdoors and
history followed by interior evidence. No private image or fixture from the live
checks is committed to Git.
