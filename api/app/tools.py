"""Every SecondLife agent is one function here.

Today each returns its fixture. To plug in real code: replace the function body, keep the
signature and the return shape from contracts/README.md. The orchestrator and UI won't change.
"""
from .fixtures import load

# ---------------- Role 1 · CoStar Brain ----------------

def suite(key: str) -> dict:
    """Suite facts: address, size, asking rent, use, listing notes, Matterport model, lat/lon."""
    return load(key, "suite")


def history(key: str) -> dict:
    """Tenant timeline with match confidence, plus likely build-out."""
    return load(key, "history")


def tenant_mix(key: str) -> dict:
    """Current tenants in the building by category; conflicts (same specialty) and complements."""
    return load(key, "tenant_mix")


def pricing(key: str, industry: str | None = None) -> dict:
    """Target rent from signed deals (code does the math), re-leasing value, build-out savings."""
    return load(key, "pricing")


def prospects(key: str) -> dict:
    """Companies in a matching category whose leases end soon."""
    return load(key, "prospects")


def negotiate(key: str, mode: str, context: dict | None = None) -> dict:
    """Offer letter (tenant mode) or outreach email (landlord mode), written from the pricing numbers."""
    out = load(key, "negotiate")
    out["mode"] = mode
    return out


# ---------------- Role 2 · Spatial Eyes ----------------

def inspect(key: str) -> dict:
    """Matterport: labeled rooms (polygons in floor plan pixels) and feature pins."""
    return load(key, "inspect")


def fit(key: str, needs: list[str] | None = None) -> dict:
    """Does a business's required layout fit this space? Plus accessibility checks."""
    return load(key, "fit")


def site(key: str) -> dict:
    """Vexcel: aerial image, parking count, frontage."""
    return load(key, "site")
