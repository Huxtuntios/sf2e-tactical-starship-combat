/**
 * Minimal Foundry VTT / sf2e test double for unit tests of Foundry-dependent modules (no Foundry runtime).
 * It models only what the module touches: users, actors (flags/update/ownership), combat + combatants,
 * chat messages, settings, i18n, Hooks, Roll (scripted dice), uuid resolution and socket emits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
export const loadLang = (lang) => flat(JSON.parse(fs.readFileSync(path.join(ROOT, "lang", `${lang}.json`), "utf8")));

const getProperty = (o, k) => k.split(".").reduce((a, p) => (a == null ? undefined : a[p]), o);
function setProperty(o, k, v) {
  const parts = k.split(".");
  let cur = o;
  for (const p of parts.slice(0, -1)) {
    cur[p] ??= {};
    cur = cur[p];
  }
  cur[parts.at(-1)] = v;
}
function applyUpdate(target, changes) {
  for (const [k, v] of Object.entries(changes)) {
    if (k.includes(".")) setProperty(target, k, structuredClone(v));
    else if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") applyUpdate(target[k], v);
    else target[k] = structuredClone(v);
  }
}
let idc = 0;
const rid = () => `id${(++idc).toString(36).padStart(6, "0")}`;

class Collection extends Map {
  get contents() {
    return [...this.values()];
  }
  find(fn) {
    return this.contents.find(fn);
  }
  filter(fn) {
    return this.contents.filter(fn);
  }
  some(fn) {
    return this.contents.some(fn);
  }
  map(fn) {
    return this.contents.map(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

export class MockUser {
  constructor({ id, name, isGM = false, active = true }) {
    Object.assign(this, { id, name, isGM, active });
  }
}

export class MockActor {
  constructor({
    id = rid(),
    name = "Actor",
    type = "character",
    img = "icons/svg/mystery-man.svg",
    flags = {},
    system = {},
    owners = [],
    level = 1,
    prototypeToken = null
  }) {
    Object.assign(this, {
      id,
      name,
      type,
      img,
      flags: structuredClone(flags),
      system: structuredClone(system),
      owners,
      level,
      documentName: "Actor",
      isToken: false
    });
    this.prototypeToken = prototypeToken ?? { texture: { src: img } };
    this.synthetics = { multipleAttackPenalties: {} };
    this.items = new Collection();
  }
  async createEmbeddedDocuments(type, docs) {
    if (type !== "Item") throw new Error(`mock: ${type}`);
    if (!globalThis.game.user?.isGM && !this.isOwner) throw new Error("permission");
    const out = docs.map((d) => {
      const it = { ...structuredClone(d), id: rid(), parent: this };
      this.items.set(it.id, it);
      return it;
    });
    globalThis.__writes.push({ doc: this.uuid, createItems: out.length });
    return out;
  }
  async deleteEmbeddedDocuments(type, ids) {
    for (const id of ids) this.items.delete(id);
    globalThis.__writes.push({ doc: this.uuid, deleteItems: ids.length });
    return ids;
  }
  get uuid() {
    return `Actor.${this.id}`;
  }
  get hasPlayerOwner() {
    return this.owners.length > 0;
  }
  get isOwner() {
    return this.testUserPermission(globalThis.game.user, "OWNER");
  }
  testUserPermission(user, level) {
    if (user?.isGM) return true;
    if (level === "OBSERVER" && this.observers?.includes(user?.id)) return true;
    return this.owners.includes(user?.id);
  }
  getRollOptions() {
    return [];
  }
  async update(changes, options = {}) {
    globalThis.Hooks.callAll("preUpdateActor", this, changes, options);
    applyUpdate(this, changes);
    globalThis.__writes.push({ doc: this.uuid, changes });
    globalThis.Hooks.callAll("updateActor", this, changes, options);
    return this;
  }
}

export class MockCombatant {
  constructor(combat, data) {
    Object.assign(this, {
      id: data._id ?? rid(),
      combat,
      actorId: data.actorId ?? null,
      tokenId: data.tokenId ?? null,
      sceneId: data.sceneId ?? null,
      initiative: data.initiative ?? null,
      flags: structuredClone(data.flags ?? {}),
      hidden: !!data.hidden
    });
  }
  get actor() {
    return globalThis.game.actors.get(this.actorId) ?? null;
  }
  get name() {
    return this.actor?.name ?? "?";
  }
}

export class MockCombat {
  constructor({ id = rid(), round = 1, turn = 0, started = true, flags = {} } = {}) {
    Object.assign(this, { id, round, turn, started, flags: structuredClone(flags), active: true, scene: null });
    this.combatants = new Collection();
  }
  get turns() {
    return [...this.combatants.values()].sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity));
  }
  get combatant() {
    return this.turns[this.turn] ?? null;
  }
  async update(changes) {
    applyUpdate(this, changes);
    globalThis.__writes.push({ doc: `Combat.${this.id}`, changes });
    globalThis.Hooks.callAll("updateCombat", this, changes, {});
    return this;
  }
  async createEmbeddedDocuments(type, docs) {
    const out = docs.map((d) => {
      const c = new MockCombatant(this, d);
      this.combatants.set(c.id, c);
      return c;
    });
    for (const c of out) globalThis.Hooks.callAll("createCombatant", c);
    return out;
  }
  async deleteEmbeddedDocuments(type, ids) {
    for (const id of ids) this.combatants.delete(id);
  }
  /** test helper: make `actor` the active combatant */
  setTurnTo(actor) {
    const i = this.turns.findIndex((c) => c.actorId === actor.id);
    if (i < 0) throw new Error("no combatant");
    this.turn = i;
  }
}

