import test from "node:test";
import assert from "node:assert/strict";
import {
  installFoundryMock,
  loadContentFromDisk,
  makeShip,
  makeCharacter,
  makeStarshipCombat,
  dice,
  MockRoll
} from "../helpers/foundry-mock.mjs";
import { previewNativeAttack, executeNativeAttack } from "../../scripts/chat/native-attack.mjs";
import { rollAttackCardDamage, applyAttackCardDamage } from "../../scripts/chat/attack-card/service.mjs";
import { renderAttackCard } from "../../scripts/chat/attack-card/render.mjs";
const M = "sf2e-tactical-starship-combat";
let counter = 0;
async function scenario(mode = "log") {
  installFoundryMock();
  await loadContentFromDisk();
  await game.settings.set(M, "chatAnnouncements", mode);
  const crew = makeCharacter({ id: "pc", name: "Gunner", owners: ["p1"] });
  const ship = makeShip({
    id: "ship",
    name: "Ship",
    owners: [],
    stations: [{ id: "g", type: "gunnery", grade: "commercial", helmedBy: crew.uuid, weaponId: "w1" }],
    weapons: [
      { id: "w1", weaponRef: "coilgun", name: "Coilgun" },
      { id: "w2", weaponRef: "light-laser-cannon", name: "Laser" }
    ],
    crew: [{ actorUuid: crew.uuid, role: "crew", stationId: "g" }]
  });
  const target = makeShip({ id: "enemy", name: "Target", role: "npc", ac: 18 });
  const other = makeShip({ id: "enemy2", name: "Other", role: "npc", ac: 18 });
  const combat = makeStarshipCombat({
    objects: [
      { key: ship.uuid, zone: 2, alwaysVisible: true },
      { key: target.uuid, zone: 3, detection: { party: "identified" } },
      { key: other.uuid, zone: 3, detection: { party: "identified" } }
    ]
  });
  const payload = {
    shipUuid: ship.uuid,
    actionId: "strike",
    crewUuid: crew.uuid,
    stationId: "g",
    combatId: combat.id,
    eventId: `attack_event_${++counter}`,
    options: { sheetRoll: true, weaponId: "w1", mapChoice: "0", targetKey: target.uuid }
  };
  return { crew, ship, target, other, combat, payload, user: game.users.get("p1"), gm: game.users.get("gm") };
}
const rolls = () => game.messages.contents.filter((m) => m.rolls?.length && String(m.rolls[0].formula).startsWith("1d20"));

test("all chat modes: preview writes nothing and a missed shot creates one system roll, no declaration", async () => {
  for (const mode of ["log", "important", "all"]) {
    const s = await scenario(mode);
    const preview = await previewNativeAttack({ user: s.user, payload: s.payload });
    assert.ok(preview.range >= 0);
    assert.equal(game.messages.size, 0);
    dice(4);
    const result = await executeNativeAttack({ user: s.user, payload: s.payload });
    assert.equal(result.degree, 0); // natural 4 versus AC 18
    assert.equal(game.messages.size, 1);
    assert.equal(rolls().length, 1);
    assert.equal(game.messages.get(result.messageId).flags[M].attackCard, undefined);
    assert.equal(
      game.messages.contents.some((m) => m.flags[M]?.attackDiag),
      false
    );
  }
});

test("concurrent repeated event is processed once; different events and targets stay independent", async () => {
  const s = await scenario();
  dice(4, 5);
  const [a, b] = await Promise.all([
    executeNativeAttack({ user: s.user, payload: s.payload }),
    executeNativeAttack({ user: s.user, payload: s.payload })
  ]);
  assert.equal(a.messageId, b.messageId);
  assert.equal(rolls().length, 1);
  await executeNativeAttack({
    user: s.user,
    payload: {
      ...s.payload,
      eventId: `attack_event_${++counter}`,
      options: { ...s.payload.options, targetKey: s.other.uuid, mapChoice: "2" }
    }
  });
  assert.equal(rolls().length, 2);
});

test("hit retains native message contents and bound deferred damage, applied once by GM", async () => {
  const s = await scenario();
  dice(20);
  const res = await executeNativeAttack({ user: s.user, payload: s.payload });
  const msg = game.messages.get(res.messageId),
    content = msg.content;
  assert.equal(msg.flags[M].attackCard.native, true);
  assert.equal(msg.flags[M].attackCard.result.pendingDamage.targetUuid, s.target.uuid);
  assert.equal(game.messages.size, 1);
  dice(3);
  await rollAttackCardDamage({ user: s.user, payload: { messageId: msg.id } });
  assert.equal(msg.content, content);
  assert.equal(game.messages.size, 2);
  await assert.rejects(() => applyAttackCardDamage({ user: s.user, payload: { messageId: msg.id } }));
  await applyAttackCardDamage({ user: s.gm, payload: { messageId: msg.id } });
  assert.equal(msg.content, content);
  await assert.rejects(() => applyAttackCardDamage({ user: s.gm, payload: { messageId: msg.id } }));
});

