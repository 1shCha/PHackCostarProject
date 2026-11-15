// Speaks a line out loud with a natural Gemini voice (via /api/tts), falling back to the best voice
// built into the browser when the server is slow, out of quota or offline. One line plays at a time.

let current: { stop: () => void } | null = null;

/** Stops whatever is speaking (AI voice or browser voice). Safe to call any time. */
export function stopSpeaking() {
  current?.stop();
  current = null;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

// Natural-sounding system voices first; the plain default is the robotic one.
const PREFERRED = [/natural/i, /neural/i, /premium/i, /enhanced/i, /online/i, /google us english/i,
  /\b(ava|samantha|allison|aria|jenny|zoe|evan|nathan)\b/i];

function bestBrowserVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const english = voices.filter((v) => /^en[-_]US/i.test(v.lang)).length ? voices.filter((v) => /^en[-_]US/i.test(v.lang)) : voices.filter((v) => /^en/i.test(v.lang));
  for (const pattern of PREFERRED) {
    const v = english.find((x) => pattern.test(x.name));
    if (v) return v;
  }
  return english.find((v) => v.localService) ?? english[0];
}

function browserSpeak(text: string, finish: () => void) {
  if (!window.speechSynthesis) return finish();
  const u = new SpeechSynthesisUtterance(text);
  const voice = bestBrowserVoice();
  if (voice) u.voice = voice;
  u.rate = 1.0;
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.speak(u);
}

/** Speaks `text`; calls `onDone` exactly once when it finishes, fails or is stopped. */
export function speakAloud(text: string, onDone: () => void) {
  stopSpeaking();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (current === me) current = null;
    onDone();
  };
  const abort = new AbortController();
  const audio = new Audio();
  let url = "";
  const me = {
    stop: () => {
      abort.abort();
      audio.pause();
      window.speechSynthesis?.cancel();
      finish();
    },
  };
  current = me;

  const timeout = window.setTimeout(() => abort.abort(), 8_000); // too slow: use the browser voice instead
  fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: abort.signal,
  })
    .then(async (res) => {
      window.clearTimeout(timeout);
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      url = URL.createObjectURL(await res.blob());
      if (finished) return;
      audio.src = url;
      audio.onended = () => { URL.revokeObjectURL(url); finish(); };
      audio.onerror = () => { URL.revokeObjectURL(url); finish(); };
      await audio.play();
    })
    .catch(() => {
      window.clearTimeout(timeout);
      if (url) URL.revokeObjectURL(url);
      if (!finished) browserSpeak(text, finish); // stopped on purpose → finished is already true
    });
}
