import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk, makeShip, makeCharacter, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { normalizeCrewAssignments, assignStation, releaseStationIn, partitionCrew } from "../../scripts/engine/crew-assignments.mjs";
import { planCrewCombatants, findCombatantFor } from "../../scripts/engine/crew-initiative.mjs";
import { occupantView, portraitOf, affectsOccupantDisplay, EMPTY_STATION_IMG, MISSING_CREW_IMG } from "../../scripts/crew/occupant.mjs";

const M = "sf2e-tactical-starship-combat";

/* ------------------------------------------------------------------ socket security */
async function socketEnv() {
  installFoundryMock();
  const socket = await import("../../scripts/socket.mjs");
  const emitted = [];
  const env = (selfId = "gm", isActiveGM = true, clientEvents = new Map()) => ({
    users: game.users,
    selfId,
    isActiveGM,
    clientEvents,
    emit: (m) => emitted.push(m)
  });
  return { socket, emitted, env };
}

test("socket: the handler sees the real sender, never the userId claimed in the message body", async () => {
  const { socket, emitted, env } = await socketEnv();
  let seen = null;
  socket.registerHandler("t.whoami", ({ user, userId, remote }) => {
    seen = { id: user.id, userId, isGM: user.isGM, remote };
    return "ok";
  });
  await socket.dispatchSocketMessage({ kind: "request", type: "t.whoami", requestId: "r1", userId: "gm", payload: {} }, "p1", env());
  assert.deepEqual(seen, { id: "p1", userId: "p1", isGM: false, remote: true }, "spoofed GM claim ignored");
  assert.equal(emitted.at(-1).to, "p1", "response goes to the real sender");
  assert.equal(emitted.at(-1).ok, true);
});

test("socket: requests without an authenticated sender are dropped; only the active GM executes", async () => {
  const { socket, emitted, env } = await socketEnv();
  let calls = 0;
  socket.registerHandler("t.count", () => ++calls);
  await socket.dispatchSocketMessage({ kind: "request", type: "t.count", requestId: "r2", userId: "gm" }, undefined, env());
  await socket.dispatchSocketMessage({ kind: "request", type: "t.count", requestId: "r3", userId: "p1" }, "nobody", env());
  assert.equal(calls, 0);
  assert.ok(emitted.every((m) => m.ok === false));
  await socket.dispatchSocketMessage({ kind: "request", type: "t.count", requestId: "r4" }, "p1", env("p2", false));
  assert.equal(calls, 0, "a non-GM client never executes requests");
  await socket.dispatchSocketMessage({ kind: "request", type: "t.unknown", requestId: "r5" }, "p1", env());
  assert.match(emitted.at(-1).error, /Unknown request/);
});

test("socket: responses and client events are accepted only from a GM sender", async () => {
  const { socket, env } = await socketEnv();
  let resolved = null,
    rejected = null;
  socket._trackPending(
    "q1",
    (v) => {
      resolved = v;
    },
    (e) => {
      rejected = e;
    }
  );
  await socket.dispatchSocketMessage({ kind: "response", requestId: "q1", to: "p1", ok: true, result: "forged" }, "p2", env("p1", false));
  assert.equal(resolved, null, "forged response from a player ignored");
  await socket.dispatchSocketMessage({ kind: "response", requestId: "q1", to: "p1", ok: true, result: "real" }, "gm", env("p1", false));
  assert.equal(resolved, "real");
  assert.equal(rejected, null);
  const events = new Map();
  let got = [];
  events.set("t.ev", (p) => got.push(p));
  await socket.dispatchSocketMessage({ kind: "event", type: "t.ev", payload: 1 }, "p2", env("p1", false, events));
  await socket.dispatchSocketMessage({ kind: "event", type: "t.ev", payload: 2, to: "p2" }, "gm", env("p1", false, events));
  await socket.dispatchSocketMessage({ kind: "event", type: "t.ev", payload: 3 }, "gm", env("p1", false, events));
  assert.deepEqual(got, [3]);
});

