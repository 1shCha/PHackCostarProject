import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, parseCommand, splitWake, roomFromText } from "./commands";

const out = { inTour: false };
const tour = { inTour: true };
const kind = (s: string, ctx = out) => parseCommand(s, ctx).kind;

test("wake phrase variants", () => {
  for (const s of ["Hey SecondLife, what was here before?", "hey second life what was here before", "OK Second Life what was here before", "a second life what was here before", "Hey 2nd life what was here before"]) {
    const w = splitWake(s);
    assert.equal(w.woke, true, s);
    assert.equal(normalize(w.rest), "what was here before", s);
  }
  assert.equal(splitWake("what was here before").woke, false);
  for (const v of ["hey second live open it", "hey seconds life open it", "hey second wife open it", "hey second like open it"]) assert.equal(splitWake(v).woke, true, v);
  assert.equal(splitWake("Hey SecondLife").rest, "");
  assert.equal(splitWake("Hey SecondLife, I'm a dentist looking for 6,000 sq ft").rest, "I'm a dentist looking for 6,000 sq ft");
});

test("navigation", () => {
  assert.deepEqual(parseCommand("I'm a dermatologist looking for about 6,000 sq ft in Houston", out).kind, "nav.search");
  assert.equal(kind("find me a medical office in Houston"), "nav.search");
  assert.equal(kind("open the best match"), "nav.open");
  assert.equal(kind("show me the top one"), "nav.open");
  assert.equal(kind("take me to suite 900"), "nav.open");
  for (const t of ["show suite 900", "show me suite nine hundred", "show me sweet 900", "open suite 900", "let me see suite 900", "show me that space", "open the listing", "show me 6655 Travis", "pull up suite 900"]) assert.equal(kind(t), "nav.open", t);
  assert.equal(kind("go back"), "nav.back");
  assert.equal(kind("back to the results"), "nav.back");
  assert.equal(kind("go home"), "nav.home");
  assert.equal(kind("start over"), "nav.home");
  assert.deepEqual(parseCommand("switch to landlord", out), { kind: "nav.mode", mode: "landlord" });
  assert.deepEqual(parseCommand("I have a space to lease", out), { kind: "nav.mode", mode: "landlord" });
  assert.deepEqual(parseCommand("switch to tenant mode", out), { kind: "nav.mode", mode: "tenant" });
  assert.equal(kind("draft an offer"), "nav.offer");
  assert.deepEqual(parseCommand("open the best match", out), { kind: "nav.open", rank: 1 });
  assert.deepEqual(parseCommand("open the second match", out), { kind: "nav.open", rank: 2 });
  assert.deepEqual(parseCommand("show me the third one", out), { kind: "nav.open", rank: 3 });
  assert.deepEqual(parseCommand("open number two", out), { kind: "nav.open", rank: 2 });
  assert.deepEqual(parseCommand("open suite 800", out), { kind: "nav.open", suite: "800" });
  assert.deepEqual(parseCommand("show me suite 3A", out), { kind: "nav.open", suite: "3a" });
  assert.deepEqual(parseCommand("show me that space", out), { kind: "nav.open" });
  assert.equal(kind("write my letter of intent"), "nav.offer");
});

test("questions stay questions", () => {
  for (const s of ["What was here before?", "Would this work for a dermatologist?", "What's a fair rent?", "Who should lease this next?", "who's next for this space", "How long has it been empty?", "Who are the neighbors?", "What should I offer?"]) {
    assert.equal(kind(s), "ask", s);
  }
  // "next" inside a tenant question must never move the tour
  assert.equal(kind("who should lease this next", tour), "ask");
});

test("tour start and exit", () => {
  for (const s of ["show me inside", "take me inside", "start the tour", "walk me through it", "give me a tour", "open the 3D tour", "let me see inside"]) assert.equal(kind(s), "tour.start", s);
  assert.deepEqual(parseCommand("show me inside the procedure room", out), { kind: "tour.goto", room: "procedure" });
  for (const t of ["take me on a tour", "give me a tour of suite 900", "show me the inside", "show me suite 900 in 3D", "I want to see the 3D tour", "can you show me the space in 3d", "let's do the virtual tour", "walk me through the space", "show me the interior", "can I see inside", "take me through the suite", "show me around", "tour", "take me inside suite 900", "let's go inside", "show me the three d view"]) assert.equal(kind(t), "tour.start", t);
  assert.equal(kind("what was inside before"), "ask");
  assert.equal(kind("give me a 360 view of Suite 900"), "tour.spin");
  assert.equal(kind("show me the dollhouse of suite 900"), "tour.dollhouse");
  assert.equal(kind("show me the floor plan of suite 900"), "tour.floorplan");
  assert.equal(kind("what used to be in this space"), "ask");
  for (const s of ["exit tour", "exit the tour", "close the 3d", "leave the tour", "get me out", "end the walkthrough"]) assert.equal(kind(s, tour), "tour.exit", s);
});

