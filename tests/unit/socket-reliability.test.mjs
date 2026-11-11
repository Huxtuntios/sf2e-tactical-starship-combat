import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, MockUser } from "../helpers/foundry-mock.mjs";
import { initSocket, request, registerHandler } from "../../scripts/socket.mjs";
import { MODULE_ID, SOCKET_EVENT } from "../../scripts/constants.mjs";

// A deterministic clock also exposes leaked request timers, without waiting in real time.
function harness(t) {
  const users = [
    new MockUser({ id: "gm", name: "GM", isGM: true }),
    new MockUser({ id: "gm2", name: "Other GM", isGM: true }),
    new MockUser({ id: "p1", name: "Player" }),
    new MockUser({ id: "p2", name: "Other player" })
  ];
  const mock = installFoundryMock({ users });
  mock.setUser("p1");
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
    const id = ++nextId;
    timers.set(id, { at: now + delay, fn: () => fn(...args) });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
  const tick = (ms) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = end;
  };
  const listeners = new Map();
  const sent = [];
  const socket = {
    connected: true,
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    off(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    emit(name, msg) {
      assert.equal(name, SOCKET_EVENT);
      sent.push(msg);
    }
  };
  game.socket = socket;
  const cleanup = initSocket();
  t.after(() => {
    cleanup();
    assert.equal(timers.size, 0, "all request timers cleaned up");
    assert.ok(
      [...listeners.values()].every((set) => set.size === 0),
      "socket listeners removed"
    );
    for (const name of ["userConnected", "updateUser", "deleteUser"]) assert.equal(Hooks._hooks.get(name)?.length, 0);
  });
  const deliver = async (msg, sender = "gm") => {
    for (const fn of listeners.get(SOCKET_EVENT) ?? []) await fn(msg, sender);
  };
  const observe = (promise) => {
    const state = { settled: 0 };
    state.done = promise.then(
      (result) => {
        state.settled++;
        state.result = result;
      },
      (error) => {
        state.settled++;
        state.error = error;
      }
    );
    return state;
  };
  const start = (type = "executeAction", payload = {}) => {
    const state = observe(request(type, payload));
    const id = sent.at(-1)?.requestId;
    return {
      state,
      ack: (sender = "gm") => deliver({ kind: "accepted", requestId: id, to: "p1" }, sender),
      reply: (result = "done", sender = "gm", extra = {}) =>
        deliver({ kind: "response", requestId: id, to: "p1", ok: true, result, ...extra }, sender)
    };
  };
  return { ...mock, users, timers, tick, listeners, socket, sent, deliver, observe, start, cleanup };
}

async function flush() {
  // Drain promise adoption and the real client's catch/finally chains, not wall-clock time.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function expectError(state, key) {
  assert.equal(state.settled, 1);
  assert.equal(state.error?.message, game.i18n.localize(`SF2eTSC.errors.${key}`));
}

for (const type of ["executeAction", "executeNativeAttack", "resolveAttackCard", "applyAttackCardDamage"]) {
  test(`${type}: first ack replaces 15s wait with one 120s result deadline`, async (t) => {
    const h = harness(t);
    const r = h.start(type);
    h.tick(14999);
    await r.ack();
    h.tick(15000);
    await flush();
    assert.equal(r.state.settled, 0);
    h.tick(104999);
    await flush();
    assert.equal(r.state.settled, 0);
    h.tick(1);
    await r.state.done;
    expectError(r.state, "timeout");
    assert.equal(h.timers.size, 0);
    await r.ack();
    await r.reply("late");
    expectError(r.state, "timeout");
    assert.equal(h.timers.size, 0, "late ack cannot recreate pending state");
  });
}

test("duplicate acknowledgements cannot extend the result deadline", async (t) => {
  const h = harness(t);
  const r = h.start();
  await r.ack();
  h.tick(60000);
  await r.ack();
  h.tick(59999);
  await r.ack();
  assert.equal(h.timers.size, 1);
  h.tick(1);
  await r.state.done;
  expectError(r.state, "timeout");
});

test("no ack times out at 15s; late and duplicate responses remain ignored", async (t) => {
  const h = harness(t);
  const r = h.start();
  h.tick(14999);
  await flush();
  assert.equal(r.state.settled, 0);
  h.tick(1);
  await r.state.done;
  expectError(r.state, "timeout");
  await r.reply();
  await r.reply();
  assert.equal(r.state.settled, 1);
  assert.equal(h.timers.size, 0);
});