test("action requests: internal options are stripped, gmOverride only for GM senders", async () => {
  installFoundryMock();
  const { sanitizeActionRequest } = await import("../../scripts/actions/action-engine.mjs");
  const p1 = game.users.get("p1"),
    gm = game.users.get("gm");
  const raw = {
    shipUuid: "Actor.a",
    actionId: "strike",
    crewUuid: "Actor.c",
    userId: "gm",
    options: {
      gmOverride: true,
      draft: { x: 1 },
      npcStrike: {},
      pendingStrike: {},
      reaction: true,
      skipReactions: true,
      actions: "2",
      targetKey: "Actor.t",
      weaponId: "w1"
    }
  };
  const pl = sanitizeActionRequest(raw, p1);
  assert.deepEqual(pl.options, { actions: 2, targetKey: "Actor.t", weaponId: "w1" });
  assert.equal("userId" in pl, false);
  assert.equal(sanitizeActionRequest(raw, gm).options.gmOverride, true);
  assert.deepEqual(sanitizeActionRequest(null, p1).options, {});
});

test("crew grants: players join as crew linked to themselves; only GM/assigners grant captain or link others", async () => {
  installFoundryMock();
  const { crewEntryGrant } = await import("../../scripts/crew/crew-service.mjs");
  const p1 = game.users.get("p1"),
    gm = game.users.get("gm");
  assert.deepEqual(crewEntryGrant(p1, { canAssign: false, role: "captain", userId: "p2" }), { role: "crew", userId: "p1" });
  assert.deepEqual(crewEntryGrant(p1, { canAssign: false, role: "observer", userId: null }), { role: "observer", userId: "p1" });
  assert.deepEqual(crewEntryGrant(p1, { canAssign: true, role: "captain", userId: "p2" }), { role: "captain", userId: null });
  assert.deepEqual(crewEntryGrant(gm, { canAssign: true, role: "captain", userId: "p2" }), { role: "captain", userId: "p2" });
  assert.equal(crewEntryGrant(gm, { role: "admiral" }).role, "crew", "unknown roles fall back to crew");
});

test("reaction prompt answers: only the addressed user (or a GM) may resolve it", async () => {
  installFoundryMock();
  const { resolveReactionResponse, _registerWaiting } = await import("../../scripts/actions/reactions.mjs");
  let answer;
  _registerWaiting("rx1", "p1", (v) => {
    answer = v;
  });
  assert.throws(() => resolveReactionResponse({ user: game.users.get("p2"), payload: { requestId: "rx1", use: true } }));
  assert.equal(answer, undefined);
  assert.equal(resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: "rx1", use: true } }), true);
  assert.equal(answer, true);
  assert.equal(resolveReactionResponse({ user: game.users.get("p1"), payload: { requestId: "rx1", use: true } }), false, "single use");
  _registerWaiting("rx2", "p1", (v) => {
    answer = v;
  });
  assert.equal(resolveReactionResponse({ user: game.users.get("gm"), payload: { requestId: "rx2", use: false } }), true);
  assert.equal(answer, null);
});

/* ------------------------------------------------------------------ crew ↔ station consistency */
const crewData = () => ({
  crew: [
    { actorUuid: "Actor.a", stationId: "s2" },
    { actorUuid: "Actor.b", stationId: null },
    { actorUuid: "Actor.a", stationId: null }
  ],
  stations: [
    { id: "s1", helmedBy: "Actor.a" },
    { id: "s2", helmedBy: "Actor.a" },
    { id: "s3", helmedBy: "Actor.gone" },
    { id: "s4", helmedBy: null }
  ]
});

test("crew assignments: duplicates, stale occupants and stationId mirror are repaired", () => {
  const { data, repairs } = normalizeCrewAssignments(crewData());
  assert.equal(data.crew.length, 2);
  assert.deepEqual(
    data.stations.map((s) => s.helmedBy),
    ["Actor.a", null, null, null]
  );
  assert.equal(data.crew[0].stationId, "s1");
  assert.equal(data.crew[1].stationId, null);
  assert.ok(repairs.includes("crew:duplicate:Actor.a") && repairs.includes("station:stale:s3") && repairs.includes("station:duplicate:s2"));
  assert.deepEqual(normalizeCrewAssignments(data).repairs, [], "idempotent");
});

