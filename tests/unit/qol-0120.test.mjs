import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID as M } from "../../scripts/constants.mjs";
import { readStarship, patchStarship, writeStarship } from "../../scripts/starship/starship-state.mjs";
import { historyEntries, reversible, snapshot, historySummary } from "../../scripts/history/history.mjs";
import { makeEffect, pruneExpired, effectModifiers } from "../../scripts/starship/effects.mjs";
import { sanitizeTiming, timingExpired, advanceEffects } from "../../scripts/starship/effect-timing.mjs";
import { uiStateKey, restoreUiState, saveUiState, filterRows } from "../../scripts/ui/client-ui.mjs";
import { registerSettings } from "../../scripts/settings.mjs";
import { Draft } from "../../scripts/actions/draft.mjs";
import { applyDamageInDraft } from "../../scripts/damage/damage-service.mjs";

function setup() {
  const env = installFoundryMock({ lang: "ru" });
  const actor = makeShip({ id: "qol", name: "Корабль", hp: 100, sp: 20 });
  return { ...env, actor };
}
function timingCombat(round = 2, turn = 0) {
  const turns = [
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ];
  return { id: "combat", round, turn, turns, combatant: turns[turn] };
}

test("0.12 evade records actual actions, including the +2 bonus", () => {
  setup();
  const e = makeEffect(
    { slug: "evade", duration: { unit: "round", value: 1 }, modifiers: [{ selector: "ac", type: "circumstance", value: "actions" }] },
    { combat: timingCombat(), actions: 2 }
  );
  assert.equal(e.actionsSpent, 2);
  assert.equal(e.modifiers[0].value, 2);
  assert.equal(e.timing.combatantId, "a");
  assert.equal(pruneExpired([e], timingCombat(3, 0)).removed.length, 1);
});
test("0.12 end of last turn expires on round rollover, not numeric turn+1", () => {
  setup();
  const e = makeEffect({ slug: "x", duration: { unit: "until-turn-end" } }, { combat: timingCombat(2, 1) });
  assert.equal(pruneExpired([e], timingCombat(2, 1)).removed.length, 0);
  assert.equal(pruneExpired([e], timingCombat(3, 0), { id: "b", round: 2, turn: 1 }).removed.length, 1);
  assert.equal(pruneExpired([e], timingCombat(3, 0)).removed.length, 1);
});
test("0.12 stable anchor survives initiative insertion and does not expire on backward navigation", () => {
  const t = { combatId: "combat", combatantId: "b", mode: "turn-end", round: 2 };
  assert.equal(timingExpired(t, timingCombat(2, 0), { id: "b", round: 2, turn: 1 }), false);
  const c = timingCombat(2, 1);
  c.turn = 2;
  assert.equal(timingExpired(t, c, { id: "b", round: 2, turn: 1 }), false);
  assert.equal(timingExpired(t, { ...c, id: "other" }, { id: "b", round: 2, turn: 1 }), false);
});
test("0.12 durations validate anchors, clamp rounds, and require explicit condition text", () => {
  const c = timingCombat();
  assert.equal(sanitizeTiming({ mode: "rounds", combatantId: "a", rounds: 3 }, c).round, 5);
  assert.equal(sanitizeTiming({ mode: "rounds", combatantId: "a", rounds: 0 }, c).round, 3);
  assert.throws(() => sanitizeTiming({ mode: "turn-end", combatantId: "missing" }, c));
  assert.throws(() => sanitizeTiming({ mode: "condition", condition: " " }, c));
  assert.equal(timingExpired(sanitizeTiming({ mode: "condition", condition: "до ремонта" }, c), timingCombat(99)), false);
});
test("0.12 sustain reminders once per new round, no automatic cost, expiry or extension", () => {
  const e = { id: "e", timing: sanitizeTiming({ mode: "condition", condition: "пока работает", sustain: true }, timingCombat()) };
  assert.equal(advanceEffects([e], timingCombat(2), null).reminders.length, 0);
  const step = advanceEffects([e], timingCombat(3), null);
  assert.equal(step.reminders.length, 1);
  assert.equal(step.keep.length, 1);
  assert.equal(e.timing.lastReminderRound, 2);
  assert.equal(advanceEffects(step.keep, timingCombat(3, 1), null).reminders.length, 0);
});
test("history is GM-only and shows exact shields/hull deltas plus reason", async () => {
  const { actor } = setup();
  await patchStarship(
    actor,
    (d) => {
      d.sp.value = 8;
    },
    { reason: "попадание лазера" }
  );
  const [m] = historyEntries(actor.uuid),
    r = m.flags[M].history;
  assert.equal(game.journal.get(game.settings.get(M, "historyStoreId")).ownership.default, 0);
  assert.equal(game.messages.size, 0);
  assert.equal(r.reason, "попадание лазера");
  assert.match(historySummary(r.before, r.after), /Щиты: 20 → 8. Корпус: без изменений/);
  assert.equal(r.undoable, false);
  assert.equal(actor.flags[M].history, undefined);
});
test("0.12 critical damage/configuration changes are audit-only", async () => {
  const { actor } = setup();
  const before = snapshot(readStarship(actor));
  assert.equal(reversible(before, { ...before, compromised: 1 }), false);
  await patchStarship(actor, (d) => {
    d.ac++;
  });
  assert.equal(historyEntries()[0].flags[M].history.undoable, false);
});
test("0.12 players cannot read GM history", async () => {
  const { actor, setUser } = setup();
  await patchStarship(actor, (d) => {
    d.sp.value = 8;
  });
  const player = game.users.find((u) => !u.isGM);
  setUser(player.id);
  assert.deepEqual(historyEntries(), []);
});
test("0.12 stale expected snapshots rejected inside serialized actor write", async () => {
  const { actor } = setup();
  const before = snapshot(readStarship(actor));
  await patchStarship(actor, (d) => {
    d.sp.value = 8;
  });
  await assert.rejects(writeStarship(actor, before, { expected: before, history: false }));
});
test("damage drafts and normal action drafts cannot be reversed", async () => {
  const { actor } = setup();
  const draft = new Draft(null);
  draft.allowUndo = true;
  await applyDamageInDraft(draft, actor.uuid, { amount: 12, source: "лазер", silent: true });
  await draft.commit();
  const [m] = historyEntries();
  assert.equal(m.flags[M].history.undoable, false);
  assert.equal(readStarship(actor).sp.value, 8);
  const action = new Draft(null);
  (await action.ship(actor.uuid)).data.sp.value = 7;
  await action.commit();
  assert.equal(historyEntries()[0].flags[M].history.undoable, false);
});
test("0.12 no-op writes make no audit records", async () => {
  const { actor } = setup();
  await patchStarship(actor, () => {});
  assert.equal(historyEntries().length, 0);
});
test("0.12 per-client window/tab memory supports string tabs and serial multi-window saves", async () => {
  const { settings } = setup();
  const app = {
    constructor: { name: "Sheet" },
    document: { uuid: "Actor.a" },
    tab: "stations",
    tabs: ["overview", "stations"],
    position: { width: 900, height: 720 }
  };
  const other = { ...app, document: { uuid: "Actor.b" }, tab: "overview" };
  await Promise.all([saveUiState(app), saveUiState(other)]);
  assert.equal(Object.keys(settings.get("uiState")).length, 2);
  const reopened = { ...app, tab: "overview" };
  restoreUiState(reopened);
  assert.equal(reopened.tab, "stations");
  assert.equal(reopened._qolPosition.width, 900);
  assert.notEqual(uiStateKey(app), uiStateKey(other));
});
test("0.13 compact preference is retired; window memory remains client-scoped", () => {
  setup();
  const registrations = new Map();
  game.settings.register = (m, k, v) => registrations.set(k, v);
  registerSettings();
  assert.equal(registrations.has("compactMode"), false);
});
test("0.13 history search and undo filter compose; reset restores all rows", () => {
  const rows = [
    { textContent: "Лазер: щиты", dataset: { filterUndo: "true" } },
    { textContent: "Ремонт корпуса", dataset: { filterUndo: "false" } }
  ];
  filterRows(rows, "ЛАЗЕР", "undo");
  assert.deepEqual(
    rows.map((r) => r.hidden),
    [false, true]
  );
  filterRows(rows, "", "undo");
  assert.deepEqual(
    rows.map((r) => r.hidden),
    [false, true]
  );
  filterRows(rows);
  assert.deepEqual(
    rows.map((r) => r.hidden),
    [false, false]
  );
});