test("moving in the tour", () => {
  assert.equal(kind("next room", tour), "tour.next");
  assert.equal(kind("next room"), "tour.next");
  assert.equal(kind("next", tour), "tour.next");
  assert.equal(kind("keep going", tour), "tour.next");
  assert.equal(kind("next"), "ask"); // bare "next" outside the tour does nothing risky
  assert.equal(kind("previous room", tour), "tour.prev");
  assert.equal(kind("go back", tour), "tour.prev");
  assert.deepEqual(parseCommand("take me to the procedure room", tour), { kind: "tour.goto", room: "procedure" });
  assert.deepEqual(parseCommand("go to the operating room", tour), { kind: "tour.goto", room: "procedure" });
  assert.deepEqual(parseCommand("show me the waiting room", tour), { kind: "tour.goto", room: "waiting" });
  assert.deepEqual(parseCommand("bathroom", tour), { kind: "tour.goto", room: "bathroom" });
  assert.deepEqual(parseCommand("take me to the office", out), { kind: "tour.goto", room: "office" });
  assert.deepEqual(parseCommand("where's the kitchen", tour), { kind: "tour.goto", room: "kitchen" });
});

test("camera", () => {
  assert.deepEqual(parseCommand("turn around", tour), { kind: "tour.turn", degrees: 180 });
  assert.deepEqual(parseCommand("what's behind me", tour), { kind: "tour.turn", degrees: 180 });
  assert.deepEqual(parseCommand("turn left", tour), { kind: "tour.turn", degrees: -90 });
  assert.deepEqual(parseCommand("look right", tour), { kind: "tour.turn", degrees: 90 });
  assert.deepEqual(parseCommand("turn left a little", tour), { kind: "tour.turn", degrees: -45 });
  assert.deepEqual(parseCommand("turn right 30 degrees", tour), { kind: "tour.turn", degrees: 30 });
  assert.deepEqual(parseCommand("left", tour), { kind: "tour.turn", degrees: -90 });
  assert.deepEqual(parseCommand("look up", tour), { kind: "tour.look", degrees: 30 });
  assert.deepEqual(parseCommand("look down", tour), { kind: "tour.look", degrees: -30 });
  for (const s of ["give me a 360", "give me a three sixty", "do a 360 view", "look around", "spin"]) assert.equal(kind(s, tour), "tour.spin", s);
  for (const s of ["dollhouse view", "doll house", "show me the whole floor", "zoom out"]) assert.equal(kind(s, tour), "tour.dollhouse", s);
  for (const s of ["floor plan", "floorplan view", "top down view"]) assert.equal(kind(s, tour), "tour.floorplan", s);
  assert.equal(kind("back inside", tour), "tour.inside");
  for (const s of ["what's in this room", "where am I", "what room is this", "what am I looking at"]) assert.equal(kind(s, tour), "tour.where", s);
});

test("ui", () => {
  assert.equal(kind("stop"), "ui.stop");
  assert.equal(kind("what can I say"), "ui.help");
  assert.equal(kind("help"), "ui.help");
  assert.equal(kind("close"), "ui.close");
  assert.equal(kind("thanks"), "ui.close");
  assert.equal(kind("help me find a space in Houston"), "nav.search");
  for (const t of ["that's all", "thats all", "that's it", "goodbye", "bye", "stop listening", "go to sleep", "I'm done", "thanks that's all", "okay that's all for now"]) assert.equal(kind(t), "ui.sleep", t);
  assert.equal(kind("thanks"), "ui.close");
});

test("rooms", () => {
  assert.equal(roomFromText("the waiting room"), "waiting");
  assert.equal(roomFromText("exam rooms"), "exam");
  assert.equal(roomFromText("nothing here"), null);
});
