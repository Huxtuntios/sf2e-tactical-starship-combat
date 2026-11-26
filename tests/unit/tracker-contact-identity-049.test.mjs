import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, makeShip, makeStarshipCombat } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

const CONTACT_ICON = "icons/svg/mystery-man.svg";

function installTrackerDom(t) {
  const previousHTMLElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;
  globalThis.HTMLElement = class {};
  globalThis.document = {
    createElement: () => ({
      children: [],
      addEventListener() {},
      insertAdjacentHTML(_position, html) {
        this.children.push({ html });
      }
    })
  };
  t.after(() => {
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
}

function trackerDom(combatant) {
  const attributes = { title: "private tooltip", "aria-label": "Contact" };
  const name = {
    textContent: "Contact",
    attributes,
    html: "",
    removeAttribute(key) {
      delete this.attributes[key];
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    insertAdjacentHTML(_position, html) {
      this.html = html;
    }
  };
  const image = {
    src: CONTACT_ICON,
    alt: "Contact",
    attributes: { title: "private tooltip" },
    removeAttribute(key) {
      delete this.attributes[key];
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
  };
  const li = {
    dataset: { combatantId: combatant.id },
    querySelector(selector) {
      if (selector === ".token-name, .combatant-name, .name") return name;
      if (selector === "img.token-image, img") return image;
      return null;
    }
  };
  const header = { insertAdjacentElement() {} };
  const root = {
    querySelectorAll(selector) {
      return selector === "li.combatant[data-combatant-id]" ? [li] : [];
    },
    querySelector(selector) {
      return selector === "header, .combat-tracker-header" ? header : null;
    }
  };
  return { root, name, image };
}

function projection(combatant) {
  return {
    actorId: combatant.actorId,
    name: combatant.name,
    img: combatant.img,
    hidden: combatant.hidden,
    flags: structuredClone(combatant.flags)
  };
}

async function renderTracker(combatant) {
  const { decorateTracker } = await import("../../scripts/combat/tracker.mjs");
  const dom = trackerDom(combatant);
  decorateTracker({ viewed: combatant.combat }, [dom.root]);
  return dom;
}

async function setup(t) {
  installFoundryMock();
  installTrackerDom(t);
}

async function mapOnlyContact(t, { id, name }) {
  await setup(t);
  const { addSensorContact } = await import("../../scripts/sensor/contact-service.mjs");
  const { addSensorObjectToInitiative } = await import("../../scripts/sensor/initiative.mjs");
  const combat = makeStarshipCombat();
  const source = makeShip({ id, name, role: "npc" });
  const placement = await addSensorContact(combat, {
    source: "world",
    uuid: source.uuid,
    zone: 3,
    detection: "undetected"
  });
  assert.equal((await addSensorObjectToInitiative(combat.id, placement.key)).status, "added");
  const [combatant] = combat.combatants.contents;
  assert.equal(combatant.actorId, null);
  assert.equal(combatant.flags[MODULE_ID].sensorMapObject.key, placement.key);
  return { combat, combatant, source };
}

async function actorBackedContact(t, { id, name }) {
  await setup(t);
  const combat = makeStarshipCombat();
  const actor = makeShip({ id, name, role: "npc" });
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [
    {
      actorId: actor.id,
      name: "Contact",
      img: CONTACT_ICON,
      hidden: true,
      flags: { [MODULE_ID]: { sensorMapInitiative: { combatId: combat.id, contactDesignation: true } } }
    }
  ]);
  return { combat, combatant, actor };
}

function assertIdentity(dom, name, img) {
  assert.equal(dom.name.textContent, name);
  assert.equal(dom.name.attributes["aria-label"], name);
  assert.equal(Object.hasOwn(dom.name.attributes, "title"), false);
  assert.equal(dom.image.src, img);
  assert.equal(dom.image.alt, name);
  assert.equal(Object.hasOwn(dom.image.attributes, "title"), false);
}

function assertAnonymous(dom) {
  assertIdentity(dom, "Contact", CONTACT_ICON);
  assert.doesNotMatch(JSON.stringify([dom.name, dom.image]), /private tooltip/);
}

function assertRenderDidNotWrite(before) {
  assert.equal(globalThis.__writes.length, before.writes);
  assert.equal(globalThis.__socket.length, before.sockets);
}

test("GM tracker decorates a map-only Contact with its private snapshot name and art", async (t) => {
  const { combatant, source } = await mapOnlyContact(t, { id: "gm-map-source", name: "GM Hidden Raider" });
  const before = { ...projection(combatant), writes: globalThis.__writes.length, sockets: globalThis.__socket.length };

  const dom = await renderTracker(combatant);

  assertIdentity(dom, source.name, source.img);
  assert.deepEqual(projection(combatant), {
    actorId: before.actorId,
    name: before.name,
    img: before.img,
    hidden: before.hidden,
    flags: before.flags
  });
  assert.doesNotMatch(JSON.stringify(projection(combatant)), /GM Hidden Raider|ships\/gm-map-source\.webp/);
  assertRenderDidNotWrite(before);
});

test("GM tracker decorates an actor-backed Contact with its authorized actor name and art", async (t) => {
  const { combatant, actor } = await actorBackedContact(t, { id: "gm-actor-source", name: "GM Actor Secret" });
  const before = { ...projection(combatant), writes: globalThis.__writes.length, sockets: globalThis.__socket.length };
  let storeReads = 0;
  Object.defineProperty(game.journal, "contents", {
    configurable: true,
    get() {
      storeReads++;
      throw new Error("actor-backed Contacts must not read the private map store");
    }
  });

  const dom = await renderTracker(combatant);

  assertIdentity(dom, actor.name, actor.img);
  assert.equal(storeReads, 0);
  assert.deepEqual(projection(combatant), {
    actorId: before.actorId,
    name: before.name,
    img: before.img,
    hidden: before.hidden,
    flags: before.flags
  });
  assert.doesNotMatch(JSON.stringify(projection(combatant)), /GM Actor Secret|ships\/gm-actor-source\.webp/);
  assertRenderDidNotWrite(before);
});

test("player tracker keeps a map-only Contact anonymous without reading private identity sources", async (t) => {
  const { combatant } = await mapOnlyContact(t, { id: "player-map-source", name: "Player Map Secret" });
  const before = projection(combatant);
  const writes = globalThis.__writes.length;
  const sockets = globalThis.__socket.length;
  game.user = game.users.get("p1");
  let actorReads = 0;
  let mapKeyReads = 0;
  let storeReads = 0;
  Object.defineProperty(combatant, "actor", {
    configurable: true,
    get() {
      actorReads++;
      throw new Error("players must not resolve the private Contact actor");
    }
  });
  const mapObjectDescriptor = Object.getOwnPropertyDescriptor(combatant.flags[MODULE_ID], "sensorMapObject");
  Object.defineProperty(combatant.flags[MODULE_ID], "sensorMapObject", {
    configurable: true,
    get() {
      mapKeyReads++;
      throw new Error("players must not read the private map key");
    }
  });
  Object.defineProperty(game.journal, "contents", {
    configurable: true,
    get() {
      storeReads++;
      throw new Error("players must not read the private map store");
    }
  });

  const dom = await renderTracker(combatant);

  assertAnonymous(dom);
  assert.equal(actorReads, 0);
  assert.equal(mapKeyReads, 0);
  assert.equal(storeReads, 0);
  assert.doesNotMatch(JSON.stringify([dom.name, dom.image]), /Player Map Secret|ships\/player-map-source\.webp/);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(globalThis.__socket.length, sockets);
  delete combatant.actor;
  Object.defineProperty(combatant.flags[MODULE_ID], "sensorMapObject", mapObjectDescriptor);
  assert.deepEqual(projection(combatant), before);
});

test("player tracker keeps an actor-backed Contact anonymous without reading its actor", async (t) => {
  const { combatant } = await actorBackedContact(t, { id: "player-actor-source", name: "Player Actor Secret" });
  const before = projection(combatant);
  const writes = globalThis.__writes.length;
  const sockets = globalThis.__socket.length;
  game.user = game.users.get("p1");
  let actorReads = 0;
  let storeReads = 0;
  Object.defineProperty(combatant, "actor", {
    configurable: true,
    get() {
      actorReads++;
      throw new Error("players must not resolve the private Contact actor");
    }
  });
  Object.defineProperty(game.journal, "contents", {
    configurable: true,
    get() {
      storeReads++;
      throw new Error("players must not read the private map store");
    }
  });

  const dom = await renderTracker(combatant);

  assertAnonymous(dom);
  assert.equal(actorReads, 0);
  assert.equal(storeReads, 0);
  assert.doesNotMatch(JSON.stringify([dom.name, dom.image]), /Player Actor Secret|ships\/player-actor-source\.webp/);
  assert.equal(globalThis.__writes.length, writes);
  assert.equal(globalThis.__socket.length, sockets);
  delete combatant.actor;
  assert.deepEqual(projection(combatant), before);
});

test("GM tracker falls back to the anonymous projection when a map-only snapshot is missing", async (t) => {
  await setup(t);
  const combat = makeStarshipCombat();
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [
    {
      actorId: null,
      name: "Contact",
      img: CONTACT_ICON,
      hidden: true,
      flags: {
        [MODULE_ID]: {
          sensorMapInitiative: { combatId: combat.id, contactDesignation: true },
          sensorMapObject: { combatId: combat.id, key: "map-missing" }
        }
      }
    }
  ]);
  const before = projection(combatant);

  const dom = await renderTracker(combatant);

  assertAnonymous(dom);
  assert.deepEqual(projection(combatant), before);
});

test("GM tracker falls back to the anonymous projection when a map snapshot is no longer referenced", async (t) => {
  const { combat, combatant } = await mapOnlyContact(t, { id: "stale-map-source", name: "Stale Map Secret" });
  combat.flags[MODULE_ID].tsc.objects = [];
  game.journal.contents[0].flags[MODULE_ID].privateSensor.contacts = [];
  const before = projection(combatant);

  const dom = await renderTracker(combatant);

  assertAnonymous(dom);
  assert.deepEqual(projection(combatant), before);
});

test("non-Contact tracker badges retain HP/SP privacy for players", async (t) => {
  await setup(t);
  const combat = makeStarshipCombat();
  const actor = makeShip({ id: "badge-source", name: "Visible Enemy", role: "npc", hp: 40, sp: 12 });
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id }]);
  game.user = game.users.get("p1");

  const dom = await renderTracker(combatant);

  assert.match(dom.name.html, /class="tsc-badge"/);
  assert.match(dom.name.html, /L3/);
  assert.doesNotMatch(dom.name.html, /40\/40|12\/12|class="hp"|class="sp"/);
});
