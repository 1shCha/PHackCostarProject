"""Runs the agents for one suite and streams progress to the UI.

Current mode: a FIXED plan (code decides the order). It is demo-safe and looks identical on screen.
Next step (Role 3): add the Claude-on-Bedrock agent (Strands Agents) that picks tools itself for
free-form questions, and have Claude write `summary` from the agents' outputs. Keep the fixed plan
as the fallback for the live demo.
"""
import asyncio
from collections.abc import AsyncIterator

from . import tools

# (agent name shown in UI, function, message while working)
TENANT_PLAN = [
    ("Listing", lambda k: ("suite", tools.suite(k)), "Reading the listing..."),
    ("History", lambda k: ("history", tools.history(k)), "Tracing who was in this space..."),
    ("Space Inspector", lambda k: ("inspect", tools.inspect(k)), "Labeling rooms in the 3D scan..."),
    ("Fit", lambda k: ("fit", tools.fit(k)), "Checking the layout against your needs..."),
    ("Tenant Mix", lambda k: ("tenant_mix", tools.tenant_mix(k)), "Checking who else is in the building..."),
    ("Site", lambda k: ("site", tools.site(k)), "Looking at the building from above..."),
    ("Pricing", lambda k: ("pricing", tools.pricing(k)), "Pulling signed deals nearby..."),
    ("Negotiator", lambda k: ("negotiate", tools.negotiate(k, "tenant")), "Drafting the offer letter..."),
]

LANDLORD_PLAN = [
    ("Listing", lambda k: ("suite", tools.suite(k)), "Reading the listing..."),
    ("History", lambda k: ("history", tools.history(k)), "Tracing who was in this space..."),
    ("Space Inspector", lambda k: ("inspect", tools.inspect(k)), "Labeling rooms in the 3D scan..."),
    ("Tenant Mix", lambda k: ("tenant_mix", tools.tenant_mix(k)), "Checking who else is in the building..."),
    ("Pricing", lambda k: ("pricing", tools.pricing(k)), "Pulling signed deals nearby..."),
    ("Prospects", lambda k: ("prospects", tools.prospects(k)), "Finding businesses whose leases end soon..."),
    ("Negotiator", lambda k: ("negotiate", tools.negotiate(k, "landlord")), "Drafting outreach..."),
]


def _summary(card: dict, mode: str) -> str:
    """Placeholder summary built by code. Role 3: replace with Claude writing it from `card`."""
    s, h, mix, p = card.get("suite", {}), card.get("history", {}), card.get("tenant_mix", {}), card.get("pricing", {})
    past = next((e for e in h.get("timeline", []) if e.get("match") == "confirmed"), None)
    parts = [f"Suite {s.get('suite')} at {s.get('address')} ({int(s.get('sqft') or 0):,} sq ft)."]
    if past:
        parts.append(f"{past['tenant']} was here {past['from'][:4]}–{(past.get('to') or 'now')[:4]}.")
    if mix.get("complements"):
        parts.append(f"Best next use: {mix['complements'][0]['category'].replace('_', ' ')}.")
    if p.get("target_rent_psf_yr"):
        parts.append(f"Target rent about ${p['target_rent_psf_yr']}/sf/yr from {p.get('n_deals')} signed deals.")
    return " ".join(parts)


async def run(key: str, mode: str = "tenant", delay: float = 0.6) -> AsyncIterator[dict]:
    plan = TENANT_PLAN if mode == "tenant" else LANDLORD_PLAN
    card: dict = {}
    for agent, fn, message in plan:
        yield {"type": "progress", "agent": agent, "status": "working", "message": message}
        await asyncio.sleep(delay)  # remove once agents do real work
        try:
            field, value = await asyncio.to_thread(fn, key)
            card[field] = value
            yield {"type": "progress", "agent": agent, "status": "done", "message": message.replace("...", " ✓"),
                   "field": field, "value": value}
        except Exception as exc:  # one agent failing must not kill the demo
            yield {"type": "progress", "agent": agent, "status": "error", "message": str(exc)}
    card["summary"] = _summary(card, mode)
    yield {"type": "result", "card": card}
