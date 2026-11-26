import { readStarship, writeStarship, isStarship } from "../starship/starship-state.mjs";
import { getTsc, saveTsc } from "../combat/tsc-state.mjs";
import { resolveSensorActor } from "../sensor/map-object.mjs";
import { log } from "../utils/logging.mjs";
import { equalState, snapshot } from "../history/history.mjs";
import { serialize } from "../utils/serial.mjs";

/** Staged changes with per-document conflict guards; a multi-document commit is not atomic. */
export class Draft {
  constructor(combat, { trackCombat = true } = {}) {
    this.combat = combat ?? null;
    this.tsc = combat && trackCombat ? foundry.utils.deepClone(getTsc(combat)) : null;
    this.beforeTsc = this.tsc ? foundry.utils.deepClone(this.tsc) : null;
    this.ships = new Map(); // uuid -> { actor, data }
    this.hazards = new Map(); // uuid -> { actor, patch }
    this.hooks = []; // [name, ...args] fired after a successful commit
    this.auditReason = "";
    this.after = []; // async callbacks run after commit (chat, initiative changes)
  }
  async ship(uuid) {
    if (this.ships.has(uuid)) return this.ships.get(uuid);
    const actor = await resolveSensorActor(this.combat, uuid);
    if (!actor) throw new Error(game.i18n.localize("SF2eTSC.errors.shipNotFound"));
    // commit() writes starship data for every loaded entry, so non-starship actors are refused here
    if (!isStarship(actor)) throw new Error(game.i18n.localize("SF2eTSC.errors.notStarship"));
    const before = foundry.utils.deepClone(readStarship(actor));
    const entry = { actor, before, data: foundry.utils.deepClone(before) };
    this.ships.set(uuid, entry);
    return entry;
  }
  async target(uuid) {
    const actor = await resolveSensorActor(this.combat, uuid);
    if (isStarship(actor)) return this.ship(uuid);
    if (actor?.type !== "hazard") throw new Error(game.i18n.localize("SF2eTSC.errors.notStarship"));
    const attributes = actor.system?.attributes ?? {};
    const hp = foundry.utils.deepClone(attributes.hp ?? { value: 0, max: 0 });
    const stagedDelta = this.hazards.get(actor.uuid)?.hpDelta ?? 0;
    if (stagedDelta) hp.value = Math.max(0, Math.min(hp.max, hp.value + stagedDelta));
    return {
      actor,
      data: {
        name: actor.name,
        heading: null,
        effects: [],
        hp,
        ac: attributes.ac?.value ?? 0,
        hardness: attributes.hardness ?? 0
      }
    };
  }
  event(name, ...args) {
    this.hooks.push([name, ...args]);
  }
  afterCommit(fn) {
    this.after.push(fn);
  }
  log(text, type = "info", data = {}) {
    if (type === "action") this.auditActionReason = text;
    if (!this.tsc || this.privateAction) return;
    this.tsc.log = [...this.tsc.log, { t: Date.now(), round: this.combat?.round ?? 0, text, type, data }].slice(-80);
  }
  async commit() {
    const action = this.auditActionReason;
    const reason = action || this.auditReason || "";
    const undoable = this.allowUndo === true && !this.hazards.size && !action && this.ships.size === 1;
    const changed = [...this.ships.values()].filter(
      ({ before, data, writeOptions }) =>
        !equalState(snapshot(before), snapshot(data)) || Object.keys(writeOptions?.extra ?? {}).length || writeOptions?.force
    );
    // Dialogs/rolls run under per-ship locks, so another ship may commit combat state while we wait.
    // Coordinate the shared combat write here: rebase our tsc delta onto the current state (conflict-aware)
    // and save it BEFORE any ship write, so a combat conflict aborts without partial ship writes.
    await serialize("tsc-commit", async () => {
      if (changed.some(({ actor, before }) => !equalState(snapshot(readStarship(actor)), snapshot(before))))
        throw new Error(game.i18n.localize("SF2eTSC.qol.undoConflict"));
      let baseline = this.beforeTsc;
      let changedTsc = this.combat && this.tsc && !equalState(this.beforeTsc, this.tsc);
      if (changedTsc) {
        const current = getTsc(this.combat);
        if (!equalState(current, this.beforeTsc)) {
          this.tsc = rebaseTsc(this.beforeTsc, this.tsc, current);
          baseline = current;
        }
        changedTsc = !equalState(baseline, this.tsc);
        if (changedTsc) await saveTsc(this.combat, this.tsc, { expected: baseline });
      }
      const writes = [];
      for (const { actor, before, data, writeOptions } of changed)
        writes.push(
          writeStarship(actor, data, {
            expected: snapshot(before),
            ...writeOptions,
            announce: this.privateAction ? false : writeOptions?.announce,
            hullPatch: data.hp,
            reason,
            undoable: undoable && !!this.auditReason
          })
        );
      for (const entry of this.hazards.values()) {
        const actor = (await resolveSensorActor(this.combat, entry.actor.uuid)) ?? entry.actor;
        const patch = { ...entry.patch };
        if (entry.hpDelta) {
          const attributes = actor.system?.attributes ?? {};
          const current = attributes.hp?.value ?? 0;
          const max = attributes.hp?.max ?? current;
          patch["system.attributes.hp.value"] = Math.max(0, Math.min(max, current + entry.hpDelta));
        }
        writes.push(actor.update(patch));
      }
      const results = await Promise.allSettled(writes);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        log.error(
          "draft commit partially failed",
          failed.map((f) => f.reason)
        );
        throw new Error(
          globalThis.game?.i18n?.format?.("SF2eTSC.errors.commitFailed", { count: failed.length }) ??
            `Commit failed (${failed.length}/${results.length} writes)`
        );
      }
    });
    // Hooks/afterCommit run outside the write lock: a callback may itself commit (e.g. a hazard trigger),
    // which would deadlock if the outer commit still held tsc-commit while awaiting it.
    for (const [name, ...args] of this.hooks) Hooks.callAll(name, ...args);
    for (const fn of this.after) {
      try {
        await fn();
      } catch (err) {
        log.error("afterCommit failed", err);
      }
    }
  }
}