test("ordinary requests cannot gain a longer deadline from an unsolicited ack", async (t) => {
  const h = harness(t);
  const r = h.start("sensorUpdate");
  h.tick(14000);
  await r.ack();
  h.tick(1000);
  await r.state.done;
  expectError(r.state, "timeout");
});

test("forged, missing, wrong-recipient and other authenticated GM replies/acks are ignored", async (t) => {
  const h = harness(t);
  const r = h.start();
  for (const sender of ["p2", "unknown", "", "gm2"]) {
    await r.ack(sender);
    await r.reply("forged", sender, { userId: "gm" });
  }
  await h.deliver({ kind: "accepted", requestId: h.sent[0].requestId, to: "p2" });
  await r.reply("wrong recipient", "gm", { to: "p2" });
  for (const fn of h.listeners.get(SOCKET_EVENT))
    await fn({ kind: "response", requestId: h.sent[0].requestId, to: "p1", ok: true, userId: "gm" }, undefined);
  await flush();
  assert.equal(r.state.settled, 0);
  h.tick(15000);
  await r.state.done;
  expectError(r.state, "timeout");
});

for (const acknowledged of [false, true]) {
  test(`success ${acknowledged ? "after ack" : "without ack"} settles once and removes its timer`, async (t) => {
    const h = harness(t);
    const r = h.start();
    if (acknowledged) await r.ack();
    await r.reply({ roll: "done" });
    await r.state.done;
    assert.deepEqual(r.state.result, { roll: "done" });
    assert.equal(h.timers.size, 0);
    await r.reply("duplicate");
    await r.ack();
    h.tick(200000);
    assert.equal(r.state.settled, 1);
    assert.deepEqual(r.state.result, { roll: "done" });
  });

  for (const change of ["disconnectGM", "demoteGM", "deleteGM", "electOtherGM"]) {
    test(`${change} rejects ${acknowledged ? "acknowledged" : "unacknowledged"} requests`, async (t) => {
      const h = harness(t);
      const r = h.start();
      if (acknowledged) await r.ack();
      const gm = game.users.get("gm");
      if (change === "disconnectGM")
        Hooks.callAll("userConnected", gm, false); // activeGM may not have refreshed yet
      else if (change === "demoteGM") {
        gm.isGM = false;
        Hooks.callAll("updateUser", gm, { role: 1 }, {}, "gm");
      } else if (change === "deleteGM") {
        game.users.delete("gm");
        Hooks.callAll("deleteUser", gm, {}, "gm");
      } else {
        [h.users[0], h.users[1]] = [h.users[1], h.users[0]];
        assert.equal(gm.active, true, "original GM remains connected");
        Hooks.callAll("updateUser", game.users.get("gm2"), { role: 4 }, {}, "gm2");
      }
      await r.state.done;
      expectError(r.state, "socketGMChanged");
      assert.equal(h.timers.size, 0);
      await r.reply("old GM");
      await r.reply("new GM", "gm2");
      assert.equal(r.state.settled, 1);
    });
  }

  test(`transport disconnect rejects ${acknowledged ? "acknowledged" : "unacknowledged"} requests; reconnect cannot revive them`, async (t) => {
    const h = harness(t);
    const r = h.start();
    if (acknowledged) await r.ack();
    h.socket.connected = false;
    for (const fn of h.listeners.get("disconnect")) fn("transport close");
    await r.state.done;
    expectError(r.state, "socketDisconnected");
    const offline = h.observe(request("executeAction"));
    await offline.done;
    expectError(offline, "socketDisconnected");
    assert.equal(h.sent.length, 1, "no request buffered while offline");
    h.socket.connected = true;
    await r.ack();
    await r.reply("late");
    const next = h.start();
    await next.reply("new request");
    await next.state.done;
    assert.equal(next.state.result, "new request");
    expectError(r.state, "socketDisconnected");
  });
}

test("unrelated user hooks do not reject a request", async (t) => {
  const h = harness(t);
  const r = h.start();
  Hooks.callAll("userConnected", game.users.get("p2"), false);
  Hooks.callAll("updateUser", game.users.get("p2"), { name: "Changed" }, {}, "p2");
  await r.reply();
  await r.state.done;
  assert.equal(r.state.result, "done");
});

