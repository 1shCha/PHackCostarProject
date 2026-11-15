"use client";

// Hands-free voice control for the whole app.
// Say "Hey SecondLife, …" on any page. Inside the 3D tour, short commands work without the wake phrase
// ("next room", "turn around", "give me a 360", "exit tour").

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/agents";
import { fetchAnswer, forSpeech, getRecognition, TopicCard, type Answer, type Recognition, type Topic } from "@/components/AskSpace";
import { HELP_GROUPS, parseCommand, ROOM_NAMES, splitWake, type Command, type Mode, type RoomKey } from "@/lib/voice/commands";
import { connectSdk, keyForLabel, TourController, tourSrc } from "@/lib/tour/controller";

export type NavCommand =
  | Extract<Command, { kind: "nav.search" | "nav.open" | "nav.offer" | "nav.back" | "nav.home" | "nav.mode" }>
  | { kind: "nav.scroll"; topic: Topic };

type Phase = "off" | "idle" | "awake" | "thinking" | "speaking";
type TourStatus = "loading" | "ready" | "basic" | "error";

const SDK_KEY = process.env.NEXT_PUBLIC_MATTERPORT_SDK_KEY?.trim() || undefined;
const STORE = "secondlife-voice";
// After "Hey SecondLife", keep listening without the wake phrase until you say "that's all"
// or stay quiet this long.
const CONVO_MS = 60_000;

// In the tour we listen without the wake phrase, so only act on real questions, not background chatter.
const QUESTION = /^(what|who|how|why|is|are|was|were|does|do|did|can|could|would|should|where|when|which|tell me|show me|describe)\b/;

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.12;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
    setTimeout(() => ctx.close(), 700);
  } catch {
    // No audio output: the orb still changes color.
  }
}

// What the scan and the card say about the room you're standing in.
function describeRoom(card: Card, key: RoomKey | null, name: string): string {
  if (!key) return `You're in ${name === "this area" ? "an unlabeled part of the suite" : `the ${name}`}. Say "next room" to keep walking.`;
  const rooms = card.inspect.rooms.filter((r) => keyForLabel(r.label.replace(/_/g, " ")) === key);
  const features = [...new Set(rooms.flatMap((r) => r.features.map((f) => f.type.replace(/_/g, " "))))];
  const count = rooms.length > 1 ? ` There are ${rooms.length} like it in this suite.` : "";
  const built = card.history.likely_buildout.find((b) => b.feature.toLowerCase().includes(ROOM_NAMES[key].split(" ")[0]));
  const featureText = features.length ? ` The scan shows ${features.join(", ")}.` : "";
  const builtText = built ? ` Built in by a past tenant, from the ${built.source}.` : "";
  return `You're in the ${ROOM_NAMES[key]}.${featureText}${count}${builtText}`;
}

