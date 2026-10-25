import { readStarship, writeStarship, isStarship } from "../starship/starship-state.mjs";
import { getTsc, saveTsc } from "../combat/tsc-state.mjs";
import { fromUuidSafe } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";

/**
 * Transaction draft. All rule effects mutate clones; nothing is written until commit(), so an action can never be
 * "spent but not applied" or "applied but not spent": cost, frequency, effects, movement and log are one write set.
 */
export class Draft {
  constructor(combat, { trackCombat = true } = {}) {
    this.combat = combat ?? null;
    this.tsc = combat && trackCombat ? foundry.utils.deepClone(getTsc(combat)) : null;
    this.ships = new Map(); // uuid -> { actor, data }
    this.hazards = new Map(); // uuid -> { actor, patch }
    this.hooks = []; // [name, ...args] fired after a successful commit
    this.auditReason = "";
    this.after = []; // async callbacks run after commit (chat, initiative changes)
  }
  async ship(uuid) {
    if (this.ships.has(uuid)) return this.ships.get(uuid);
    const actor = await fromUuidSafe(uuid);
    if (!actor) throw new Error(game.i18n.localize("SF2eTSC.errors.shipNotFound"));
    // commit() writes starship data for every loaded entry, so non-starship actors are refused here
    if (!isStarship(actor)) throw new Error(game.i18n.localize("SF2eTSC.errors.notStarship"));
    const entry = { actor, data: foundry.utils.deepClone(readStarship(actor)) };
    this.ships.set(uuid, entry);
    return entry;
  }
  event(name, ...args) {
    this.hooks.push([name, ...args]);
  }
  afterCommit(fn) {
    this.after.push(fn);
  }
  log(text, type = "info", data = {}) {
    if (type === "action") this.auditActionReason = text;
    if (!this.tsc) return;
    this.tsc.log = [...this.tsc.log, { t: Date.now(), round: this.combat?.round ?? 0, text, type, data }].slice(-80);
  }
  async commit() {
    const writes = [];
    const action = this.auditActionReason;
    const reason = action || this.auditReason || "";
    const undoable = this.allowUndo === true && !this.hazards.size && !action && this.ships.size === 1;
    // Внутренние writeOptions позволяют атомарно сохранить метку применения вместе с уроном.
    for (const { actor, data, writeOptions } of this.ships.values())
      writes.push(writeStarship(actor, data, { ...writeOptions, hullPatch: data.hp, reason, undoable: undoable && !!this.auditReason }));
    if (this.combat && this.tsc) writes.push(saveTsc(this.combat, this.tsc));
    for (const { actor, patch } of this.hazards.values()) writes.push(actor.update(patch));
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
