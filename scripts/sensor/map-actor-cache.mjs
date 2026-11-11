import { fromUuidSafe } from "../utils/foundry.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { computeShipStats } from "../starship/stats.mjs";
import { safeImagePath } from "./appearance.mjs";

const permitted = (actor, user) => !!actor && (user?.isGM || actor.testUserPermission?.(user, "OBSERVER") === true);
const validUuid = (uuid) => typeof uuid === "string" && uuid.trim().length > 0;

/** Read-only, per-window cache. Only UUIDs from the redacted known view may enter it. */
export class MapActorCache {
  constructor({ resolve = fromUuidSafe, read = readStarship, stats = computeShipStats, ship = isStarship } = {}) {
    this.resolve = resolve;
    this.read = read;
    this.compute = stats;
    this.isShip = ship;
    this.entries = new Map();
    this.active = new Set();
  }

  setVisible(view, user) {
    const scope = `${user?.id}:${user?.isGM}:${user?.role}`;
    if (this.scope !== scope) this.clear();
    this.scope = scope;
    this.user = user;
    this.active = new Set(
      view
        .filter((o) => o.known && ["starship", "hazard"].includes(o.type))
        .map((o) => o.actorUuid ?? o.key)
        .filter(validUuid)
    );
    for (const [uuid, entry] of this.entries) {
      if (!this.active.has(uuid) || (entry.actor && !permitted(entry.actor, user))) this.entries.delete(uuid);
    }
  }

  async get(uuid) {
    if (!this.active.has(uuid)) return null;
    let entry = this.entries.get(uuid);
    if (entry?.actor && !permitted(entry.actor, this.user)) {
      this.entries.delete(uuid);
      entry = null;
    }
    if (entry) return entry.promise;
    entry = { uuid, actor: null, data: undefined, stats: undefined };
    this.entries.set(uuid, entry);
    // Install the entry before resolving: duplicates and concurrent renders share the promise.
    entry.promise = Promise.resolve().then(async () => {
      let actor;
      try {
        actor = await this.resolve(uuid);
      } catch {
        actor = null;
      }
      if (this.entries.get(uuid) !== entry || !this.active.has(uuid)) return null;
      if (!permitted(actor, this.user)) {
        this.entries.delete(uuid); // missing/denied documents are retried on the next render
        return null;
      }
      entry.actor = actor;
      return entry;
    });
    return entry.promise;
  }

  current(entry) {
    return !!entry?.actor && this.entries.get(entry.uuid) === entry && permitted(entry.actor, this.user);
  }

  artwork(entry) {
    if (!this.current(entry)) return "";
    return (entry.artwork ??= safeImagePath(entry.actor.img) || safeImagePath(entry.actor.prototypeToken?.texture?.src));
  }

  data(entry) {
    if (!this.current(entry) || !this.isShip(entry.actor)) return null;
    return (entry.data ??= this.read(entry.actor));
  }

  stats(entry) {
    if (!this.data(entry)) return null;
    return (entry.stats ??= this.compute(entry.actor));
  }

  /** Evict the changed world/compendium/synthetic actor, and derived statistics depending on its crew. */
  invalidate(actor = null) {
    if (!actor) return this.clear();
    for (const [uuid, entry] of this.entries) {
      // Pending aliases (e.g. linked Token.Actor -> world Actor) have not revealed their identity yet.
      if (!entry.actor || uuid === actor.uuid || entry.actor === actor || (actor.uuid && entry.actor?.uuid === actor.uuid))
        this.entries.delete(uuid);
      else if (entry.data?.stations?.some((s) => s.helmedBy === actor.uuid) || entry.data?.crew?.some((c) => c.actorUuid === actor.uuid))
        entry.stats = undefined;
    }
  }

  clear() {
    this.entries.clear(); // identity checks prevent stale promises from repopulating
  }

  dispose() {
    this.clear();
    this.active.clear();
    this.user = null;
  }
}
