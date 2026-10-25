import { rollTypedDamage, typedDamageFormula } from "../../rolls/typed-damage.mjs";
/**
 * Attack card: GM-side flow. declareAttack → (card buttons | Sensor Map pick) → resolveAttackCard → damage.
 * All writes happen here, on the GM, through the socket handlers registered in client.mjs.
 */
import { MODULE_ID } from "../../constants.mjs";
import { executeAction, sanitizeActionRequest, targetRuleInput } from "../../actions/action-engine.mjs";
import { computeAttackModifiers, knownAttackBonus } from "../../actions/strike.mjs";
import { evaluateTargets, visibleToPlayers } from "../../engine/target-rules.mjs";
import { findObject } from "../../engine/sensor-ops.mjs";
import { readStarship, isStarship } from "../../starship/starship-state.mjs";
import { bestSpellStatistic } from "../../starship/stats.mjs";
import { activeStarshipCombat, getTsc } from "../../combat/tsc-state.mjs";
import { turnKey } from "../../engine/cost.mjs";
import { MAP_CHOICES, mapFor } from "../../engine/map.mjs";
import { T, fromUuidSafe, fromUuidSync_ } from "../../utils/foundry.mjs";
import { portraitOf } from "../../crew/occupant.mjs";
import { log } from "../../utils/logging.mjs";
import { Draft } from "../../actions/draft.mjs";
import { applyDamageInDraft } from "../../damage/damage-service.mjs";
import { ct } from "../../content/content-i18n.mjs";
import {
  CARD_FLAG,
  isCardAttack,
  publicLabel,
  mayResolveCard,
  cardRequest,
  cardMapInfo,
  playerTargets,
  pickMapChoice,
  canStartResolve
} from "./model.mjs";
import { renderAttackCard, renderDiag } from "./render.mjs";

const resolving = new Set();
const dmgType = (t) => (t && game.i18n.has(`SF2eTSC.damageTypes.${t}`) ? T(`SF2eTSC.damageTypes.${t}`) : (t ?? ""));

