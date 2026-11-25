import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeCharacter } from "../helpers/foundry-mock.mjs";
import { wireToolbeltDamage } from "../../scripts/integrations/toolbelt-damage.mjs";
import { STARSHIP_DAMAGE_ADAPTER } from "../../scripts/integrations/toolbelt-damage-service.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

class Element {
  constructor() {
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      contains: (name) => this.classes.has(name),
      toggle: (name, enabled) => (enabled ? this.classes.add(name) : this.classes.delete(name))
    };
  }

  querySelectorAll(selector) {
    if (selector === ".damage-application") return this.rows ?? [];
    if (selector.startsWith("[data-action=")) return this.nativeButtons ?? [];
    return this.persistentButtons?.[selector] ?? [];
  }

  querySelector(selector) {
    if (selector === ".tsc-ship-damage-controls") return this.controls ?? null;
    if (selector === ".tsc-ship-damage-multiplier") return this.controls?.children?.[0] ?? null;
    return null;
  }

  append(...children) {
    this.children.push(...children);
    for (const child of children) {
      child.parent = this;
      if (child.className === "tsc-ship-damage-controls") this.controls = child;
    }
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  remove() {
    this.removed = true;
    if (this.parent?.controls === this) delete this.parent.controls;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener)
    );
  }

  contains() {
    return true;
  }

  async dispatch(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) await listener(event);
  }
}

function installDom(t) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
  globalThis.document = { createElement: () => new Element() };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
    if (previousObserver) Object.defineProperty(globalThis, "MutationObserver", previousObserver);
    else delete globalThis.MutationObserver;
  });
  installFoundryMock();
}

function damageRow(targetUuid) {
  const row = new Element();
  row.dataset.targetUuid = targetUuid;
  const button = new Element();
  button.dataset = { action: "applyDamage", multiplier: "1" };
  button.closest = () => row;
  row.nativeButtons = [button];
  return { row, button };
}

function clickEvent(button) {
  const event = {
    target: { closest: () => button },
    prevented: false,
    stopped: 0,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped++;
    }
  };
  return event;
}

function persistentCard() {
  const ship = makeShip({
    id: "persistent-ship",
    extra: { persistentDamageReceipts: [{ id: "receipt", status: "pending" }] }
  });
  const flag = { shipUuid: ship.uuid, receiptId: "receipt" };
  return {
    ship,
    flag,
    message: { id: "persistent-card", flags: { [MODULE_ID]: { persistentDamage: flag } } }
  };
}

test("persistent damage card uses persistent receipt routing", async (t) => {
  installDom(t);
  const { ship, flag, message } = persistentCard();
  const root = new Element();
  const applyButton = new Element();
  applyButton.dataset.tscPersistentApply = "";
  root.persistentButtons = { "[data-tsc-persistent-apply]": [applyButton] };
  const sent = [];
  const binding = wireToolbeltDamage(message, root, {
    send: async (type, payload) => sent.push({ type, payload })
  });
  assert.ok(binding);
  assert.equal(root.dataset.tscPersistentWired, "1");
  assert.equal(root.dataset.tscDamageWired, undefined);
  assert.equal(root.dataset.tscDamageAdapter, undefined);
  await binding.refresh();
  assert.equal(applyButton.disabled, false);
  const event = clickEvent(applyButton);
  await root.dispatch("click", event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, 1);
  assert.deepEqual(sent, [{ type: "applyPersistentDamage", payload: { shipUuid: ship.uuid, receiptId: flag.receiptId } }]);
  assert.equal(wireToolbeltDamage(message, root), null);
  binding.close();
  assert.equal(root.dataset.tscPersistentWired, undefined);
  assert.equal(root.listeners.get("click").length, 0);
});

test("persistent cards intercept native Toolbelt buttons without binding ordinary starship damage", async (t) => {
  installDom(t);
  const { ship, flag, message } = persistentCard();
  const { row, button } = damageRow(ship.uuid);
  const root = new Element();
  root.rows = [row];
  const sent = [];
  const binding = wireToolbeltDamage(message, root, {
    send: async (type, payload) => sent.push({ type, payload })
  });
  assert.ok(binding);
  assert.equal(root.dataset.tscDamageWired, undefined);
  assert.equal(button.hidden, undefined);
  const event = clickEvent(button);
  await root.dispatch("click", event);
  assert.equal(event.stopped, 1);
  assert.deepEqual(sent, [{ type: "applyPersistentDamage", payload: { shipUuid: ship.uuid, receiptId: flag.receiptId } }]);
  binding.close();
});

test("ordinary starship cards retain the native-first Toolbelt damage adapter", async (t) => {
  installDom(t);
  const ship = makeShip({ id: "ordinary-ship", sp: 12, hp: 30 });
  const token = { uuid: "Scene.scene.Token.ordinary-ship", actor: ship };
  globalThis.__extraUuids.set(token.uuid, token);
  const { row, button } = damageRow(token.uuid);
  const root = new Element();
  root.rows = [row];
  const message = { id: "ordinary-card", isDamageRoll: true, flags: {} };
  const sent = [];
  const binding = wireToolbeltDamage(message, root, {
    send: async (type, payload) => sent.push({ type, payload })
  });
  assert.ok(binding);
  assert.equal(root.dataset.tscDamageWired, "1");
  assert.equal(root.dataset.tscDamageAdapter, STARSHIP_DAMAGE_ADAPTER);
  assert.equal(root.dataset.tscPersistentWired, undefined);
  assert.equal(button.hidden, true);
  assert.ok(row.controls);
  const event = clickEvent(button);
  await root.dispatch("click", event);
  assert.equal(event.stopped, 1);
  assert.deepEqual(sent, [
    {
      type: "toolbeltDamage",
      payload: { messageId: message.id, targetUuid: token.uuid, rollIndex: 0, multiplier: 1, addend: 0, mode: "shields" }
    }
  ]);
  binding.close();
  assert.equal(root.dataset.tscDamageWired, undefined);
  assert.equal(root.dataset.tscDamageAdapter, undefined);
  assert.equal(root.listeners.get("click").length, 0);
});

test("ordinary character cards leave native damage controls and events untouched", async (t) => {
  installDom(t);
  const character = makeCharacter({ id: "ordinary-character" });
  const token = { uuid: "Scene.scene.Token.ordinary-character", actor: character };
  globalThis.__extraUuids.set(token.uuid, token);
  const { row, button } = damageRow(token.uuid);
  const root = new Element();
  root.rows = [row];
  const message = { id: "character-card", isDamageRoll: true, flags: {} };
  const sent = [];
  const binding = wireToolbeltDamage(message, root, {
    send: async (type, payload) => sent.push({ type, payload })
  });
  assert.ok(binding);
  assert.equal(button.hidden, false);
  assert.equal(row.controls, undefined);
  const event = clickEvent(button);
  await root.dispatch("click", event);
  assert.equal(event.prevented, false);
  assert.equal(event.stopped, 0);
  assert.deepEqual(sent, []);
  binding.close();
});
