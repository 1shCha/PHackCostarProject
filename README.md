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
