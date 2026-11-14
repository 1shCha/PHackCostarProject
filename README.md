# SecondLife

**Every commercial space remembers who was there.** SecondLife reads a suite's tenant history, checks what's built into it (Matterport), looks at it from above (Vexcel), and matches it to the business that values it most, with a target rent backed by real signed deals.

HackPrinceton Fall 2026 · CoStar track ("Inside and Out: AI for the Built World") · Business & Enterprise · Amazon "Best Practical AI" · Peri "Forward Deployed"

---

## Repo layout

```
api/          FastAPI backend + orchestrator (Role 3). Agents are plain Python functions in api/app/tools.py
contracts/    The JSON shape every agent returns. Agree here before building.
fixtures/
  demo/       Placeholder outputs for the demo suite (committed, invented values)
  real/       Real outputs built from the CoStar kit (NOT committed: public repo)
pipeline/     Scripts that read the CoStar kit (Role 1 starts here)
data/kit/     Unzipped CoStar kit goes here (NOT committed)
web/          Next.js frontend (Role 3)
```

## Setup (10 minutes)

**1. Secrets.** Copy `.env.example` to `.env` and fill in keys from `/costar-keys` in Discord. Never commit `.env`.

**2. CoStar kit.** Unzip `costar-hackathon-kit.zip` (password in Discord) so that `data/kit/data/location-occupancy.jsonl` exists.

**3. Build real fixtures for the demo suite** (optional, needs step 2):
```bash
python3 pipeline/build_fixtures.py
```
This writes `fixtures/real/travis_900/*.json`. The backend uses real files when they exist and falls back to `fixtures/demo/`.

**4. Backend** (terminal 1):
```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Check: http://localhost:8000/health

**5. Frontend** (terminal 2):
```bash
cd web
npm install
npm run dev
```
Open http://localhost:3000

## How the pieces connect

```
Role 1 (CoStar)  history() pricing() prospects() tenant_mix() negotiate() ─┐
                                                                           ├─► api/app/orchestrator.py ─► /run (live events) ─► web Space Card
Role 2 (Spatial) inspect() fit() site() ───────────────────────────────────┘
```

- Every agent is a function in `api/app/tools.py`. Today each returns its fixture. **To plug in your real code, replace the body of your function and keep the return shape from `contracts/README.md`.**
- `POST /run` streams progress events (`{agent, status, message}`) and finally the full Space Card, so the UI fills in live.

## Who owns what

| Role | Owns | Files |
|---|---|---|
| 1 · CoStar Brain | history, pricing, prospects, tenant mix, negotiate | `pipeline/`, the Role 1 functions in `api/app/tools.py` |
| 2 · Spatial Eyes | inspect, fit, site (Matterport + Vexcel) | the Role 2 functions in `api/app/tools.py`, `web/public/demo/` floor plans |
| 3 · Product | orchestrator, frontend, pitch | `api/app/orchestrator.py`, `api/app/main.py`, `web/` |

## Team rules

- Work on a branch (`role1/...`, `role2/...`, `role3/...`), open small PRs, merge often.
- Don't change a contract shape without telling the team in Discord.
- Nothing from the CoStar kit gets committed (public repo). Fixtures with real data stay in `fixtures/real/`.
- Mark invented numbers with `"_fake": true` so they never reach the final demo.
