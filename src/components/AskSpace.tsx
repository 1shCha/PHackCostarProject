"use client";

// "Ask this space": speak or type a question about the suite.
// The question goes to the chat agent (/api/chat). The answer is shown, read out loud,
// and the matching card builds itself underneath. If the agent is unavailable,
// a short answer is built from the card data so the demo never breaks.

import { useEffect, useState } from "react";
import type { Card } from "@/agents";
import { parseCommand } from "@/lib/voice/commands";

export type Topic = "history" | "fit" | "pricing" | "neighbors" | "prospects" | "general";

export type Answer = { question: string; text: string; topic: Topic; live: boolean };

const SUGGESTIONS = [
  "What was here before?",
  "Would this work for a dermatologist?",
  "What's a fair rent?",
  "Who should lease this next?",
];

// Minimal types for the browser speech API (Chrome ships it as webkitSpeechRecognition).
export type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
export type RecognitionCtor = new () => Recognition;

export function getRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Decide which card answers the question.
export function topicOf(q: string): Topic {
  const t = q.toLowerCase();
  if (/(next|who should|prospect|lease this|best fit|best use|tenant for|match)/.test(t)) return "prospects";
  if (/(rent|price|cost|pay|fair|deal|free month|\$)/.test(t)) return "pricing";
  if (/(neighbo|building|nearby|competit|conflict|refer)/.test(t)) return "neighbors";
  if (/(before|history|used to|previous|past|who was|was here|occupied|empty|vacan|how long)/.test(t)) return "history";
  if (/(work for|fit|room|exam|procedure|sink|layout|floor|dermatolog|dentist|clinic|doctor|need)/.test(t)) return "fit";
  return "general";
}

const year = (d: string | null) => (d ? d.slice(0, 4) : "today");

// A short spoken-style answer from the card data, used when the agent is unavailable.
export function offlineAnswer(card: Card, topic: Topic): string {
  const { suite: s, history, inspect, pricing, tenant_mix: mix, fit, prospects } = card;
  switch (topic) {
    case "history": {
      const known = history.timeline.filter((e) => e.category !== "unknown");
      const parts = known.map((e) => `${e.tenant} from ${year(e.from)} to ${year(e.to)}`);
      const last = [...history.timeline].sort((a, b) => (b.to ?? "").localeCompare(a.to ?? ""))[0];
      return `Suite ${s.suite} has been home to ${parts.join(", then ")}. ${
        last?.to ? `It has been empty since ${year(last.to)}.` : ""
      }`;
    }
    case "fit": {
      if (!fit.checks.length) {
        const past = history.timeline.filter((e) => e.tenant && !/not recorded/i.test(e.tenant));
        const last = past[past.length - 1];
        return `Suite ${s.suite} doesn't have a labeled 3D scan yet, so I can't check its rooms. From CoStar, it's ${Math.round(
          s.sqft,
        ).toLocaleString()} square feet${last ? `, and ${last.tenant} was here before` : ""}. Ask the landlord for a walkthrough.`;
      }
      const pass = fit.checks.filter((c) => c.status === "pass");
      const open = fit.checks.filter((c) => c.status !== "pass");
      const lead =
        pass.length === fit.checks.length ? "Yes, it looks like a strong fit." :
        pass.length * 2 >= fit.checks.length ? "Mostly." : "Only partly.";
      const rooms = Object.entries(inspect.counts)
        .filter(([k, n]) => n > 0 && ["exam_room", "procedure", "office", "reception"].includes(k))
        .map(([k, n]) => `${n} ${k.replace("_", " ")}${n > 1 ? "s" : ""}`);
      const short = (need: string) => need.replace(/\s*\(.*?\)/g, "").toLowerCase();
      return `${lead} ${pass.length} of ${fit.checks.length} needs are met${pass.length ? `: ${pass.map((c) => short(c.need)).join(", ")}` : ""}.${
        open.length ? ` Still to check: ${open.map((c) => short(c.need)).join(", ")}.` : ""
      }${rooms.length ? ` The scan shows ${rooms.join(", ")}.` : ""}`;
    }
    case "pricing": {
      const [lo, hi] = pricing.range_psf_yr;
      return `A fair rent is about $${pricing.target_rent_psf_yr.toFixed(2)} per square foot per year, based on ${pricing.n_deals} recent deals that ranged from $${lo} to $${hi}. The asking rent is $${s.asking_rent_psf_yr}.`;
    }
    case "neighbors": {
      if (!mix.total_current && !mix.complements.length && !mix.conflicts.length) {
        return `I don't have the current tenant list for ${s.address} yet, so I can't say who the neighbors are.`;
      }
      const comp = mix.complements[0];
      const conf = mix.conflicts[0];
      return `There are ${mix.total_current} tenants in the building. ${comp ? comp.reason : ""} ${
        conf ? `One thing to watch: ${conf.reason}` : ""
      }`;
    }
    case "prospects": {
      if (!prospects.companies.length) return `I haven't ranked next tenants for Suite ${s.suite} yet. ${prospects.coverage_note}`;
      const top = prospects.companies.slice(0, 3);
      return `The best next tenants are ${top.map((c) => c.name).join(", ")}. ${top[0] ? `${top[0].name}: ${top[0].reason}.` : ""}`;
    }
    default: {
      const note = s.listing_notes.find((n) => n && !/placeholder|example/i.test(n)) ?? "";
      return `Suite ${s.suite} at ${s.address} is ${Math.round(s.sqft).toLocaleString()} square feet. ${note}`.trim();
    }
  }
}