export class MockChatMessage {
  constructor(data) {
    Object.assign(this, {
      id: rid(),
      content: data.content ?? "",
      flags: structuredClone(data.flags ?? {}),
      whisper: data.whisper ?? [],
      speaker: data.speaker ?? {},
      rolls: data.rolls ?? [],
      author: globalThis.game.user?.id
    });
  }
  get actor() {
    return this.speaker?.actor ? globalThis.game.actors.get(this.speaker.actor) : null;
  }
  async update(changes) {
    applyUpdate(this, changes);
    globalThis.__messageUpdates.push({ id: this.id, changes });
    return this;
  }
  static async create(data) {
    const m = new MockChatMessage(data);
    globalThis.game.messages.set(m.id, m);
    globalThis.Hooks.callAll("createChatMessage", m);
    return m;
  }
  static getSpeaker({ actor } = {}) {
    return actor ? { actor: actor.id, alias: actor.name } : { alias: "GM" };
  }
  static getWhisperRecipients() {
    return globalThis.game.users.filter((u) => u.isGM);
  }
}

/** Scripted dice: push d20 / die results with `dice(…)`; un-scripted dice roll their average (rounded up). */
export class MockRoll {
  constructor(formula) {
    this.formula = String(formula);
    this.dice = [];
  }
  async evaluate() {
    const expr = this.formula.replace(/(\d+)d(\d+)/g, (_, n, f) => {
      let sum = 0;
      const results = [];
      for (let i = 0; i < Number(n); i++) {
        const v = globalThis.__dice.length ? globalThis.__dice.shift() : Math.ceil(Number(f) / 2);
        results.push(v);
        sum += v;
      }
      this.dice.push({ faces: Number(f), total: sum, results });
      return String(sum);
    });
    this.total = Math.floor(Function(`"use strict"; return (${expr});`)());
    this._evaluated = true;
    return this;
  }
  async toMessage(data = {}) {
    return MockChatMessage.create({ ...data, rolls: [this], content: String(this.total) });
  }
}
/** Test double for SF2e typed instance pools. Not a replacement for system integration tests. */
export class DamageRoll extends MockRoll {
  async evaluate() {
    const expression = this.formula
      .replace(/[{}]/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/,/g, "+");
    const plain = await new MockRoll(expression).evaluate();
    this.total = plain.total;
    this.dice = plain.dice;
    return this;
  }
}

export function dice(...values) {
  globalThis.__dice.push(...values);
}