test("crew assignments: moving and releasing keep helmedBy and stationId in sync", () => {
  let d = normalizeCrewAssignments(crewData()).data;
  d = assignStation(d, "Actor.a", "s4");
  assert.deepEqual(
    d.stations.map((s) => s.helmedBy),
    [null, null, null, "Actor.a"]
  );
  assert.equal(d.crew[0].stationId, "s4");
  d = assignStation(d, "Actor.b", "s4"); // b takes a's post → a becomes free crew
  assert.equal(d.stations[3].helmedBy, "Actor.b");
  assert.deepEqual(
    d.crew.map((c) => c.stationId),
    [null, "s4"]
  );
  d = releaseStationIn(d, "s4");
  assert.deepEqual(
    d.crew.map((c) => c.stationId),
    [null, null]
  );
  d = assignStation(d, "Actor.a", "s1");
  const { stationed, free } = partitionCrew(d);
  assert.deepEqual([stationed.map((c) => c.actorUuid), free.map((c) => c.actorUuid)], [["Actor.a"], ["Actor.b"]]);
});

test("starship normalization persists consistent crew/station data", async () => {
  installFoundryMock();
  const { normalizeStarship } = await import("../../scripts/engine/validation.mjs");
  const raw = {
    stations: [
      { id: "g", type: "gunnery", helmedBy: "Actor.x", repairLockedUntilTurnOf: "c1" },
      { id: "p", type: "pilot", helmedBy: "Actor.x" }
    ],
    crew: [{ actorUuid: "Actor.x", name: "X", stationId: "p" }]
  };
  const out = normalizeStarship(raw);
  const data = out.data ?? out;
  assert.deepEqual(
    data.stations.map((s) => s.helmedBy),
    ["Actor.x", null]
  );
  assert.equal(data.crew[0].stationId, "g");
  assert.equal(data.stations[0].repairLockedUntilTurnOf, "c1", "unknown station keys survive normalization");
});

/* ------------------------------------------------------------------ portraits */
test("occupant view: portrait, token fallback, empty and missing placeholders", () => {
  const t = (k) => k;
  const actors = {
    "Actor.a": { name: "Ava", img: "chars/ava.webp" },
    "Actor.b": { name: "Bob", img: "icons/svg/mystery-man.svg", prototypeToken: { texture: { src: "tokens/bob.webp" } } }
  };
  const resolve = (u) => actors[u] ?? null;
  assert.deepEqual(occupantView("Actor.a", { resolve, t }), {
    uuid: "Actor.a",
    empty: false,
    missing: false,
    name: "Ava",
    img: "chars/ava.webp",
    tooltip: "Ava"
  });
  assert.equal(occupantView("Actor.b", { resolve, t }).img, "tokens/bob.webp", "default portrait → token art");
  const empty = occupantView(null, { resolve, t });
  assert.equal(empty.empty, true);
  assert.equal(empty.img, EMPTY_STATION_IMG);
  const missing = occupantView("Actor.gone", { resolve, t, fallbackName: "Old Name" });
  assert.equal(missing.missing, true);
  assert.equal(missing.img, MISSING_CREW_IMG);
  assert.equal(missing.name, "Old Name");
  assert.equal(
    portraitOf({ img: "icons/svg/mystery-man.svg", prototypeToken: { texture: { src: "tokens/*.webp" } } }),
    "icons/svg/mystery-man.svg",
    "wildcard token art is not used"
  );
  assert.ok(
    affectsOccupantDisplay({ img: "x" }) &&
      affectsOccupantDisplay({ name: "x" }) &&
      affectsOccupantDisplay({ prototypeToken: { texture: { src: "y" } } })
  );
  assert.equal(affectsOccupantDisplay({ system: { attributes: {} } }), false);
});

