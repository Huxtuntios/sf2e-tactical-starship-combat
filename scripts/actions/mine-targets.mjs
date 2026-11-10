import { isStarship } from "../starship/starship-state.mjs";

/** Только список записей карты, а не гарантия наличия всех кораблей мира. */
export async function mappedMineTargets(state, zone, sourceUuid, resolve) {
  if (!state || !Number.isInteger(state.zones) || !Array.isArray(state.objects) || !Number.isInteger(zone)) throw new Error("map");
  const keys = new Set();
  const actors = new Set();
  let source = null;
  const targets = [];
  for (const object of state.objects) {
    if (!object || typeof object.key !== "string" || !object.key || keys.has(object.key)) throw new Error("map");
    keys.add(object.key);
    if (!Number.isInteger(object.zone) || object.zone < 1 || object.zone > state.zones) throw new Error("map");
    if (object.type === "hazard") continue;
    if (object.type !== "starship") throw new Error("map");
    const uuid = object.actorUuid ?? object.key;
    if (typeof uuid !== "string" || !uuid || actors.has(uuid)) throw new Error("map");
    actors.add(uuid);
    if (object.key === sourceUuid || uuid === sourceUuid) {
      if (object.key !== sourceUuid || uuid !== sourceUuid || source) throw new Error("map");
      source = object;
    }
    if (object.zone !== zone) continue;
    const actor = await resolve(uuid);
    if (
      !actor ||
      actor.uuid !== uuid ||
      actor.documentName !== "Actor" ||
      !isStarship(actor) ||
      typeof actor.name !== "string" ||
      !actor.name
    )
      throw new Error("map");
    targets.push({ key: object.key, uuid, name: actor.name });
  }
  if (!source) throw new Error("map");
  targets.sort((a, b) => a.key.localeCompare(b.key));
  return { shipZone: source.zone, targets };
}

/** Снимки целей нужны только для обнаружения изменений, не для записи или передачи данных игрокам. */
export async function targetSnapshots(targets, resolve) {
  const snapshots = [];
  for (const target of targets) {
    const actor = await resolve(target.uuid);
    if (!actor || actor.uuid !== target.uuid || !isStarship(actor)) throw new Error("target");
    snapshots.push({
      uuid: target.uuid,
      data: typeof actor.toObject === "function" ? actor.toObject() : { system: actor.system, flags: actor.flags }
    });
  }
  return snapshots;
}