const SETTING_DEFAULTS = {
  ruleEnforcement: "strict",
  crewInitiativeScope: "crew",
  attackCards: true,
  playerShipInitiative: "disabled",
  debugLogging: false,
  areaWeaponZones: 0,
  autoFireConeZones: 0,
  automaticHelming: true,
  sensorMapSize: 12,
  sensorOrientation: "horizontal",
  showUnknownContacts: true,
  contactDesignation: "greek",
  customContent: { actions: [], weapons: [], stations: [], upgrades: [], ships: [], hazards: [] },
  smallCrewWarning: false,
  autoOpenSensorMap: false,
  movementMode: "clamp"
};

export function installFoundryMock({ lang = "en", users = null } = {}) {
  const strings = loadLang(lang);
  const fmtStr = (s, data) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
  const hooks = new Map();
  globalThis.__dice = [];
  globalThis.__writes = [];
  globalThis.__messageUpdates = [];
  globalThis.__socket = [];
  globalThis.__notes = [];
  globalThis.Hooks = {
    on(n, fn) {
      if (!hooks.has(n)) hooks.set(n, []);
      hooks.get(n).push(fn);
      return fn;
    },
    once(n, fn) {
      return this.on(n, fn);
    },
    off(n, fn) {
      hooks.set(
        n,
        (hooks.get(n) ?? []).filter((f) => f !== fn)
      );
    },
    callAll(n, ...a) {
      for (const fn of hooks.get(n) ?? []) {
        try {
          fn(...a);
        } catch (err) {
          globalThis.__hookErrors?.push(err);
        }
      }
      return true;
    },
    call(n, ...a) {
      for (const fn of hooks.get(n) ?? []) if (fn(...a) === false) return false;
      return true;
    },
    _hooks: hooks
  };
  const userList = users ?? [
    new MockUser({ id: "gm", name: "GM", isGM: true }),
    new MockUser({ id: "p1", name: "Player 1" }),
    new MockUser({ id: "p2", name: "Player 2" })
  ];
  const userColl = new Collection(userList.map((u) => [u.id, u]));
  Object.defineProperty(userColl, "activeGM", { get: () => userList.find((u) => u.isGM && u.active) ?? null });
  const settings = new Map(Object.entries(SETTING_DEFAULTS));
  globalThis.game = {
    system: { id: "sf2e" },
    modules: new Map(),
    user: userList[0],
    users: userColl,
    actors: new Collection(),
    combats: new Collection(),
    messages: new Collection(),
    combat: null,
    time: { worldTime: 0 },
    i18n: {
      lang,
      has: (k) => k in strings,
      localize: (k) => strings[k] ?? k,
      format: (k, d = {}) => fmtStr(strings[k] ?? k, d),
      _strings: strings
    },
    settings: { get: (mod, k) => settings.get(k), set: async (mod, k, v) => settings.set(k, v), register: () => {} },
    socket: { emit: (ev, msg) => globalThis.__socket.push({ ev, msg }), on: () => {} },
    pf2e: {
      Modifier: class {
        constructor(d) {
          Object.assign(this, d);
        }
      }
    }
  };
  globalThis.foundry = {
    utils: {
      deepClone: (o) => (o === undefined ? undefined : structuredClone(o)),
      randomID: (n = 16) =>
        Math.random()
          .toString(36)
          .slice(2, 2 + n)
          .padEnd(n, "0"),
      mergeObject: (a, b) => Object.assign(a, b),
      setProperty,
      getProperty,
      expandObject: (o) => {
        const out = {};
        for (const [k, v] of Object.entries(o)) setProperty(out, k, v);
        return out;
      },
      escapeHTML: (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
      debounce: (fn) => fn
    },
    applications: {
      api: {
        ApplicationV2: class {},
        HandlebarsApplicationMixin: (B) => B,
        DialogV2: { confirm: async () => true, prompt: async () => null }
      }
    }
  };
  globalThis.ChatMessage = MockChatMessage;
  globalThis.Roll = MockRoll;
  globalThis.ui = {
    notifications: {
      info: (m) => globalThis.__notes.push(["info", m]),
      warn: (m) => globalThis.__notes.push(["warn", m]),
      error: (m) => globalThis.__notes.push(["error", m])
    }
  };
  globalThis.canvas = { ready: false, scene: null, tokens: { controlled: [], placeables: [] } };
  globalThis.CONFIG = { Dice: { rolls: [DamageRoll] }, ChatMessage: { modes: {} } };
  const resolve = (uuid) => {
    if (!uuid) return null;
    const m = /^Actor\.([^.]+)$/.exec(uuid);
    if (m) return globalThis.game.actors.get(m[1]) ?? null;
    return globalThis.__extraUuids?.get(uuid) ?? null;
  };
  globalThis.fromUuidSync = resolve;
  globalThis.fromUuid = async (uuid) => resolve(uuid);
  globalThis.__extraUuids = new Map();
  return {
    settings,
    strings,
    setUser: (id) => {
      globalThis.game.user = userColl.get(id);
    }
  };
}

/** Content registry straight from data/*.json (same data the module fetches at runtime). */
export async function loadContentFromDisk() {
  const { Content } = await import("../../scripts/content/loader.mjs");
  const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8"));
  const index = read("index.json");
  Content.stations = new Map(read(index.stations).stations.map((s) => [s.id, s]));
  Content.actions = new Map(read(index.actions).actions.map((a) => [a.id, a]));
  Content.frames = new Map(read(index.frames).frames.map((f) => [f.id, f]));
  Content.weapons = new Map(read(index.weapons).weapons.map((w) => [w.id, w]));
  Content.upgrades = new Map(read(index.upgrades).upgrades.map((u) => [u.id, u]));
  Content.hazards = read(index.hazards).hazards ?? [];
  Content.ships = index.starships.flatMap((f) => read(f).ships);
  Content.loaded = true;
  return Content;
}

/** Build a starship actor carrying module flags. */
export function makeShip({
  id,
  name,
  role = "player",
  stations = [],
  weapons = [],
  crew = [],
  ac = 20,
  sp = 10,
  hp = 30,
  level = 3,
  owners = [],
  effects = [],
  extra = {}
}) {
  const actor = new MockActor({
    id,
    name,
    type: role === "player" ? "vehicle" : "npc",
    owners,
    img: `ships/${id}.webp`,
    system: { attributes: { hp: { value: hp, max: hp } } },
    flags: {
      "sf2e-tactical-starship-combat": {
        starship: {
          isStarship: true,
          dataVersion: 1,
          role,
          level,
          ac,
          fort: 8,
          reflex: 8,
          will: 8,
          perception: 6,
          sensorRange: 6,
          speed: 3,
          sp: { value: sp, max: sp },
          hp: { value: hp, max: hp },
          stations,
          weapons,
          crew,
          effects,
          heading: "right",
          ...extra
        }
      }
    }
  });
  globalThis.game.actors.set(actor.id, actor);
  return actor;
}
export function makeCharacter({ id, name, owners = [], img = `chars/${id}.webp` }) {
  const a = new MockActor({ id, name, type: "character", owners, img });
  globalThis.game.actors.set(a.id, a);
  return a;
}
/** Starship combat with a sensor map. objects: [{key, zone, detection?, type?, name?}] */
export function makeStarshipCombat({ objects = [], round = 1 } = {}) {
  const combat = new MockCombat({
    round,
    flags: {
      "sf2e-tactical-starship-combat": {
        tsc: {
          enabled: true,
          zones: 12,
          orientation: "horizontal",
          objects: objects.map((o) => ({
            type: "starship",
            heading: "right",
            span: 1,
            detection: { party: "observed" },
            actorUuid: o.key,
            name: globalThis.fromUuidSync(o.key)?.name ?? o.key,
            ...o
          })),
          budget: {},
          attacks: {},
          log: [],
          knowledge: {},
          zoneInfo: {},
          hazardState: {},
          compromisedEntries: {},
          contactCounter: 0
        }
      }
    }
  });
  globalThis.game.combats.set(combat.id, combat);
  globalThis.game.combat = combat;
  return combat;
}