test("SF2e-style native check callback preserves the real system message", async () => {
  const s = await scenario();
  let passed;
  class NativeStatistic {
    constructor() {
      this.check = {
        roll: async (opts) => {
          passed = opts;
          const roll = await new MockRoll("1d20 + 5").evaluate();
          const msg = await roll.toMessage({ flavor: "SF2e" });
          await opts.callback(roll, "success", msg);
          return roll;
        }
      };
    }
    clone() {
      return this;
    }
  }
  s.crew.skills = { acrobatics: new NativeStatistic() };
  dice(16);
  const result = await executeNativeAttack({ user: s.user, payload: s.payload });
  assert.equal(passed.createMessage, true);
  assert.equal(game.messages.get(result.messageId).flavor, undefined); // mock keeps native message content
  assert.equal(rolls().length, 1);
  assert.ok(game.messages.get(result.messageId).flags[M].nativeAttackReceipt);
});

test("old resolved module cards no longer repeat attack result", async () => {
  const s = await scenario();
  const card = {
    status: "resolved",
    action: { builtin: "strike" },
    result: { attack: { total: 24, natural: 18, ac: 17 }, pendingDamage: null },
    ship: {},
    weapon: {}
  };
  const html = renderAttackCard({ flags: { [M]: { attackCard: card } } });
  assert.doesNotMatch(html, /24|18|17/);
  await assert.rejects(() =>
    executeNativeAttack({ user: game.users.get("p2"), payload: { ...s.payload, eventId: `attack_event_${++counter}` } })
  );
});

test("all four degrees, MAP and distinct weapons produce distinct attack rolls", async () => {
  const s = await scenario();
  for (const [die, degree] of [
    [1, 0],
    [10, 1],
    [18, 2],
    [20, 3]
  ]) {
    dice(die);
    const r = await executeNativeAttack({ user: s.user, payload: { ...s.payload, eventId: `degree_event_${++counter}` } });
    assert.equal(r.degree, degree);
  }
  assert.equal(rolls().length, 4);
  dice(18);
  const second = await executeNativeAttack({
    user: s.user,
    payload: { ...s.payload, eventId: `weapon_event_${++counter}`, options: { ...s.payload.options, weaponId: "w2", mapChoice: "2" } }
  });
  const secondMessage = game.messages.get(second.messageId);
  assert.ok(secondMessage.rolls[0].total < 18, "MAP is applied to the second weapon");
  assert.equal(rolls().length, 5);
});

test("station attack rolls typed damage once and applies it without a duplicate result card", async () => {
  const s = await scenario("log");
  dice(20, 3);
  const r = await executeNativeAttack({ user: s.user, payload: { ...s.payload, options: { ...s.payload.options, sheetRoll: false } } });
  assert.equal(rolls().length, 1);
  const damage = game.messages.contents.find((m) => m.flags[M]?.autoAppliedDamage);
  assert.ok(damage);
  assert.equal(damage.flags.sf2e.suppressDamageButtons, true);
  assert.equal(game.messages.size, 2);
  assert.equal(game.messages.get(r.messageId).flags[M].attackCard, undefined);
});

test("receipt survives service reload and stops replay of an already completed shot", async () => {
  const s = await scenario();
  dice(4);
  const first = await executeNativeAttack({ user: s.user, payload: s.payload });
  const fresh = await import(`../../scripts/chat/native-attack.mjs?restart=${counter}`);
  const again = await fresh.executeNativeAttack({ user: s.user, payload: s.payload });
  assert.equal(again.duplicate, true);
  assert.equal(again.messageId, first.messageId);
  assert.equal(rolls().length, 1);
});

test("failure after a system message is posted never falls back to a second attack roll", async () => {
  const s = await scenario();
  class NativeStatistic {
    constructor() {
      this.check = {
        roll: async (opts) => {
          const roll = await new MockRoll("1d20").evaluate();
          const msg = await roll.toMessage({});
          await opts.callback(roll, "failure", msg);
          throw new Error("post-roll failure");
        }
      };
    }
    clone() {
      return this;
    }
  }
  s.crew.skills = { acrobatics: new NativeStatistic() };
  dice(4, 19);
  await assert.rejects(() => executeNativeAttack({ user: s.user, payload: s.payload }), /post-roll failure/);
  await assert.rejects(() => executeNativeAttack({ user: s.user, payload: s.payload }), /post-roll failure/);
  assert.equal(rolls().length, 1);
  const fresh = await import(`../../scripts/chat/native-attack.mjs?failed=${counter}`);
  await assert.rejects(() => fresh.executeNativeAttack({ user: s.user, payload: s.payload }), /already|уже|finish/i);
  assert.equal(rolls().length, 1);
});