for (const at of ["ack", "response", "deadline"]) {
  test(`authority rechecked at ${at} even without a hook notification`, async (t) => {
    const h = harness(t);
    const r = h.start();
    game.users.get("gm").active = false;
    if (at === "ack") await r.ack();
    else if (at === "response") await r.reply();
    else h.tick(15000);
    await r.state.done;
    expectError(r.state, "socketGMChanged");
  });
}

test("deadline also detects disconnected transport if its event was missed", async (t) => {
  const h = harness(t);
  const r = h.start();
  h.socket.connected = false;
  h.tick(15000);
  await r.state.done;
  expectError(r.state, "socketDisconnected");
});

test("no active GM rejects without emitting or leaving timers", async (t) => {
  const h = harness(t);
  for (const u of h.users) u.isGM = false;
  const state = h.observe(request("executeAction"));
  await state.done;
  expectError(state, "noGM");
  assert.equal(h.sent.length, 0);
  assert.equal(h.timers.size, 0);
});

test("synchronous emit failure cleans pending state immediately", async (t) => {
  const h = harness(t);
  const error = new Error("emit failed");
  t.mock.method(h.socket, "emit", (name, msg) => {
    h.sent.push(msg);
    throw error;
  });
  const r = h.start();
  await r.state.done;
  assert.equal(r.state.error, error);
  assert.equal(h.timers.size, 0);
  await r.ack();
  await r.reply();
  assert.equal(r.state.settled, 1);
});

test("GM rejection preserves its error and clears its timer", async (t) => {
  const h = harness(t);
  const r = h.start();
  await r.ack();
  await r.reply(null, "gm", { ok: false, error: "validation failed" });
  await r.state.done;
  assert.equal(r.state.error.message, "validation failed");
  assert.equal(h.timers.size, 0);
});

test("socket initialization is idempotent; cleanup settles pending and permits reinstallation", async (t) => {
  const h = harness(t);
  assert.equal(initSocket(), h.cleanup);
  for (const name of [SOCKET_EVENT, "disconnect"]) assert.equal(h.listeners.get(name).size, 1);
  for (const name of ["userConnected", "updateUser", "deleteUser"]) assert.equal(Hooks._hooks.get(name).length, 1);
  const r = h.start();
  h.cleanup();
  h.cleanup();
  await r.state.done;
  expectError(r.state, "socketDisconnected");
  const cleanup = initSocket();
  t.after(cleanup);
  assert.notEqual(cleanup, h.cleanup);
  const next = h.start();
  await next.reply();
  await next.state.done;
  assert.equal(next.state.result, "done");
  cleanup();
});

test("GM acknowledges remote damage before its deferred handler finishes", async (t) => {
  const h = harness(t);
  h.setUser("gm");
  let finish;
  registerHandler("applyAttackCardDamage", ({ user, remote, payload }) => {
    assert.equal(user, game.users.get("gm2"));
    assert.equal(remote, true);
    assert.deepEqual(payload, { messageId: "damage-card" });
    return new Promise((resolve) => (finish = resolve));
  });
  const dispatch = h.deliver(
    { kind: "request", requestId: "damage-request", type: "applyAttackCardDamage", payload: { messageId: "damage-card" } },
    "gm2"
  );
  await flush();
  assert.deepEqual(h.sent, [{ kind: "accepted", requestId: "damage-request", to: "gm2" }]);
  h.tick(20000);
  finish({ applied: true });
  await dispatch;
  assert.deepEqual(h.sent[1], { kind: "response", requestId: "damage-request", to: "gm2", ok: true, result: { applied: true } });
});