export async function declareAttack({ user, payload }) {
  const req = sanitizeActionRequest(payload, user);
  const dry = await executeAction({ ...req, options: { ...req.options }, user, userId: user.id, dryRun: true });
  const ctx = dry.ctx;
  if (!isCardAttack(ctx.action)) throw new Error(T("SF2eTSC.attackCard.notAnAttack"));
  const spell = ctx.action.builtin === "spell-attack";
  const weapon = spell ? { name: ctx.action.name, traits: ["spell"], range: null } : ctx.weapon;
  if (!weapon) throw new Error(T("SF2eTSC.errors.noWeapon"));
  const rules = targetRuleInput(ctx);
  const tsc = ctx.tsc;
  const me = findObject(tsc, ctx.shipUuid);
  const candidates = evaluateTargets(rules).map(({ obj, ev }) => {
    const out = {
      key: obj.key,
      actorUuid: obj.actorUuid ?? obj.key,
      zone: obj.zone,
      distance: ev.distance,
      available: ev.available,
      reason: ev.reason,
      warning: ev.warning ?? null,
      level: ev.level,
      gmName: obj.name,
      playerVisible: visibleToPlayers(obj, ctx.shipUuid),
      ...publicLabel(obj, ctx.shipUuid)
    };
    if (ev.available) {
      const actor = fromUuidSync_(out.actorUuid);
      if (actor && isStarship(actor)) {
        try {
          const pre = computeAttackModifiers(ctx, weapon, { key: obj.key, actor, data: readStarship(actor) });
          out.ac = pre.ac;
          out.baseAC = pre.baseAC;
          out.acMods = pre.acMods.map((m) => ({ label: m.label, value: m.value }));
          out.behind = pre.behind;
          out.mods = pre.mods.map((m) => ({ label: m.label, value: m.value }));
        } catch (err) {
          log.debug("attack preview failed", err);
        }
      }
    }
    return out;
  });
  let bonus;
  if (spell) {
    const st = bestSpellStatistic(ctx.crew);
    const v = st?.check?.mod ?? st?.mod;
    bonus = Number.isFinite(v) ? { value: v, source: "spell" } : null;
  } else bonus = knownAttackBonus(ctx, weapon);
  const ms = ctx.mapState ?? null;
  const shipObj = me ?? { key: ctx.shipUuid, name: ctx.ship.name, alwaysVisible: ctx.data.role === "player" };
  const attackerPublic = ctx.data.role === "player" ? { label: ctx.ship.name, known: true } : publicLabel(shipObj, "party");
  const card = {
    v: 1,
    status: "open",
    createdBy: user.id,
    combatId: ctx.combat?.id ?? null,
    turnKey: ctx.combat ? turnKey(ctx.combat) : null,
    request: cardRequest(req),
    ship: { uuid: ctx.ship.uuid, name: ctx.ship.name, publicName: attackerPublic.label, img: ctx.ship.img, role: ctx.data.role },
    crew: ctx.crew ? { uuid: ctx.crew.uuid, name: ctx.crew.name, img: portraitOf(ctx.crew) } : null,
    station: ctx.station ? { id: ctx.station.id, name: ctx.station.name, type: ctx.station.type } : null,
    action: { id: ctx.action.id, name: ctx.action.name, builtin: ctx.action.builtin, cost: dry.costValue },
    weapon: {
      name: weapon.name,
      traits: (weapon.traits ?? []).map(String),
      damage: weapon.npc
        ? weapon.formula
        : weapon.die
          ? `${weapon.die}${ctx.stationRow?.damageDice > 1 ? ` ×${ctx.stationRow.damageDice}` : ""}`
          : null,
      damageType: weapon.damageType ?? null
    },
    attackType: spell ? "spell" : weapon.npc ? (ctx.options.npcStrike?.kind === "melee" ? "melee" : "ranged") : "ranged",
    range: { zones: rules.range, increment: rules.rangeIncrement, fromZone: me?.zone ?? null },
    bonus,
    map: cardMapInfo(ms, mapFor),
    sheetRoll: req.options.sheetRoll === true,
    commonMods: (candidates.find((c) => c.mods)?.mods ?? []).filter((m) => m.value !== 0),
    targets: playerTargets(candidates),
    result: null,
    error: null
  };
  const publicCard = ctx.data.role === "player" || attackerPublic.label != null;
  const speaker = ctx.crew ? ChatMessage.getSpeaker({ actor: ctx.crew }) : ChatMessage.getSpeaker({ actor: ctx.ship });
  if (!publicCard || !attackerPublic.known) speaker.alias = attackerPublic.label ?? T("SF2eTSC.attackCard.unknownAttacker");
  const gmIds = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  const msg = await ChatMessage.create({
    speaker,
    content: renderAttackCard({ id: null, flags: { [MODULE_ID]: { [CARD_FLAG]: card } } }),
    whisper: publicCard ? [] : gmIds,
    flags: { [MODULE_ID]: { card: true, [CARD_FLAG]: card } }
  });
  // GM diagnostics: every candidate including hidden / undetected ones and why they are (un)available
  const diag = candidates.filter((c) => !c.available || !c.playerVisible);
  if (diag.length) {
    await ChatMessage.create({
      whisper: gmIds,
      speaker: { alias: T("SF2eTSC.attackCard.diagTitle") },
      flags: {
        [MODULE_ID]: {
          card: true,
          attackDiag: {
            messageId: msg.id,
            ship: ctx.ship.name,
            rows: diag.map((c) => ({
              name: c.gmName,
              zone: c.zone,
              distance: c.distance,
              reason: c.reason,
              available: c.available,
              playerVisible: c.playerVisible
            }))
          }
        }
      },
      content: renderDiag({
        ship: ctx.ship.name,
        rows: diag.map((c) => ({
          name: c.gmName,
          zone: c.zone,
          distance: c.distance,
          reason: c.reason,
          available: c.available,
          playerVisible: c.playerVisible
        }))
      })
    });
  }
  return { messageId: msg.id, targets: card.targets.filter((t) => t.available).map((t) => t.key) };
}

export async function resolveAttackCard({ user, payload }) {
  const message = game.messages.get(String(payload?.messageId ?? ""));
  const card = message?.flags?.[MODULE_ID]?.[CARD_FLAG];
  if (!card) throw new Error(T("SF2eTSC.attackCard.notFound"));
  const crewActor = card.request.crewUuid ? await fromUuidSafe(card.request.crewUuid) : null;
  if (!mayResolveCard(user, card, crewActor)) throw new Error(T("SF2eTSC.errors.noPermission"));
  if (payload?.cancel) {
    if (card.status !== "open") throw new Error(T("SF2eTSC.attackCard.alreadyResolved"));
    await updateCard(message, { status: "void", error: T("SF2eTSC.attackCard.cancelled") });
    return { ok: true, cancelled: true };
  }
  // lock check is synchronous before the first await: a second request for the same card is refused immediately
  if (!canStartResolve(card, resolving.has(message.id))) throw new Error(T("SF2eTSC.attackCard.alreadyResolved"));
  const combat = activeStarshipCombat();
  if (card.combatId && (!combat || combat.id !== card.combatId)) {
    await updateCard(message, { status: "void", error: T("SF2eTSC.attackCard.stale") });
    throw new Error(T("SF2eTSC.attackCard.stale"));
  }
  const targetKey = typeof payload?.targetKey === "string" ? payload.targetKey : null;
  if (!targetKey) throw new Error(T("SF2eTSC.errors.needTarget"));
  resolving.add(message.id);
  try {
    await updateCard(message, { status: "resolving" });
    const mapChoice = pickMapChoice(payload, card, MAP_CHOICES);
    const params = {
      ...card.request,
      options: { ...card.request.options, targetKey, mapChoice, gmOverride: user.isGM && payload?.gmOverride === true }
    };
    const req = sanitizeActionRequest(params, user);
    let res;
    try {
      res = await executeAction({ ...req, user, userId: user.id, cardMode: true });
    } catch (err) {
      await updateCard(message, { status: "open", error: err.message });
      throw err;
    }
    const tsc = combat ? getTsc(game.combats.get(combat.id)) : null;
    const tobj = tsc ? findObject(tsc, targetKey) : null;
    const tl = tobj ? publicLabel(tobj, card.ship.uuid) : { label: res.summary?.targetName };
    await updateCard(message, {
      status: "resolved",
      error: null,
      result: { ...res.summary, targetKey, targetLabel: tl.known ? (tobj?.name ?? res.summary?.targetName) : tl.label, resolvedBy: user.id }
    });
    return { ok: true, degree: res.degree };
  } finally {
    resolving.delete(message.id);
  }
}

