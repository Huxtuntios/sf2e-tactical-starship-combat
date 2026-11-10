/**
 * @param {object} p
 * @param {Array<{uuid:string,name:string,crew:Array<{actorUuid:string,name?:string,role?:string,stationId?:string|null}>}>} p.ships
 * @param {Array<{id:string,actorId:string|null,actorUuid:string|null,tokenId:string|null,special?:boolean}>} p.combatants existing
 * @param {(uuid:string)=>({id:string,uuid:string,name:string,isToken?:boolean,tokenId?:string|null}|null)} p.resolve
 * @param {string} [p.scope]
 * @param {string[]} [p.exclude] actor uuids deselected in the wizard
 * @param {string[]} [p.extra]   additional actor uuids (non-crew characters picked in the wizard)
 * @returns {{create:object[], existing:object[], missing:object[], excluded:object[]}}
 */
export function planCrewCombatants({ ships = [], combatants = [], resolve, scope = "crew", exclude = [], extra = [] }) {
  const out = { create: [], existing: [], missing: [], excluded: [] };
  if (scope === "off") return out;
  const excluded = new Set(exclude);
  const planned = new Set();
  const consider = (actorUuid, info) => {
    if (planned.has(actorUuid)) return; // same character on two ships / listed twice
    planned.add(actorUuid);
    if (excluded.has(actorUuid)) {
      out.excluded.push(info);
      return;
    }
    const actor = resolve(actorUuid);
    if (!actor) {
      out.missing.push(info);
      return;
    }
    const match = findCombatantFor(combatants, actor);
    if (match) {
      out.existing.push({ ...info, combatantId: match.id });
      return;
    }
    out.create.push({
      ...info,
      actorUuid: actor.uuid,
      actorId: actor.id,
      tokenId: actor.isToken ? (actor.tokenId ?? null) : null,
      name: actor.name
    });
  };
  for (const ship of ships) {
    for (const c of ship.crew ?? []) {
      if (!c?.actorUuid || c.role === "observer") continue;
      if (scope === "stationed" && !c.stationId) continue;
      consider(c.actorUuid, {
        actorUuid: c.actorUuid,
        name: c.name ?? "?",
        shipUuid: ship.uuid,
        shipName: ship.name,
        stationed: !!c.stationId
      });
    }
  }
  for (const uuid of extra)
    consider(uuid, { actorUuid: uuid, name: resolve(uuid)?.name ?? "?", shipUuid: null, shipName: null, stationed: false });
  return out;
}

/**
 * The combatant representing an actor. Exact actor UUID wins (token actors); a linked actor also matches by actor
 * id. Module-specific entries (compromised ship entry, optional player-ship combatant) never stand in for crew.
 */
export function findCombatantFor(combatants, actor) {
  if (!actor) return null;
  let byId = null;
  for (const c of combatants) {
    if (c.special) continue;
    if (c.actorUuid && c.actorUuid === actor.uuid) return c;
    if (!actor.isToken && !byId && c.actorId === actor.id && !c.tokenIsSynthetic) byId = c;
  }
  return byId;
}
