/**
 * Attack card: pure data rules (no Foundry globals at import or call time unless a resolver is passed).
 * Everything here is unit-tested without Foundry.
 */
import { effectiveDetection } from "../../engine/sensor-ops.mjs";
import { canControlCrewActor } from "../../crew/permissions.mjs";

export const CARD_FLAG = "attackCard";
export const ATTACK_BUILTINS = ["strike", "npc-strike", "spell-attack"];
export const isCardAttack = (action) => ATTACK_BUILTINS.includes(action?.builtin) && action?.targeting?.type === "starship";
export const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

/** Label of a sensor object for players (identity only when identified). */
export function publicLabel(obj, shipKey) {
  if (obj.alwaysVisible || obj.key === shipKey) return { label: obj.name, known: true };
  const level = effectiveDetection(obj, [shipKey]);
  if (level === "identified") return { label: obj.name, known: true };
  return { label: obj.designation ?? null, known: false };
}

/** May `user` resolve / cancel / roll damage for this card? `canControl` is injectable for tests. */
export function mayResolveCard(user, card, crewActor, canControl = canControlCrewActor) {
  if (user?.isGM) return true;
  if (!user) return false;
  if (card.createdBy === user.id) return true;
  return !!crewActor && canControl(user, crewActor);
}

/** The request stored on the card (target and GM override are chosen at resolution time). */
export function cardRequest(req) {
  return {
    shipUuid: req.shipUuid,
    actionId: req.actionId,
    crewUuid: req.crewUuid,
    stationId: req.stationId,
    options: (({ targetKey, gmOverride, ...o }) => o)(req.options)
  };
}

/** MAP block of the card from the engine's map state. */
export function cardMapInfo(ms, mapFor) {
  return ms
    ? {
        enabled: true,
        current: ms.current,
        choice: String(ms.manualIndex ?? 0),
        profile: { map1: mapFor(1, ms.profile), map2: mapFor(2, ms.profile) },
        label: ms.profile?.label,
        manual: true
      }
    : { enabled: false };
}

/** Targets players may see; identity only when identified. */
export function playerTargets(candidates) {
  return candidates
    .filter((c) => c.playerVisible)
    .map(({ gmName, playerVisible, actorUuid, ...rest }) => ({ ...rest, label: rest.known ? gmName : rest.label }));
}

/** MAP choice for a resolution request: client choice if valid, else the one stored on the card. */
export function pickMapChoice(payload, card, MAP_CHOICES) {
  return MAP_CHOICES.includes(String(payload?.mapChoice)) ? String(payload.mapChoice) : (card.request.options?.mapChoice ?? "0");
}

/** A card may start resolving only once: open status and not locked in memory. */
export function canStartResolve(card, locked) {
  return !locked && card?.status === "open";
}