/* ----------------------------------------------------------------------------------------- GM: damage (sheet rolls) */
const damaging = new Set();
function pendingCard(payload) {
  const message = game.messages.get(String(payload?.messageId ?? ""));
  const card = message?.flags?.[MODULE_ID]?.[CARD_FLAG];
  if (!card) throw new Error(T("SF2eTSC.attackCard.notFound"));
  const pd = card.result?.pendingDamage;
  if (card.status !== "resolved" || !pd) throw new Error(T("SF2eTSC.rolls.noPendingDamage"));
  if (card.damageApplied) throw new Error(T("SF2eTSC.rolls.alreadyApplied"));
  return { message, card, pd };
}
/** Roll (or re-roll) the damage of a hit from a sheet attack. Nothing is applied; repeat rolls are allowed. */
export async function rollAttackCardDamage({ user, payload }) {
  const { message, card, pd } = pendingCard(payload);
  const crewActor = card.request.crewUuid ? await fromUuidSafe(card.request.crewUuid) : null;
  if (!mayResolveCard(user, card, crewActor)) throw new Error(T("SF2eTSC.errors.noPermission"));
  if (damaging.has(message.id)) throw new Error(T("SF2eTSC.rolls.busy"));
  damaging.add(message.id);
  try {
    const formula = pd.crit ? pd.critFormula : pd.formula;
    const parts = pd.damageParts?.length
      ? pd.damageParts.map((part) => ({ ...part, formula: pd.crit ? `(${part.formula})*2` : part.formula }))
      : [{ formula, type: pd.damageType ?? "untyped" }];
    const roll = await rollTypedDamage(typedDamageFormula(parts), {
      attackCardId: message.id,
      speaker: { alias: card.ship.name },
      flavor: T("SF2eTSC.rolls.damageFlavor", {
        ship: card.ship.name,
        weapon: ct(pd.source ?? card.weapon?.name ?? ""),
        type: [pd.damageType, ...(pd.extraTypes ?? [])].map(dmgType).join(" + "),
        crit: pd.crit ? ` (${T("SF2eTSC.rolls.critical")})` : ""
      })
    });
    await updateCard(message, { damageRoll: { formula, total: roll.total, crit: !!pd.crit, by: user.id }, error: null });
    return { ok: true, total: roll.total };
  } finally {
    damaging.delete(message.id);
  }
}
/**
 * Apply the rolled damage once, GM only, to the target bound at resolution time (never to a client-chosen or
 * random target). Shields, hardness, resistances, weaknesses, immunities, hull and conditions go through the
 * normal starship damage pipeline.
 */
export async function applyAttackCardDamage({ user, payload }) {
  if (!user?.isGM) throw new Error(T("SF2eTSC.errors.noPermission"));
  const { message, card, pd } = pendingCard(payload);
  if (!card.damageRoll) throw new Error(T("SF2eTSC.rolls.rollDamageFirst"));
  if (damaging.has(message.id)) throw new Error(T("SF2eTSC.rolls.alreadyApplied"));
  damaging.add(message.id);
  try {
    const target = await fromUuidSafe(pd.targetUuid);
    if (!target || !isStarship(target)) throw new Error(T("SF2eTSC.errors.needTarget"));
    const draft = new Draft(activeStarshipCombat() ?? null);
    const d = await applyDamageInDraft(draft, pd.targetUuid, {
      amount: card.damageRoll.total,
      damageType: pd.damageType,
      traits: pd.traits ?? [],
      criticalHit: !!pd.crit,
      source: pd.source,
      silent: true
    });
    await draft.commit();
    await updateCard(message, {
      damageApplied: true,
      damageResult: {
        shield: d.shieldDamage,
        hull: d.hullDamage,
        immune: d.immune,
        resisted: d.resistanceReduction,
        hardness: d.hardnessReduction,
        weakness: d.weaknessIncrease,
        destroyed: d.destroyed,
        appliedBy: user.id
      }
    });
    return { ok: true, result: d };
  } finally {
    damaging.delete(message.id);
  }
}

export async function updateCard(message, patch) {
  const card = { ...message.flags[MODULE_ID][CARD_FLAG], ...patch };
  await message.update({
    content: renderAttackCard({ id: message.id, flags: { [MODULE_ID]: { [CARD_FLAG]: card } } }),
    [`flags.${MODULE_ID}.${CARD_FLAG}`]: card
  });
}