const clone = (v) => foundry.utils.deepClone(v);
const conflict = () => new Error(game.i18n.localize("SF2eTSC.qol.undoConflict"));

/**
 * Three-way rebase of a Draft's combat delta onto state committed concurrently by another ship.
 * Untouched keys keep the current value; disjoint edits merge; overlapping edits of the same entity throw.
 */
export function rebaseTsc(base, mine, current) {
  const out = clone(current ?? {});
  for (const k of new Set([...Object.keys(base ?? {}), ...Object.keys(mine ?? {})])) {
    const b = base?.[k],
      m = mine?.[k],
      c = current?.[k];
    if (equalState(m, b)) continue;
    if (k === "log") {
      const added = (m ?? []).filter((e) => !(b ?? []).some((x) => equalState(x, e)));
      out.log = [...(c ?? []), ...added].slice(-80);
      continue;
    }
    if (k === "objects") {
      const bMap = new Map((b ?? []).map((o) => [o.key, o]));
      const mMap = new Map((m ?? []).map((o) => [o.key, o]));
      const cMap = new Map((c ?? []).map((o) => [o.key, o]));
      const objs = (c ?? []).filter((o) => !(bMap.has(o.key) && !mMap.has(o.key)));
      for (const [key, mv] of mMap) {
        const bv = bMap.get(key);
        if (equalState(mv, bv)) continue;
        const cv = cMap.get(key);
        // A concurrent removal of an object we edit is a conflict: restoring it could resurrect a marker
        // whose copied Actor was already deleted.
        if (bv !== undefined && cv === undefined) throw conflict();
        if (cv !== undefined && !equalState(cv, bv)) throw conflict();
        const i = objs.findIndex((o) => o.key === key);
        if (i >= 0) objs[i] = clone(mv);
        else objs.push(clone(mv));
      }
      out.objects = objs;
      continue;
    }
    if (k === "knowledge" || k === "hazardState") {
      const rec = { ...(c ?? {}) };
      for (const sub of new Set([...Object.keys(b ?? {}), ...Object.keys(m ?? {})])) {
        const bv = b?.[sub],
          mv = m?.[sub],
          cv = c?.[sub];
        if (equalState(mv, bv)) {
          if (mv === undefined) delete rec[sub];
          continue;
        }
        if (bv !== undefined && cv === undefined) throw conflict();
        if (cv !== undefined && !equalState(cv, bv)) throw conflict();
        if (mv === undefined) delete rec[sub];
        else rec[sub] = clone(mv);
      }
      out[k] = rec;
      continue;
    }
    if (!equalState(c, b)) throw conflict();
    out[k] = clone(m);
  }
  return out;
}