test("portraits are shown on every station view (templates use the shared occupant partial)", async () => {
  const fs = await import("node:fs");
  for (const f of ["templates/starship-sheet.hbs", "templates/station-hud.hbs", "templates/crew-ship.hbs"]) {
    assert.match(fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"), /tscOccupant/, f);
  }
});

/* ------------------------------------------------------------------ crew → initiative */
const actorsById = {
  "Actor.a": { id: "a", uuid: "Actor.a", name: "Ava" },
  "Actor.b": { id: "b", uuid: "Actor.b", name: "Bob" },
  "Actor.c": { id: "c", uuid: "Actor.c", name: "Cid" },
  "Actor.e": { id: "e", uuid: "Actor.e", name: "Eve" }
};
const resolve = (u) => actorsById[u] ?? null;
const ships = [
  {
    uuid: "Actor.s1",
    name: "Aurora",
    crew: [
      { actorUuid: "Actor.a", name: "Ava", stationId: "g" },
      { actorUuid: "Actor.b", name: "Bob", stationId: null },
      { actorUuid: "Actor.o", name: "Obs", role: "observer" },
      { actorUuid: "Actor.gone", name: "Ghost" }
    ]
  },
  {
    uuid: "Actor.s2",
    name: "Borealis",
    crew: [
      { actorUuid: "Actor.a", name: "Ava", stationId: null },
      { actorUuid: "Actor.c", name: "Cid", stationId: "p" }
    ]
  }
];

test("crew → initiative: crew of all selected ships, no duplicates, observers skipped, missing reported", () => {
  const plan = planCrewCombatants({ ships, combatants: [], resolve });
  assert.deepEqual(
    plan.create.map((p) => p.name),
    ["Ava", "Bob", "Cid"]
  );
  assert.deepEqual(
    plan.missing.map((p) => p.name),
    ["Ghost"]
  );
});

test("crew → initiative: existing combatants are kept, exclusions and extras respected, scopes", () => {
  const combatants = [
    { id: "k1", actorId: "b", actorUuid: "Actor.b" },
    { id: "k0", actorId: "a", actorUuid: "Actor.a", special: true }
  ];
  const plan = planCrewCombatants({ ships, combatants, resolve, exclude: ["Actor.c"], extra: ["Actor.e", "Actor.b"] });
  assert.deepEqual(
    plan.create.map((p) => p.name),
    ["Ava", "Eve"],
    "special (compromised) entry never stands in for crew"
  );
  assert.deepEqual(
    plan.existing.map((p) => [p.name, p.combatantId]),
    [["Bob", "k1"]]
  );
  assert.deepEqual(
    plan.excluded.map((p) => p.name),
    ["Cid"]
  );
  assert.deepEqual(
    planCrewCombatants({ ships, combatants: [], resolve, scope: "stationed" }).create.map((p) => p.name),
    ["Ava", "Cid"]
  );
  assert.equal(planCrewCombatants({ ships, combatants: [], resolve, scope: "off" }).create.length, 0);
  assert.equal(
    findCombatantFor([{ id: "x", actorId: "a", actorUuid: "Scene.s.Token.t.Actor.a", tokenIsSynthetic: true }], actorsById["Actor.a"]),
    null,
    "unlinked token copy is not the linked actor"
  );
});

test("crew sync in a running combat: adds missing crew once, keeps the current turn, warns about missing actors", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { syncCrewCombatants } = await import("../../scripts/combat/crew-sync.mjs");
  const { combatantForActor, isActorsTurn } = await import("../../scripts/combat/tsc-state.mjs");
  const ava = makeCharacter({ id: "ava", name: "Ava", owners: ["p1"] });
  const bob = makeCharacter({ id: "bob", name: "Bob", owners: ["p2"] });
  const ship = makeShip({
    id: "aurora",
    name: "Aurora",
    crew: [
      { actorUuid: "Actor.ava", name: "Ava", role: "crew" },
      { actorUuid: "Actor.bob", name: "Bob", role: "crew" },
      { actorUuid: "Actor.gone", name: "Ghost", role: "crew" }
    ]
  });
  const raider = makeShip({ id: "raider", name: "Raider", role: "npc" });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 1 },
      { key: raider.uuid, zone: 5 }
    ]
  });
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: "raider", initiative: 30 },
    { actorId: "ava", initiative: 10 },
    { actorId: "aurora", initiative: 25, flags: { [M]: { compromisedEntry: true } } }
  ]);
  combat.turn = 1; // the compromised entry is acting
  const warnings = [];
  ui.notifications.warn = (m) => warnings.push(m);
  const res = await syncCrewCombatants(combat, [ship.uuid]);
  assert.deepEqual(res.created, ["Bob"]);
  assert.deepEqual(res.existing, ["Ava"]);
  assert.equal(res.missing.length, 1);
  assert.ok(warnings.some((w) => /Ghost/.test(w)));
  assert.equal(combat.combatant.flags[M].compromisedEntry, true, "turn stays on the same combatant");
  const again = await syncCrewCombatants(combat, [ship.uuid], { notify: false });
  assert.deepEqual(again.created, [], "idempotent");
  assert.equal(combat.combatants.filter((c) => c.actorId === "bob").length, 1);
  assert.equal(combatantForActor(combat, ship)?.flags?.[M]?.compromisedEntry, undefined, "compromised entry is not the ship's combatant");
  assert.equal(isActorsTurn(combat, ship), false);
  assert.ok(combatantForActor(combat, bob));
  void ava;
});
