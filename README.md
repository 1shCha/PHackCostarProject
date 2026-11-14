# SecondLife

Every commercial space remembers who was there. SecondLife reads a suite's tenant history, checks what's built into it, and matches it to the business that values it most.

## Run it

```bash
npm install
npm run dev
```
Open http://localhost:3000

## The 3 files that matter

| File | What it is |
|---|---|
| `data/demo.json` | Sample answer for every agent. **This is the shape your code must return.** |
| `src/agents.ts` | One function per agent. Replace the body of yours with real code. |
| `src/app/page.tsx` | The screen that shows the results. |

## Rules

- Work on your own branch, open small pull requests.
- Copy `.env.example` to `.env` for keys. Never commit `.env`.
- Never commit the CoStar kit. Put it in `data/kit/` (ignored by git). This repo is public.