function TourOverlay({
  modelId,
  title,
  onController,
  onStatus,
  roomName,
  status,
  close,
}: {
  modelId: string;
  title: string;
  onController: (c: TourController | null) => void;
  onStatus: (s: TourStatus) => void;
  roomName: string;
  status: TourStatus;
  close: () => void;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const connected = useRef(false);

  async function onLoad() {
    if (connected.current || !frame.current) return;
    connected.current = true;
    if (!SDK_KEY) return onStatus("basic");
    try {
      const sdk = await connectSdk(frame.current, SDK_KEY);
      onController(new TourController(sdk));
      onStatus("ready");
    } catch {
      onStatus("error");
    }
  }

  return (
    <div className="tour-overlay" role="dialog" aria-label={`3D tour of ${title}`}>
      <iframe
        ref={frame}
        src={tourSrc(modelId, SDK_KEY)}
        title={`3D tour of ${title}`}
        allow="fullscreen; xr-spatial-tracking"
        allowFullScreen
        onLoad={onLoad}
      />
      <div className="tour-top">
        <div className="tour-room">
          <span className="tour-room-dot" />
          {status === "ready" ? roomName : status === "loading" ? "Loading the scan…" : title}
        </div>
        <button className="tour-exit" onClick={close}>
          Exit tour
        </button>
      </div>
      <div className="tour-hints">
        {(status === "ready"
          ? ["“Next room”", "“Turn around”", "“Give me a 360”", "“Take me to the office”", "“Dollhouse”", "“What’s in this room?”", "“Exit tour”"]
          : ["Drag to look around", "Click the floor to walk", "“Exit tour”"]
        ).map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </div>
  );
}

export default function VoiceLayer({
  card,
  mode,
  onNav,
}: {
  card: Card;
  mode: Mode;
  onNav: (c: NavCommand) => string | void;
}) {
  const [phase, setPhase] = useState<Phase>("off");
  const [supported, setSupported] = useState(true);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [help, setHelp] = useState(false);
  const [micError, setMicError] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStatus, setTourStatus] = useState<TourStatus>("loading");
  const [roomName, setRoomName] = useState("");
  const [missed, setMissed] = useState(""); // heard something, but without "Hey SecondLife"
  const micLive = useRef(false);

  const rec = useRef<Recognition | null>(null);
  const enabled = useRef(false);
  const paused = useRef(false);
  const awakeUntil = useRef(0);
  const convo = useRef(false); // in a conversation: no wake phrase needed
  const fresh = useRef(false); // the very next sentence after "Hey SecondLife" is always accepted
  const busy = useRef(false);
  const tourOpenRef = useRef(false);
  const tourStatusRef = useRef<TourStatus>("loading");
  const controller = useRef<TourController | null>(null);
  const pending = useRef<Command | null>(null);
  const handleRef = useRef<(text: string) => void>(() => {});
  const speakTimer = useRef<number | undefined>(undefined);

  // ---------- Microphone ----------
  const startRec = useCallback(() => {
    if (!enabled.current || paused.current) return;
    try {
      rec.current?.start();
    } catch {
      // Already listening.
    }
  }, []);

  const pauseRec = useCallback(() => {
    paused.current = true;
    try {
      rec.current?.stop();
    } catch {
      // Not listening.
    }
  }, []);

  const resumeRec = useCallback(() => {
    paused.current = false;
    window.setTimeout(startRec, 250);
  }, [startRec]);

  const wake = useCallback(() => {
    if (!convo.current && Date.now() >= awakeUntil.current) chime();
    convo.current = true;
    fresh.current = true;
    awakeUntil.current = Date.now() + CONVO_MS;
    setPhase("awake");
  }, []);

  // One finished sentence from the microphone.
  const heardFinal = useCallback(
    (text: string) => {
      const { woke, rest } = splitWake(text);
      if (woke) {
        wake();
        setHeard(rest);
        if (rest) handleRef.current(rest);
      } else if (tourOpenRef.current || convo.current || Date.now() < awakeUntil.current) {
        handleRef.current(text);
      } else if (text.trim().split(/\s+/).length >= 2) {
        // Show what was heard so it's obvious the mic works and the wake phrase is what's missing.
        setMissed(text.trim());
      }
    },
    [wake],
  );

  const setupRec = useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? "";
        if (!text.trim()) continue;
        const { woke, rest } = splitWake(text);
        if (res.isFinal) {
          heardFinal(text);
          continue;
        }
        const listening = woke || tourOpenRef.current || convo.current || Date.now() < awakeUntil.current;
        if (listening) setHeard(woke ? rest : text.trim());
        if (woke) wake();
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        enabled.current = false;
        setPhase("off");
        setMicError("Microphone is blocked. Click the lock icon in the address bar, allow the microphone, then tap the orb.");
      } else if (e.error === "audio-capture") {
        enabled.current = false;
        setPhase("off");
        setMicError("No microphone found. Plug one in and tap the orb.");
      }
      // "no-speech", "aborted" and "network" are normal; onend restarts listening.
    };
    // Chrome stops listening every so often. Restart unless we paused on purpose (while speaking).
    r.onstart = () => {
      micLive.current = true;
    };
    r.onend = () => {
      micLive.current = false;
      if (enabled.current && !paused.current) window.setTimeout(startRec, 250);
    };
    return r;
  }, [heardFinal, startRec, wake]);

  const enable = useCallback(() => {
    if (!rec.current) rec.current = setupRec();
    if (!rec.current) return;
    enabled.current = true;
    paused.current = false;
    setMicError("");
    setPhase("idle");
    try {
      localStorage.setItem(STORE, "1");
    } catch {
      // Storage blocked: voice still works this session.
    }
    startRec();
  }, [setupRec, startRec]);

  const disable = useCallback(() => {
    enabled.current = false;
    awakeUntil.current = 0;
    setPhase("off");
    window.speechSynthesis?.cancel();
    try {
      rec.current?.stop();
      localStorage.removeItem(STORE);
    } catch {
      // Ignore.
    }
  }, []);

  useEffect(() => {
    if (!getRecognition()) {
      setSupported(false);
      return;
    }
    let on = false;
    try {
      on = localStorage.getItem(STORE) === "1";
    } catch {
      on = false;
    }
    if (on) enable();
    return () => {
      enabled.current = false;
      try {
        rec.current?.stop();
      } catch {
        // Ignore.
      }
      window.speechSynthesis?.cancel();
    };
  }, [enable]);

  // ---------- Talking back ----------
  const speak = useCallback(
    (text: string) => {
      const line = forSpeech(text);
      if (!line || !window.speechSynthesis) return;
      window.clearTimeout(speakTimer.current);
      window.speechSynthesis.cancel();
      pauseRec(); // don't let the app hear itself
      setPhase("speaking");
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1.04;
      const done = () => {
        window.clearTimeout(speakTimer.current);
        if (convo.current) awakeUntil.current = Date.now() + CONVO_MS;
        setPhase(!enabled.current ? "off" : convo.current ? "awake" : "idle");
        resumeRec();
      };
      u.onend = done;
      u.onerror = done;
      // Safety net: Chrome sometimes never fires onend.
      speakTimer.current = window.setTimeout(done, 2500 + line.split(" ").length * 450);
      window.speechSynthesis.speak(u);
    },
    [pauseRec, resumeRec],
  );

  const say = useCallback(
    (text: string, spoken = true) => {
      setReply(text);
      if (spoken && text) speak(text);
    },
    [speak],
  );

  // ---------- 3D tour ----------
  const refreshRoom = useCallback(() => {
    const c = controller.current;
    if (c) setRoomName(c.currentRoomName().replace(/^./, (m) => m.toUpperCase()));
  }, []);

  const runTour = useCallback(
    async (cmd: Command) => {
      const c = controller.current;
      if (tourStatusRef.current === "loading" || (tourStatusRef.current === "ready" && !c?.ready)) {
        pending.current = cmd;
        setReply("Loading the scan…");
        return;
      }
      if (!c) {
        say("I can show you the tour, but moving it by voice needs the Matterport SDK key. Drag inside the tour to look around.");
        return;
      }
      let r;
      switch (cmd.kind) {
        case "tour.next":
          r = await c.next();
          break;
        case "tour.prev":
          r = await c.previous();
          break;
        case "tour.goto":
          r = await c.goTo(cmd.room);
          break;
        case "tour.turn":
          setReply(cmd.degrees === 180 ? "Turning around" : cmd.degrees < 0 ? "Turning left" : "Turning right");
          r = await c.turn(cmd.degrees);
          break;
        case "tour.look":
          setReply(cmd.degrees > 0 ? "Looking up" : "Looking down");
          r = await c.look(cmd.degrees);
          break;
        case "tour.spin":
          setReply("Here's the full 360");
          r = await c.spin();
          break;
        case "tour.dollhouse":
          r = await c.dollhouse();
          break;
        case "tour.floorplan":
          r = await c.floorplan();
          break;
        case "tour.inside":
          r = await c.insideView();
          break;
        case "tour.where":
          say(describeRoom(card, c.currentRoomKey(), c.currentRoomName()));
          return;
        default:
          return;
      }
      refreshRoom();
      if (r.say) say(r.say, true);
    },
    [card, refreshRoom, say],
  );

  const openTour = useCallback(
    (then?: Command) => {
      setAnswer(null);
      setHelp(false);
      if (!card.suite.matterport_model_id) {
        say(`Suite ${card.suite.suite} doesn't have a 3D scan yet. Suite 900 at 6655 Travis does.`);
        return;
      }
      pending.current = then ?? null;
      if (!tourOpenRef.current) {
        tourOpenRef.current = true;
        tourStatusRef.current = "loading";
        setTourStatus("loading");
        setTourOpen(true);
      }
      if (!then) say("Here's the 3D tour. Say next room, turn around, or give me a 360. Say exit tour when you're done.");
      else setReply("Opening the 3D tour…");
    },
    [card.suite.matterport_model_id, card.suite.suite, say],
  );

  const closeTour = useCallback(() => {
    tourOpenRef.current = false;
    pending.current = null;
    controller.current?.dispose();
    controller.current = null;
    setTourOpen(false);
    setReply("");
  }, []);

  const onController = useCallback(
    (c: TourController | null) => {
      controller.current?.dispose();
      controller.current = c;
      if (process.env.NODE_ENV !== "production") (window as unknown as { slTour?: unknown }).slTour = c;
      if (!c) return;
      // Our own room names (the scan itself often labels everything "Other").
      fetch(`/api/tour-places/${card.suite.matterport_model_id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && controller.current === c && c.setPlaces(data))
        .catch(() => {});
      c.onChange = () => {
        refreshRoom();
        // Run a command that was asked for while the scan was still loading.
        if (pending.current && c.ready) {
          const cmd = pending.current;
          pending.current = null;
          runTour(cmd);
        }
      };
    },
    [card.suite.matterport_model_id, refreshRoom, runTour],
  );

  const onTourStatus = useCallback(
    (s: TourStatus) => {
      tourStatusRef.current = s;
      setTourStatus(s);
      if (s !== "ready" && pending.current) {
        pending.current = null;
        say(s === "basic"
          ? "Here's the tour. Moving it by voice needs the Matterport SDK key, so drag inside it to look around."
          : "I couldn't connect to the tour controls. You can still drag inside the tour to look around.");
      }
    },
    [say],
  );

  // ---------- Commands ----------
  const handle = useCallback(
    async (text: string) => {
      if (busy.current) return;
      const inTour = tourOpenRef.current;
      const cmd = parseCommand(text, { inTour });
      const addressed = fresh.current; // first sentence right after "Hey SecondLife"
      fresh.current = false;
      if (cmd.kind === "none") return;
      // Not addressed directly (tour or ongoing conversation): ignore chatter that isn't a command or a clear question.
      if (cmd.kind === "ask" && !addressed && (inTour || convo.current) &&
          (!QUESTION.test(text.trim().toLowerCase()) || text.trim().split(/\s+/).length < 3)) {
        return;
      }
      if (convo.current) awakeUntil.current = Date.now() + CONVO_MS;
      setHeard(text);
      if (cmd.kind !== "ask") setPhase(!enabled.current ? "off" : convo.current ? "awake" : "idle");

      switch (cmd.kind) {
        case "ui.sleep":
          convo.current = false;
          awakeUntil.current = 0;
          setAnswer(null);
          setHelp(false);
          setPhase(enabled.current ? "idle" : "off");
          say("Okay. Say Hey SecondLife when you need me.");
          return;
        case "ui.stop":
          window.speechSynthesis?.cancel();
          setReply("");
          return;
        case "ui.help":
          setAnswer(null);
          setHelp(true);
          say("Here's what you can say.");
          return;
        case "ui.close":
          setAnswer(null);
          setHelp(false);
          setReply("");
          setHeard("");
          return;
        case "tour.exit":
          closeTour();
          say("Back to the suite.", false);
          return;
        case "tour.start":
          openTour();
          return;
        case "tour.next":
        case "tour.prev":
        case "tour.goto":
        case "tour.turn":
        case "tour.look":
        case "tour.spin":
        case "tour.dollhouse":
        case "tour.floorplan":
        case "tour.inside":
        case "tour.where":
          if (!tourOpenRef.current) openTour(cmd);
          else runTour(cmd);
          return;
        case "nav.search":
          closeTour();
          setAnswer(null);
          onNav(cmd);
          say("Searching. Your agent team is reading the listings.");
          return;
        case "nav.open": {
          closeTour();
          setAnswer(null);
          const msg = onNav(cmd);
          say(typeof msg === "string" ? msg : mode === "tenant" ? `Opening Suite ${card.suite.suite}.` : "Opening your best prospects.");
          return;
        }
        case "nav.offer":
          closeTour();
          setAnswer(null);
          onNav(cmd);
          say("Here's a draft offer for your broker to review.");
          return;
        case "nav.back":
          closeTour();
          onNav(cmd);
          setReply("Going back");
          return;
        case "nav.home":
          closeTour();
          setAnswer(null);
          onNav(cmd);
          setReply("Home");
          return;
        case "nav.mode":
          closeTour();
          setAnswer(null);
          onNav(cmd);
          say(cmd.mode === "landlord" ? "Landlord mode. Tell me about your space." : "Tenant mode. What kind of space do you need?");
          return;
        case "ask": {
          busy.current = true;
          setHelp(false);
          setAnswer(null);
          setReply("");
          setPhase("thinking");
          const a = await fetchAnswer(card, cmd.question);
          busy.current = false;
          setAnswer(a);
          if (!tourOpenRef.current) onNav({ kind: "nav.scroll", topic: a.topic });
          speak(a.text);
          return;
        }
      }
    },
    [card, closeTour, mode, onNav, openTour, runTour, say, speak],
  );

  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  // Commands typed into the "Ask this space" box.
  useEffect(() => {
    const onTyped = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!text) return;
      fresh.current = true;
      handleRef.current(text);
    };
    window.addEventListener("sl-command", onTyped);
    return () => window.removeEventListener("sl-command", onTyped);
  }, []);

  // Development only: test commands without a microphone, e.g. window.slSay("hey secondlife next room").
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { slSay?: (t: string) => void }).slSay = heardFinal;
  }, [heardFinal]);

  // Watchdog: if Chrome silently stopped listening, start it again.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (enabled.current && !paused.current && !micLive.current) startRec();
    }, 3000);
    return () => window.clearInterval(t);
  }, [startRec]);

  useEffect(() => {
    if (!missed) return;
    const t = window.setTimeout(() => setMissed(""), 4500);
    return () => window.clearTimeout(t);
  }, [missed]);

  // End the conversation after a quiet stretch (the wake phrase is needed again).
  useEffect(() => {
    if (phase !== "awake") return;
    const t = window.setInterval(() => {
      if (Date.now() >= awakeUntil.current) {
        convo.current = false;
        fresh.current = false;
        setPhase(enabled.current ? "idle" : "off");
        setHeard("");
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  if (!supported) return null;

  const status =
    phase === "off"
      ? micError || "Tap to talk hands-free"
      : phase === "awake"
        ? "I’m listening, just talk · say “that’s all” when you’re done"
        : phase === "thinking"
          ? "Checking the history, the scan and the deals…"
          : phase === "speaking"
            ? "Speaking"
            : tourOpen
              ? "Tour mode · just say “next room”, “turn around”, “360”"
              : "Say “Hey SecondLife…”";

  return (
    <>
      {tourOpen && (
        <TourOverlay
          modelId={card.suite.matterport_model_id}
          title={`Suite ${card.suite.suite}`}
          onController={onController}
          onStatus={onTourStatus}
          roomName={roomName || "Loading the scan…"}
          status={tourStatus}
          close={closeTour}
        />
      )}

      <div className={`voice-dock ${tourOpen ? "in-tour" : ""}`}>
        {help && (
          <div className="voice-panel voice-help">
            <button className="voice-x" onClick={() => setHelp(false)} aria-label="Close">
              ×
            </button>
            <p className="voice-panel-title">Say “Hey SecondLife” and then…</p>
            <div className="voice-help-grid">
              {HELP_GROUPS.map((g) => (
                <div key={g.title}>
                  <b>{g.title}</b>
                  {g.items.map((i) => (
                    <span key={i}>“{i}”</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {answer && !help && (
          <div className="voice-panel">
            <button className="voice-x" onClick={() => setAnswer(null)} aria-label="Close">
              ×
            </button>
            <p className="ask-q">“{answer.question}”</p>
            <p className="ask-text">{answer.text}</p>
            <p className="ask-src">{answer.live ? "Live answer from CoStar data" : "Answer from this suite’s card"}</p>
            {!tourOpen && <TopicCard card={card} topic={answer.topic} />}
          </div>
        )}

        {missed && phase === "idle" && !answer && !help && (
          <div className="voice-subtitles voice-missed" aria-live="polite">
            <p className="voice-you">“{missed}”</p>
            <p className="voice-reply">Start with “Hey SecondLife” so I know you’re talking to me.</p>
          </div>
        )}

        {(heard || reply) && !answer && !help && !(missed && phase === "idle") && (
          <div className="voice-subtitles" aria-live="polite">
            {heard && <p className="voice-you">“{heard}”</p>}
            {reply && <p className="voice-reply">{reply}</p>}
          </div>
        )}

        <div className="voice-bar">
          <button
            className={`voice-orb ${phase}`}
            onClick={() => (phase === "off" ? enable() : phase === "speaking" ? window.speechSynthesis.cancel() : disable())}
            aria-label={phase === "off" ? "Turn on hands-free voice" : "Turn off hands-free voice"}
            title={phase === "off" ? "Turn on voice" : "Turn off voice"}
          >
            <span className="voice-core" />
            <span className="voice-ring r1" />
            <span className="voice-ring r2" />
          </button>
          <div className="voice-status">
            <span>{status}</span>
            {phase !== "off" && (
              <button className="voice-help-link" onClick={() => setHelp(!help)}>
                What can I say?
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
