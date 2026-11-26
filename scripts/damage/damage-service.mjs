import { HOOK_EVENTS } from "../constants.mjs";
import { computeStarshipDamage, normalizeIwr } from "../engine/damage.mjs";
import { computeStarshipDamagePacket } from "../engine/damage-packet.mjs";
import { STARSHIP_IMMUNITIES } from "../engine/validation.mjs";
import { postDamageCard } from "../chat/chat-cards.mjs";
import { Initiative } from "../combat/initiative.mjs";
import { privateContacts } from "../sensor/private-contacts.mjs";
import { effectiveEffectStates } from "../starship/effects.mjs";

/** StarshipDamageEngine (Foundry layer): applies the pure damage computation to a draft and queues chat/events. */
export async function applyDamageInDraft(
  draft,
  shipUuid,
  {
    amount,
    parts = null,
    damageType = "untyped",
    strikeResistance = 0,
    traits = [],
    criticalHit = false,
    nonlethal = false,
    source = null,
    attackLine = null,
    silent = false,
    undoRef = null,
    persistentParts = null,
    persistentSource = null
  }
) {
  draft.auditReason = source || attackLine || damageType;
  const entry = await draft.target(shipUuid);
  const privateTarget = !!draft.combat && privateContacts(draft.combat.id).some((contact) => contact.actorUuid === shipUuid);
  if (privateTarget) draft.privateAction = true;
  if (entry.actor.type === "hazard")
    return applyHazardDamageInDraft(draft, entry, {
      amount,
      parts,
      damageType,
      strikeResistance,
      traits,
      criticalHit,
      nonlethal,
      source,
      attackLine,
      silent,
      undoRef,
      privateTarget
    });
  const d = entry.data;
  if (persistentParts?.length) {
    const { stagePersistentDamage } = await import("../starship/persistent-damage.mjs");
    await stagePersistentDamage(draft, {
      targetUuid: shipUuid,
      parts: persistentParts,
      source: persistentSource ?? { label: source, strikeId: d.appliedStrikeReceipts?.at(-1) },
      criticalHit
    });
  }
  // module IWR (ship editor) + the actor's own system IWR (sf2e attributes), all normalised to system damage slugs
  const sysAttr = entry.actor?.system?.attributes ?? {};
  const immunities = [
    ...new Set([
      ...normalizeIwr(d.immunities, false),
      ...normalizeIwr(sysAttr.immunities, false),
      ...(d.role === "player" || !(d.immunities ?? []).length ? STARSHIP_IMMUNITIES : [])
    ])
  ];
  const mergeMax = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b)) o[k] = Math.max(o[k] ?? 0, v);
    return o;
  };
  const resistances = mergeMax(mergeMax(normalizeIwr(d.resistances), normalizeIwr(sysAttr.resistances)), {
    "all-damage": Math.max(0, strikeResistance)
  });
  const weaknesses = mergeMax(normalizeIwr(d.weaknesses), normalizeIwr(sysAttr.weaknesses));
  const effective = effectiveEffectStates(d, { actor: entry.actor });
  const compute = parts ? computeStarshipDamagePacket : computeStarshipDamage;
  const result = compute({
    state: {
      hp: d.hp.value,
      sp: d.sp.value,
      isPlayer: d.role === "player",
      compromised: effective.compromised,
      wrecked: effective.wrecked,
      inoperable: effective.inoperable,
      destroyed: effective.destroyed,
      hardness: d.hardness ?? 0,
      immunities,
      resistances,
      weaknesses
    },
    amount,
    parts,
    damageType,
    traits,
    criticalHit,
    nonlethal
  });
  const ns = result.newState;
  d.hp.value = ns.hp;
  d.sp.value = ns.sp;
  if (ns.compromised !== effective.compromised) d.compromised = ns.compromised;
  if (ns.wrecked !== effective.wrecked) d.wrecked = ns.wrecked;
  if (ns.inoperable !== effective.inoperable || result.becameInoperable || result.compromisedIncrease > 0) d.inoperable = ns.inoperable;
  if (ns.destroyed !== effective.destroyed) d.destroyed = ns.destroyed;
  if (result.stationsMalfunctioned) for (const st of d.stations) st.malfunctioning = true;
  const actor = entry.actor;
  draft.log(`${actor.name}: SP -${result.shieldDamage}, HP -${result.hullDamage}`, "damage", { shipUuid, ...result });
  draft.event(HOOK_EVENTS.damaged, actor, result);
  if (result.stationsMalfunctioned)
    draft.event(
      HOOK_EVENTS.stationMalfunctioned,
      actor,
      d.stations.filter((s) => s.malfunctioning)
    );
  if (result.becameCompromised) {
    draft.event(HOOK_EVENTS.compromised, actor, ns.compromised);
    if (draft.combat) draft.afterCommit(() => Initiative.enterCompromised(draft.combat, actor));
  }
  if (result.destroyed) draft.event(HOOK_EVENTS.destroyed, actor);
  if (!silent && !privateTarget)
    draft.afterCommit(() =>
      postDamageCard({
        actor,
        source,
        whisperGM: !!draft.privateAction,
        result,
        attackLine,
        undoRef,
        targetUUIDs: [shipUuid],
        damageType: parts?.length === 1 ? parts[0].type : damageType,
        parts
      })
    );
  return result;
}

async function applyHazardDamageInDraft(
  draft,
  entry,
  { amount, parts, damageType, strikeResistance, traits, criticalHit, nonlethal, source, attackLine, silent, undoRef, privateTarget }
) {
  const actor = entry.actor;
  const attributes = actor.system?.attributes ?? {};
  const immunities = normalizeIwr(attributes.immunities, false);
  const resistances = {
    ...normalizeIwr(attributes.resistances),
    "all-damage": Math.max(normalizeIwr(attributes.resistances)["all-damage"] ?? 0, strikeResistance)
  };
  const weaknesses = normalizeIwr(attributes.weaknesses);
  const compute = parts ? computeStarshipDamagePacket : computeStarshipDamage;
  const result = compute({
    state: {
      hp: entry.data.hp.value,
      sp: 0,
      isPlayer: false,
      hardness: entry.data.hardness ?? 0,
      immunities,
      resistances,
      weaknesses
    },
    amount,
    parts,
    damageType,
    traits,
    criticalHit,
    nonlethal
  });
  if (result.newState.hp !== entry.data.hp.value) {
    const previous = draft.hazards.get(actor.uuid);
    draft.hazards.set(actor.uuid, {
      actor,
      patch: { ...(previous?.patch ?? {}), "system.attributes.hp.value": result.newState.hp },
      hpDelta: (previous?.hpDelta ?? 0) + result.newState.hp - entry.data.hp.value
    });
  }
  draft.log(`${actor.name}: HP -${result.hullDamage}`, "damage", { shipUuid: actor.uuid, ...result });
  draft.event(HOOK_EVENTS.damaged, actor, result);
  if (result.destroyed) draft.event(HOOK_EVENTS.destroyed, actor);
  if (!silent && !privateTarget)
    draft.afterCommit(() =>
      postDamageCard({
        actor,
        source,
        whisperGM: !!draft.privateAction,
        result,
        attackLine,
        undoRef,
        targetUUIDs: [actor.uuid],
        damageType: parts?.length === 1 ? parts[0].type : damageType,
        parts
      })
    );
  return result;
}