test("socket dispatcher authenticates sender and coalesces duplicate weapon requests", async () => {
  const s = await scenario();
  globalThis.Hooks.on ??= () => {};
  const { registerAttackCards } = await import("../../scripts/chat/attack-card/client.mjs");
  const { dispatchSocketMessage } = await import("../../scripts/socket.mjs");
  registerAttackCards();
  const emitted = [];
  const env = { users: game.users, selfId: "gm", isActiveGM: true, clientEvents: new Map(), emit: (m) => emitted.push(m) };
  const request = (sender, id, payload, claimed = "p1") =>
    dispatchSocketMessage({ kind: "request", type: "executeNativeAttack", requestId: id, userId: claimed, payload }, sender, env);
  dice(4, 4);
  await request("p2", "spoof", { ...s.payload, eventId: `spoof_event_${++counter}` });
  assert.equal(emitted.at(-1).ok, false);
  assert.equal(emitted.at(-1).to, "p2");
  assert.equal(rolls().length, 0);
  await Promise.all([request("p1", "one", s.payload), request("p1", "two", s.payload)]);
  assert.equal(rolls().length, 1);
  assert.equal(emitted.filter((m) => m.ok).length, 2);
  await request("p1", "three", { ...s.payload, eventId: `next_event_${++counter}` });
  assert.equal(rolls().length, 2);
});

test("station damage falls back before rolling if system DamageRoll is unavailable", async () => {
  const s = await scenario("log");
  const saved = globalThis.CONFIG.Dice.rolls;
  globalThis.CONFIG.Dice.rolls = [];
  try {
    dice(20, 3);
    await executeNativeAttack({ user: s.user, payload: { ...s.payload, options: { ...s.payload.options, sheetRoll: false } } });
    assert.equal(rolls().length, 1);
    assert.equal(game.messages.size, 2);
  } finally {
    globalThis.CONFIG.Dice.rolls = saved;
  }
});

test("preview rejects a missing chosen target without a roll or chat message", async () => {
  const s = await scenario();
  await assert.rejects(() =>
    previewNativeAttack({ user: s.user, payload: { ...s.payload, options: { ...s.payload.options, targetKey: "Actor.missing" } } })
  );
  assert.equal(game.messages.size, 0);
});

test("native failure or cancellation before callback does not auto-reroll", async () => {
  for (const kind of ["throw", "cancel"]) {
    const s = await scenario();
    class NativeStatistic {
      constructor() {
        this.check = {
          roll: async () => {
            if (kind === "throw") throw new Error("native failure");
            return null;
          }
        };
      }
      clone() {
        return this;
      }
    }
    s.crew.skills = { acrobatics: new NativeStatistic() };
    dice(20);
    await assert.rejects(() => executeNativeAttack({ user: s.user, payload: s.payload }));
    assert.equal(game.messages.size, 0);
  }
});

test("manual modifiers: explicit GM approval, attack/damage scope, and duplicate request", async () => {
  const s = await scenario();
  let approvals = 0;
  foundry.applications.api.DialogV2.confirm = async () => {
    approvals++;
    return true;
  };
  const payload = {
    ...s.payload,
    manualModifiers: [
      { name: "Aid", source: "Ally", value: 2, type: "circumstance", scope: "attack" },
      { name: "Power", source: "GM", value: 3, type: "status", scope: "damage" }
    ]
  };
  dice(20);
  const [a, b] = await Promise.all([executeNativeAttack({ user: s.user, payload }), executeNativeAttack({ user: s.user, payload })]);
  assert.equal(a.messageId, b.messageId);
  assert.equal(approvals, 1);
  assert.equal(rolls().length, 1);
  assert.match(game.messages.get(a.messageId).flags[M].attackCard.result.pendingDamage.formula, /\+3/);
});

test("manual modifiers: denied or malformed proposals never roll", async () => {
  const s = await scenario();
  foundry.applications.api.DialogV2.confirm = async () => false;
  const mod = { name: "Aid", source: "Ally", value: 2, type: "circumstance", scope: "attack" };
  await assert.rejects(() =>
    executeNativeAttack({ user: s.user, payload: { ...s.payload, eventId: `deny_event_${++counter}`, manualModifiers: [mod] } })
  );
  assert.equal(game.messages.size, 0);
  await assert.rejects(() =>
    executeNativeAttack({
      user: s.user,
      payload: { ...s.payload, eventId: `bad_event_${++counter}`, manualModifiers: [{ ...mod, value: 900 }] }
    })
  );
  assert.equal(game.messages.size, 0);
});