test("legacy trusted GM whisper remains readable as audit", async () => {
  const { actor } = setup();
  const before = snapshot(readStarship(actor));
  await patchStarship(
    actor,
    (d) => {
      d.heading = "left";
    },
    { history: false }
  );
  const after = snapshot(readStarship(actor));
  const old = await ChatMessage.create({
    whisper: [game.user.id],
    flags: {
      [M]: { history: { schema: 1, shipUuid: actor.uuid, before, after, undoable: true, undone: false, guard: null, at: Date.now() } }
    }
  });
  assert.equal(historyEntries()[0].id, old.id);
});
test("legacy HP/SP history remains readable but cannot undo possible damage", async () => {
  const { actor } = setup();
  const before = snapshot(readStarship(actor));
  await patchStarship(
    actor,
    (d) => {
      d.sp.value = 8;
    },
    { history: false }
  );
  const after = snapshot(readStarship(actor));
  const old = await ChatMessage.create({
    whisper: [game.user.id],
    flags: {
      [M]: { history: { schema: 1, shipUuid: actor.uuid, before, after, undoable: true, undone: false, guard: null, at: Date.now() } }
    }
  });
  const writes = globalThis.__writes.length;
  const messages = game.messages.size;
  assert.equal(historyEntries()[0].id, old.id);
  assert.equal(readStarship(actor).sp.value, 8);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(game.messages.size, messages);
});
test("0.12 forged player history flags are neither displayed nor executable", async () => {
  const { actor, setUser } = setup();
  const data = snapshot(readStarship(actor));
  const gm = game.user.id,
    player = game.users.find((u) => !u.isGM);
  setUser(player.id);
  await ChatMessage.create({
    whisper: [gm],
    flags: { [M]: { history: { schema: 1, shipUuid: actor.uuid, before: data, after: data, undoable: true, guard: null } } }
  });
  setUser(gm);
  assert.deepEqual(historyEntries(), []);
});
test("0.12 audit retention is bounded to 80 GM records", async () => {
  const { actor } = setup();
  const create = ChatMessage.create;
  ChatMessage.create = async function (data) {
    const m = await create.call(this, data);
    m.delete = async () => game.messages.delete(m.id);
    return m;
  };
  try {
    for (let i = 0; i < 83; i++)
      await patchStarship(actor, (d) => {
        d.sp.value = i % 2 ? 8 : 9;
      });
  } finally {
    ChatMessage.create = create;
  }
  assert.equal(game.journal.get(game.settings.get(M, "historyStoreId")).flags[M].historyStore.records.length, 80);
  assert.equal(historyEntries().length, 80);
});
test("0.12 effect lifecycle handler denies players and records sustaining without spending actions", async () => {
  const { actor } = setup();
  const combat = makeStarshipCombat();
  await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id, initiative: 20 }]);
  await patchStarship(actor, (d) => {
    d.effects = [{ id: "e", label: "Эффект", modifiers: [], conditions: [] }];
  });
  const { registerEffectHandlers } = await import("../../scripts/starship/effect-service.mjs");
  const { dispatchSocketMessage, request } = await import("../../scripts/socket.mjs");
  registerEffectHandlers();
  const emitted = [];
  const player = game.users.find((u) => !u.isGM);
  await dispatchSocketMessage(
    { kind: "request", type: "effectTiming", requestId: "deny", payload: { shipUuid: actor.uuid, effectId: "e", op: "complete" } },
    player.id,
    { users: game.users, selfId: game.user.id, isActiveGM: true, emit: (m) => emitted.push(m) }
  );
  assert.equal(emitted[0].ok, false);
  assert.equal(readStarship(actor).effects.length, 1);
  await request("effectTiming", {
    shipUuid: actor.uuid,
    effectId: "e",
    op: "set",
    timing: { mode: "condition", condition: "до ремонта", sustain: true }
  });
  await request("effectTiming", { shipUuid: actor.uuid, effectId: "e", op: "sustain" });
  assert.equal(readStarship(actor).effects[0].timing.lastSustainedRound, combat.round);
  assert.deepEqual(combat.flags[M].tsc.budget, {});
  await request("effectTiming", { shipUuid: actor.uuid, effectId: "e", op: "complete" });
  assert.equal(readStarship(actor).effects.length, 0);
});
test("0.12 turn hook removes stable end-of-turn effects and issues only one sustain reminder", async () => {
  const { actor } = setup();
  const combat = makeStarshipCombat({ objects: [{ key: actor.uuid, zone: 1 }] });
  const other = makeShip({ id: "next", name: "Следующий" });
  await combat.createEmbeddedDocuments("Combatant", [
    { actorId: actor.id, initiative: 20 },
    { actorId: other.id, initiative: 10 }
  ]);
  combat.turn = 1;
  const end = makeEffect({ slug: "x", duration: { unit: "until-turn-end" } }, { combat });
  const sustain = {
    id: "s",
    label: "Поддержание",
    modifiers: [],
    conditions: [],
    timing: sanitizeTiming({ mode: "condition", condition: "до ремонта", sustain: true }, combat)
  };
  await patchStarship(actor, (d) => {
    d.effects = [end, sustain];
  });
  const { registerCombatHooks } = await import("../../scripts/combat/starship-combat.mjs");
  registerCombatHooks();
  await combat.update({ round: 2, turn: 0 });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(
    readStarship(actor).effects.map((e) => e.id),
    ["s"]
  );
  const reminders = () => game.messages.filter((m) => m.content.includes("Напоминание:"));
  assert.equal(reminders().length, 1);
  await combat.update({ turn: 0 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(reminders().length, 1);
});

test("unchanged starship write skips actor update and history", async () => {
  const { actor } = setup();
  let calls = 0;
  const update = actor.update.bind(actor);
  actor.update = async (...args) => {
    calls++;
    return update(...args);
  };
  await patchStarship(actor, () => {});
  assert.equal(calls, 0);
  assert.equal(historyEntries(actor.uuid).length, 0);
  await patchStarship(actor, (data) => {
    data.sp.value = 8;
  });
  assert.equal(calls, 1);
  assert.equal(historyEntries(actor.uuid).length, 1);
  await patchStarship(actor, (data) => {
    data.sp.value = 8;
  });
  assert.equal(calls, 1);
  assert.equal(historyEntries(actor.uuid).length, 1);
});

test("chat modes do not announce no-ops, and journal stays private", async () => {
  for (const mode of ["log", "important", "all"]) {
    const { actor, settings } = setup();
    settings.set("chatAnnouncements", mode);
    await patchStarship(actor, (d) => {
      d.sp.value = 7;
    });
    assert.equal(game.messages.size, mode === "all" ? 1 : 0, mode);
    assert.equal(historyEntries().length, 1);
    await patchStarship(actor, (d) => {
      d.sp.value = 7;
    });
    assert.equal(game.messages.size, mode === "all" ? 1 : 0, mode);
    assert.equal(historyEntries().length, 1);
    await patchStarship(actor, (d) => {
      d.inoperable = true;
    });
    assert.equal(game.messages.size, mode === "log" ? 0 : mode === "important" ? 1 : 2, mode);
    const journal = game.journal.get(settings.get("historyStoreId"));
    assert.deepEqual(journal.ownership, { default: 0 });
  }
});

test("shared history store fails closed and never reads its records", async () => {
  const { actor, settings } = setup();
  await patchStarship(actor, (d) => {
    d.sp.value = 9;
  });
  const store = game.journal.get(settings.get("historyStoreId"));
  store.ownership.p1 = 2;
  assert.equal(historyEntries().length, 0);
});

test("effects without modifiers do not crash modifier aggregation", () => {
  assert.deepEqual(effectModifiers([{ id: "e", slug: "e" }], "ac"), []);
  assert.deepEqual(effectModifiers([{ id: "e", slug: "e", modifiers: [{ selector: "ac", value: 1 }] }], "ac"), [
    { selector: "ac", value: 1, slug: "e" }
  ]);
});
