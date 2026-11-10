import { MODULE_ID, HOOK_EVENTS } from "../constants.mjs";
import { planCrewCombatants } from "../engine/crew-initiative.mjs";
import { readStarship, isPlayerStarship } from "../starship/starship-state.mjs";
import { activeStarshipCombat, getTsc, isStarshipCombat } from "./tsc-state.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { registerHandler } from "../socket.mjs";
import { moduleSetting, isActiveGM, T, fromUuidSync_ } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";

/** Plain view of combatants for the pure planner. */
export function combatantViews(combat) {
  return (combat?.combatants?.contents ?? [...(combat?.combatants ?? [])]).map((c) => ({
    id: c.id,
    actorId: c.actorId ?? null,
    actorUuid: c.actor?.uuid ?? null,
    tokenId: c.tokenId ?? null,
    tokenIsSynthetic: !!c.actor?.isToken,
    special: !!(c.flags?.[MODULE_ID]?.compromisedEntry || c.flags?.[MODULE_ID]?.playerShip)
  }));
}
function resolveActor(uuid) {
  const a = fromUuidSync_(uuid);
  if (!a || a.documentName !== "Actor") return null;
  return { id: a.id, uuid: a.uuid, name: a.name, isToken: !!a.isToken, tokenId: a.token?.id ?? null };
}
/** Player ships that take part in this starship combat (placed on the sensor map). */
export function participatingPlayerShips(combat) {
  const tsc = getTsc(combat);
  return game.actors
    .filter((a) => isPlayerStarship(a) && findObject(tsc, a.uuid))
    .concat(
      tsc.objects
        .filter((o) => o.type === "starship" && o.actorUuid?.includes(".Token."))
        .map((o) => fromUuidSync_(o.actorUuid))
        .filter((a) => a && isPlayerStarship(a))
    );
}

/**
 * Idempotent: make sure every (non-observer) crew member of the given player ships has exactly one Combatant.
 * Never removes or re-rolls existing combatants; keeps the current turn on the same combatant.
 * Usable at combat start, when crew is added mid-combat, and as a manual repair (API / tracker button).
 * @returns {Promise<{created:string[], existing:string[], missing:string[], excluded:string[]}>}
 */
export async function syncCrewCombatants(
  combat,
  shipUuids = null,
  { exclude = [], extra = [], scope = moduleSetting("crewInitiativeScope"), notify = true } = {}
) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  combat = combat?.id ? game.combats.get(combat.id) : null;
  if (!combat) throw new Error(T("SF2eTSC.errors.combatMissing"));
  const ships = (shipUuids ? shipUuids.map((u) => fromUuidSync_(u)).filter(Boolean) : participatingPlayerShips(combat)).map((s) => ({
    uuid: s.uuid,
    name: s.name,
    crew: readStarship(s).crew
  }));
  const plan = planCrewCombatants({ ships, combatants: combatantViews(combat), resolve: resolveActor, scope, exclude, extra });
  if (plan.create.length) {
    const scene = combat.scene ?? canvas?.scene ?? null;
    const docs = plan.create.map((p) => {
      const actor = fromUuidSync_(p.actorUuid);
      let tokenId = p.tokenId,
        sceneId = tokenId ? (actor?.token?.parent?.id ?? null) : null;
      if (!tokenId && scene) {
        const tok = scene.tokens?.find?.((t) => t.actorId === p.actorId && t.actorLink);
        if (tok) {
          tokenId = tok.id;
          sceneId = scene.id;
        }
      }
      return { actorId: p.actorId, tokenId: tokenId ?? null, sceneId: sceneId ?? null, flags: { [MODULE_ID]: { crewOf: p.shipUuid } } };
    });
    const current = combat.combatant?.id ?? null;
    await combat.createEmbeddedDocuments("Combatant", docs);
    // keep the active turn on the same combatant (new entries without initiative sort last, but be defensive)
    if (current && combat.started) {
      const idx = combat.turns.findIndex((c) => c.id === current);
      if (idx >= 0 && idx !== combat.turn) await combat.update({ turn: idx });
    }
  }
  const res = {
    created: plan.create.map((p) => p.name),
    existing: plan.existing.map((p) => p.name),
    missing: plan.missing.map((p) => `${p.name}${p.shipName ? ` (${p.shipName})` : ""}`),
    excluded: plan.excluded.map((p) => p.name)
  };
  if (notify) {
    if (res.missing.length) ui.notifications.warn(T("SF2eTSC.initiative.missingCrew", { names: res.missing.join(", ") }));
    if (res.created.length && combat.started)
      ui.notifications.info(T("SF2eTSC.initiative.crewAddedMidCombat", { names: res.created.join(", ") }));
  }
  if (res.missing.length) log.warn("crew sync: missing actors", res.missing);
  return res;
}

/** GM: crew added to a ship that is already in an active starship combat joins initiative automatically. */
export function registerCrewSyncHooks() {
  Hooks.on(HOOK_EVENTS.crewChanged, (ship) => {
    if (!isActiveGM() || !ship || !isPlayerStarship(ship)) return;
    if (moduleSetting("crewInitiativeScope") === "off") return;
    const combat = activeStarshipCombat();
    if (!combat || !isStarshipCombat(combat)) return;
    if (!findObject(getTsc(combat), ship.uuid)) return;
    syncCrewCombatants(combat, [ship.uuid]).catch((err) => log.error("crew sync failed", err));
  });
  Hooks.on(HOOK_EVENTS.stationClaimed, (ship) => {
    if (!isActiveGM() || moduleSetting("crewInitiativeScope") !== "stationed") return;
    const combat = activeStarshipCombat();
    if (!combat || !findObject(getTsc(combat), ship.uuid)) return;
    syncCrewCombatants(combat, [ship.uuid]).catch((err) => log.error("crew sync failed", err));
  });
  registerHandler("syncCrewCombatants", async ({ user, payload }) => {
    if (!user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
    return syncCrewCombatants(game.combats.get(payload?.combatId) ?? activeStarshipCombat(), payload?.shipUuids ?? null);
  });
}