for (const type of ["sensorUpdate", "executeAction", "applyAttackCardDamage"]) {
  test(`local ${type} is bounded without cancelling the handler or accepting socket replies`, async (t) => {
    const h = harness(t);
    h.setUser("gm");
    let finish;
    let completed = false;
    registerHandler(type, ({ user, userId, remote, payload }) => {
      assert.equal(user, game.user);
      assert.equal(userId, "gm");
      assert.equal(remote, false);
      assert.deepEqual(payload, { value: 1 });
      return new Promise((resolve) => {
        finish = () => {
          completed = true;
          resolve("late local result");
        };
      });
    });
    t.mock.method(foundry.utils, "randomID", () => "local-request");
    const state = h.observe(request(type, { value: 1 }));
    await h.deliver({ kind: "response", requestId: "local-request", to: "gm", ok: true, result: "wrong" });
    await h.deliver({ kind: "accepted", requestId: "local-request", to: "gm" });
    const deadline = type === "sensorUpdate" ? 15000 : 120000;
    h.tick(deadline - 1);
    await flush();
    assert.equal(state.settled, 0);
    h.tick(1);
    await state.done;
    expectError(state, "timeout");
    assert.equal(completed, false);
    assert.equal(h.sent.length, 0);
    assert.equal(h.timers.size, 0);
    finish();
    await flush();
    assert.equal(completed, true, "timeout did not cancel handler");
    expectError(state, "timeout");
  });
}

test("local success, synchronous throw, async rejection and unknown handler all clean up", async (t) => {
  const h = harness(t);
  h.setUser("gm");
  registerHandler("local-success", () => "local result");
  registerHandler("local-async-success", async () => "async local result");
  assert.equal(await request("local-success"), "local result");
  assert.equal(await request("local-async-success"), "async local result");
  const error = new Error("local failure");
  registerHandler("local-throw", () => {
    throw error;
  });
  registerHandler("local-reject", () => Promise.reject(error));
  await assert.rejects(request("local-throw"), (e) => e === error);
  await assert.rejects(request("local-reject"), (e) => e === error);
  await assert.rejects(request("local-unknown"), /Unknown request type/);
  assert.equal(h.timers.size, 0);
});

test("local late rejection is consumed after authority loss", async (t) => {
  const h = harness(t);
  h.setUser("gm");
  let rejectHandler;
  registerHandler(
    "local-delayed",
    () =>
      new Promise((resolve, reject) => {
        rejectHandler = reject;
      })
  );
  const state = h.observe(request("local-delayed"));
  game.users.get("gm").isGM = false;
  Hooks.callAll("updateUser", game.user, { role: 1 }, {}, "gm2");
  await state.done;
  expectError(state, "socketGMChanged");
  rejectHandler(new Error("late failure"));
  await flush();
  expectError(state, "socketGMChanged");
  assert.equal(h.timers.size, 0);
});

for (const action of ["cancel", "apply"]) {
  test(`real attack-card ${action} releases disabled/busy controls after ack timeout`, async (t) => {
    const h = harness(t);
    if (action === "apply") h.setUser("gm2");
    const { registerAttackCards } = await import("../../scripts/chat/attack-card/client.mjs");
    registerAttackCards();
    const button = { dataset: { tscAttack: action }, disabled: false };
    let click;
    const card = {
      querySelectorAll: (selector) => (selector === "[data-gm-only]" ? [] : [button]),
      addEventListener: (name, fn) => {
        click = fn;
      }
    };
    class Element {
      queries = 0;
      querySelector(selector) {
        // Skip HTML rendering; exercise the actual production click handler and finally.
        return selector === ".tsc-attack-card" && ++this.queries > 1 ? card : null;
      }
    }
    const originalElement = globalThis.HTMLElement;
    globalThis.HTMLElement = Element;
    t.after(() => {
      if (originalElement === undefined) delete globalThis.HTMLElement;
      else globalThis.HTMLElement = originalElement;
    });
    const message = { id: "card-message", flags: { [MODULE_ID]: { attackCard: { createdBy: "p1" } } } };
    Hooks.callAll("renderChatMessageHTML", message, new Element());
    const event = {
      target: { closest: (selector) => (selector === "[data-tsc-attack]" ? button : null) },
      preventDefault() {},
      stopPropagation() {}
    };
    click(event);
    assert.equal(button.disabled, true);
    assert.equal(button.dataset.busy, "1");
    click(event);
    assert.equal(h.sent.length, 1, "busy control prevents repeated clicks while waiting");
    await h.deliver({ kind: "accepted", requestId: h.sent[0].requestId, to: game.user.id });
    h.tick(120000);
    await flush();
    assert.equal(button.disabled, false);
    assert.equal(button.dataset.busy, undefined);
    assert.ok(globalThis.__notes.some(([kind, text]) => kind === "error" && text.includes(game.i18n.localize("SF2eTSC.errors.timeout"))));
  });
}
