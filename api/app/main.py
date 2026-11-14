"""SecondLife API.

GET  /health                 -> ok + which suites have fixtures
GET  /suites/{key}/card      -> the whole Space Card at once (handy for debugging)
POST /run {key, mode}        -> Server-Sent Events: progress events, then {"type": "result", "card": {...}}
"""
import json

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import orchestrator
from .fixtures import available_suites

load_dotenv()

app = FastAPI(title="SecondLife API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    key: str = "travis_900"
    mode: str = "tenant"  # "tenant" | "landlord"
    delay: float = 0.6


@app.get("/health")
def health():
    return {"ok": True, "suites": available_suites()}


@app.get("/suites/{key}/card")
async def card(key: str, mode: str = "tenant"):
    result = {}
    async for event in orchestrator.run(key, mode, delay=0):
        if event["type"] == "result":
            result = event["card"]
    return result


@app.post("/run")
async def run(req: RunRequest):
    async def stream():
        async for event in orchestrator.run(req.key, req.mode, req.delay):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