// Strip markdown and keep the first few sentences so the spoken answer stays short.
// Remove source tags like [S3] from text shown or read out loud.
export function cleanAnswer(text: string) {
  return text.replace(/\s*\[S\d+\](\s*\[S\d+\])*/g, "").replace(/[ \t]+([.,;:])/g, "$1").trim();
}

export function forSpeech(text: string) {
  const plain = cleanAnswer(text).replace(/[*_#`>\[\]]/g, "").replace(/\(https?:[^)]+\)/g, "").replace(/\s+/g, " ").trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [plain];
  return sentences.slice(0, 3).join(" ");
}

export function TopicCard({ card, topic }: { card: Card; topic: Topic }) {
  const { history, inspect, pricing, tenant_mix: mix, fit, prospects } = card;
  // Nothing real to show for this suite: no card at all (never an empty or borrowed one).
  if (topic === "fit" && !fit.checks.length) return null;
  if (topic === "prospects" && !prospects.companies.length) return null;
  if (topic === "neighbors" && !mix.complements.length && !mix.conflicts.length) return null;
  if (topic === "history" && !history.timeline.length) return null;

  if (topic === "history") {
    return (
      <div className="ask-card">
        <p className="ask-card-label">Then · tenant history</p>
        <ol className="ask-timeline">
          {history.timeline.map((e, i) => (
            <li key={i} style={{ animationDelay: `${i * 140}ms` }}>
              <b>
                {year(e.from)}–{year(e.to)}
              </b>
              <span>{e.tenant}</span>
              <em>{e.match.replace("_", " ")}</em>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (topic === "fit") {
    return (
      <div className="ask-card">
        <p className="ask-card-label">Now · what the scan shows</p>
        <ul className="ask-checks">
          {[...fit.checks, ...fit.accessibility.map((a) => ({ need: a.check, status: a.status, evidence: a.evidence }))].map(
            (c, i) => (
              <li key={i} className={c.status} style={{ animationDelay: `${i * 120}ms` }}>
                <b>{c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : "?"}</b>
                <span>{c.need}</span>
                <em>{c.evidence}</em>
              </li>
            ),
          )}
        </ul>
        <p className="ask-foot">
          {inspect.rooms.length} rooms labeled from the 3D scan
        </p>
      </div>
    );
  }

  if (topic === "pricing") {
    const [lo, hi] = pricing.range_psf_yr;
    const pos = hi > lo ? ((pricing.target_rent_psf_yr - lo) / (hi - lo)) * 100 : 50;
    return (
      <div className="ask-card">
        <p className="ask-card-label">Fair rent · {pricing.n_deals} recent deals</p>
        <p className="ask-big">
          ${pricing.target_rent_psf_yr.toFixed(2)}
          <small>/sf/yr</small>
        </p>
        <div className="ask-range">
          <span style={{ left: `${pos}%` }} />
        </div>
        <div className="ask-range-labels">
          <span>${lo}</span>
          <span>${hi}</span>
        </div>
      </div>
    );
  }

  if (topic === "neighbors") {
    return (
      <div className="ask-card">
        <p className="ask-card-label">Good neighbors · {mix.total_current} tenants in the building</p>
        <ul className="ask-checks">
          {mix.complements.map((c, i) => (
            <li key={`c${i}`} className="pass" style={{ animationDelay: `${i * 120}ms` }}>
              <b>+</b>
              <span>{c.category}</span>
              <em>{c.reason}</em>
            </li>
          ))}
          {mix.conflicts.map((c, i) => (
            <li key={`x${i}`} className="fail" style={{ animationDelay: `${(i + 1) * 120}ms` }}>
              <b>!</b>
              <span>{c.category}</span>
              <em>{c.reason}</em>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (topic === "prospects") {
    return (
      <div className="ask-card">
        <p className="ask-card-label">Who should be here next</p>
        <ol className="ask-prospects">
          {prospects.companies.slice(0, 3).map((c, i) => (
            <li key={c.name} style={{ animationDelay: `${i * 160}ms` }}>
              <b>{i + 1}</b>
              <div>
                <span>{c.name}</span>
                <em>{c.reason}</em>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return null;
}

// Ask the chat agent; fall back to an answer built from the card if it is unavailable or slow.
// With no suite open (home, results), the question goes to the agent as asked, and there is no card to fall back on.
const NO_SUITE_HINT =
  "Open a suite first, or tell me what you're looking for. For example: I'm a dermatologist looking for 6,000 square feet in Houston.";

export async function fetchAnswer(card: Card, question: string, suiteOpen = true): Promise<Answer> {
  const clean = question.trim();
  const topic = topicOf(clean);
  const s = card.suite;
  if (!suiteOpen) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: `${clean} Answer in 2-3 short sentences.` }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { answer?: string };
        const text = data.answer?.trim() ? cleanAnswer(data.answer) : "";
        if (text) return { question: clean, text, topic: "general", live: true };
      }
    } catch {
      // fall through to the hint
    }
    return { question: clean, text: NO_SUITE_HINT, topic: "general", live: false };
  }
  // The live agent answers tenant-history and general questions from the CoStar database (fast, cited).
  // Rooms/fit, rent, neighbors and prospects come from the card (instant, and the agent has no rent data yet).
  if (topic !== "history" && topic !== "general") {
    return { question: clean, text: offlineAnswer(card, topic), topic, live: false };
  }
  // Until Role 1's real suite data lands, the card still has the sample address; ask about the real demo suite.
  const address = /example/i.test(s.address) ? "6655 Travis St" : s.address;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: `About Suite ${s.suite} at ${address}, ${s.city}: ${clean} Answer in 2-3 short sentences.`,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { answer?: string };
      const text = data.answer?.trim() ? cleanAnswer(data.answer) : "";
      // If the agent says it can't answer, use the card instead of reading a refusal out loud.
      const refused = /\b(i can'?t|i cannot|i'?m unable|don'?t support|not supported|no data|isn'?t available)\b/i.test(text.slice(0, 160));
      if (text && !refused) return { question: clean, text, topic, live: true };
    }
  } catch {
    // Agent unavailable or too slow: use the card-based answer below.
  }
  return { question: clean, text: offlineAnswer(card, topic), topic, live: false };
}

// Typed questions on the Suite page. Voice goes through the floating voice orb on every page.
export default function AskSpace({ card }: { card: Card }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  async function ask(q: string) {
    const clean = q.trim();
    if (!clean || loading) return;
    // Typed commands ("show me inside", "next room", "go back") go to the same place as voice commands.
    if (parseCommand(clean, { inTour: false }).kind !== "ask") {
      window.dispatchEvent(new CustomEvent("sl-command", { detail: clean }));
      setQuestion("");
      return;
    }
    setQuestion(clean);
    setLoading(true);
    setAnswer(null);
    const a = await fetchAnswer(card, clean);
    setAnswer(a);
    setLoading(false);
  }

  return (
    <section className="ask-space">
      <div className="ask-head">
        <p className="kicker">Ask this space</p>
        <p className="ask-hint">or just say “Hey SecondLife…”</p>
      </div>

      <form
        className="ask-bar"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about this suite"
          aria-label="Question about this space"
        />
        <button type="submit" className="primary" disabled={loading || !question.trim()}>
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="ask-suggestions">
        {SUGGESTIONS.map((q) => (
          <button key={q} type="button" onClick={() => ask(q)} disabled={loading}>
            {q}
          </button>
        ))}
      </div>

      {loading && (
        <div className="ask-thinking" aria-live="polite">
          <span />
          <span />
          <span />
          Checking tenant history, the scan and recent deals…
        </div>
      )}

      {answer && (
        <div className="ask-answer" aria-live="polite">
          <p className="ask-q">“{answer.question}”</p>
          <p className="ask-text">{answer.text}</p>
          <p className="ask-src">{answer.live ? "Live answer from CoStar data" : "Answer from this suite’s card"}</p>
          <TopicCard card={card} topic={answer.topic} />
        </div>
      )}
    </section>
  );
}
