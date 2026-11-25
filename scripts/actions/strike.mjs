import { publicLabel } from "../chat/attack-card/model.mjs";
import { damagePartsFromRoll, rollTypedDamage, typedDamageFormula } from "../rolls/typed-damage.mjs";
import { DEGREE } from "../constants.mjs";
import { effectiveDetection, findObject } from "../engine/sensor-ops.mjs";
import { targetingState } from "../engine/target-rules.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { privateContacts } from "../sensor/private-contacts.mjs";
import { classifyRange, calculateZoneDistance, rangePenalty } from "../engine/range.mjs";
import { isAttackFromBehind } from "../engine/heading.mjs";
import { calculateAreaZones, parseAreaTrait, areaTargets } from "../engine/areas.mjs";
import { stackModifiers } from "../engine/stacking.mjs";
import { effectModifiers, stationEffects, consumedByStrike } from "../starship/effects.mjs";
import {
  computeShipStats,
  shipAC,
  shipModifiers,
  modifierTotal,
  shipStatistic,
  shipModuleValue,
  shipAreaDC,
  rollNativeCheck,
  crewClassDC,
  bestSpellStatistic,
  secretVisibility,
  targetArmorClass,
  targetSaveModifier,
  targetStatistic
} from "../starship/stats.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { basicSaveMultiplier } from "./dice.mjs";
import { stationOf } from "../starship/starship-state.mjs";
import { Content } from "../content/loader.mjs";
import { T, moduleSetting, escapeHtml, isActiveGM } from "../utils/foundry.mjs";
import { Reactions } from "./reactions.mjs";
import { log } from "../utils/logging.mjs";
import { ct } from "../content/content-i18n.mjs";
import { manualModifiersFor } from "./manual-modifiers.mjs";
import { buildWeaponItemData } from "../content/weapon-docs.mjs";
import { weaponProfileOf } from "./weapon-profile.mjs";

export { weaponProfileOf };

const DEGREE_LABEL = (d) => T(`SF2eTSC.degree.${["criticalFailure", "failure", "success", "criticalSuccess"][d]}`);

/** Resolve the weapon used by the current context (player weapon installed on a station, or an NPC strike). */
export function resolveWeapon(ctx) {
  if (ctx.options.npcStrike) {
    const s = ctx.options.npcStrike;
    const parts = npcDamageParts(s.damage);
    const split = splitNPCDamageParts(parts);
    return {
      id: s.name,
      name: s.name,
      npc: true,
      attack: s.attack,
      formula: split.immediate.map((p) => p.formula).join(" + ") || "0",
      damageType: split.immediate[0]?.type ?? parts[0].type,
      damageParts: split.immediate,
      persistentParts: split.persistent,
      traits: s.traits ?? [],
      group: s.group,
      type: s.type,
      save: s.save,
      savingThrow: s.savingThrow,
      range: npcStrikeRange(s, ctx.stats?.sensorRange)
    };
  }
  const data = ctx.data,
    st = ctx.station;
  const stored =
    data.weapons.find((w) => w.id === (ctx.options.weaponId ?? st?.weaponId)) ??
    data.weapons.find((w) => w.stationId === st?.id) ??
    data.weapons[0];
  if (!stored) return null;
  const base = Content.weapons.get(stored.weaponRef ?? stored.id) ?? {};
  return {
    ...base,
    ...stored,
    traits: stored.traits ?? base.traits ?? [],
    range: stored.range ?? base.range ?? 3,
    die: stored.die ?? base.die ?? "1d6",
    damageType: stored.damageType ?? base.damageType ?? "untyped"
  };
}
const DAMAGE_PART = /(\d+d\d+(?:\s*[+-]\s*\d+)?)(?:\s+(persistent\s+)?([a-z]+))?/gi;
const NOT_A_TYPE = new Set(["plus", "and", "damage"]);
/** Damage components of a statblock damage string: [{formula, type}] (always at least one). */
export function npcDamageParts(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(DAMAGE_PART)) {
    const type = m[3] && !NOT_A_TYPE.has(m[3].toLowerCase()) ? m[3].toLowerCase() : null;
    out.push({ formula: m[1].replace(/\s+/g, ""), type, ...(m[2] ? { category: "persistent" } : {}) });
  }
  if (!out.length) out.push({ formula: "1d6", type: null });
  const first = out.find((p) => p.type)?.type ?? "untyped";
  return out.map((p, i) => ({ ...p, type: p.type ?? (i === 0 ? first : first) }));
}
export function splitNPCDamageParts(parts) {
  return {
    immediate: parts.filter((part) => part.category !== "persistent"),
    persistent: parts.filter((part) => part.category === "persistent")
  };
}
/**
 * Maximum range (zones) of an NPC Strike.
 *  - melee Strikes: the starship's own zone (0)
 *  - "range increment N zones": up to 6 increments, as for PF2e range increments (module interpretation; documented)
 *  - "range N zones": that range
 *  - otherwise the matching player weapon of the same name (Tech Core p.192 table), else the ship's sensor range.
 */
export function npcStrikeRange(strike, sensorRange = 6) {
  if (strike?.kind === "melee") return 0;
  const traits = strike?.traits ?? [];
  for (const t of traits) {
    const m = /range increment (\d+) zones?/i.exec(t);
    if (m) return Number(m[1]) * 6;
  }
  for (const t of traits) {
    const m = /^range (\d+) zones?/i.exec(t);
    if (m) return Number(m[1]);
  }
  const name = String(strike?.name ?? "").toLowerCase();
  const table = [...(Content.weapons?.values?.() ?? [])].find((w) => String(w.name).toLowerCase() === name);
  if (table?.range != null) return table.range;
  return sensorRange ?? 6;
}
function rangeIncrementOf(traits = []) {
  for (const t of traits) {
    const m = /range increment (\d+) zones?/i.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}

const modLabel = (key) => T(`SF2eTSC.mods.${key}`);
/** Localized label of a module effect (falls back to the stored label). */
export function effectLabel(slug, fallback) {
  const k = `SF2eTSC.effects.${slug}`;
  return game.i18n.has(k) ? T(k) : ct(fallback ?? slug);
}

/**
 * Every pre-roll modifier the module knows reliably (shared by the attack declaration card and the roll itself).
 * Pure with respect to state: nothing is consumed or written here.
 * @returns {{mods:object[], acMods:object[], ac:number, baseAC:number, distance:number, behind:boolean, tooFar:boolean, consumed:object[]}}
 */
export function computeAttackModifiers(ctx, weapon, target, { mapPenalty = ctx.mapPenalty ?? 0 } = {}) {
  const row = ctx.stationRow;
  const me = findObject(ctx.tsc, ctx.shipUuid),
    to = findObject(ctx.tsc, target.key);
  const distance = calculateZoneDistance(me.zone, to.zone);
  const incr = rangeIncrementOf(weapon.traits);
  const volley = (weapon.traits ?? []).map((t) => /volley (\d+)/.exec(String(t))).find(Boolean)?.[1];
  const rp = rangePenalty({ distance, rangeIncrement: incr, volley: volley ? Number(volley) : null });
  const context = {
    data: ctx.data,
    stationId: ctx.station?.id ?? ctx.stationId,
    actionId: ctx.action?.id ?? ctx.actionId,
    weaponId: weapon.id,
    ability: !weapon.traits?.includes("spell") && ctx.options?.npcStrike?.kind !== "melee" ? "dex" : undefined,
    againstUuid: target.actor.uuid,
    combat: ctx.combat,
    statistic: "check",
    includeStationCheck: true
  };
  const mods = manualModifiersFor(ctx.manualModifiers, "attack");
  if (row?.tracking) mods.push({ slug: "tsc-tracking", label: modLabel("tracking"), type: "item", value: row.tracking });
  mods.push(
    ...shipModifiers(ctx.ship, "attack", context).map((modifier) => ({
      ...modifier,
      slug: modifier.slug?.startsWith("tsc-") ? modifier.slug : `tsc-${modifier.slug}`
    }))
  );
  if (
    ctx.stats.offKilter &&
    !mods.some((modifier) => modifier.type === "circumstance" && modifier.value === -2 && modifier.label === modLabel("offKilter"))
  )
    mods.push({ slug: "tsc-off-kilter", label: modLabel("offKilter"), type: "circumstance", value: -2 });
  for (const n of rp.notes) mods.push({ slug: `tsc-${n.key}`, label: modLabel(n.key), type: "untyped", value: n.value });
  if (mapPenalty) mods.push({ slug: "multiple-attack-penalty", label: T("SF2eTSC.ui.map"), type: "untyped", value: mapPenalty });
  const hazard = target.actor?.type === "hazard";
  const tstats = hazard ? { ac: targetArmorClass(target.actor), offGuard: false } : computeShipStats(target.actor);
  const behind = isAttackFromBehind(me.zone, to.zone, to.heading ?? target.data.heading);
  const defense = hazard
    ? { value: tstats.ac, applied: [] }
    : shipAC(target.actor, { data: target.data, againstUuid: ctx.shipUuid, offGuard: behind, statistic: "dc" });
  const consumed = consumedByStrike(target.data.effects, ctx.shipUuid);
  let effectiveAttackBonus = null;
  try {
    const statistic =
      ctx.options?.npcStrike || weapon.npc
        ? npcStatistic(ctx, weapon)
        : ctx.action?.builtin === "spell-attack"
          ? bestSpellStatistic(ctx.crew)
          : buildCrewAttack(ctx.crew, weapon);
    const prepared = statistic?.clone({
      modifiers: mods.map((m) => new game.pf2e.Modifier({ slug: m.slug, label: m.label, modifier: m.value, type: m.type }))
    });
    effectiveAttackBonus = prepared?.check?.mod ?? prepared?.mod ?? (weapon.npc ? weapon.attack + modifierTotal(mods).total : null);
  } catch (err) {
    log.debug("attack bonus preview unavailable", err);
  }
  return {
    mods,
    effectiveAttackBonus,
    acMods: defense.applied,
    baseAC: tstats.ac,
    ac: defense.value,
    distance,
    behind,
    tooFar: rp.tooFar,
    consumed,
    total: modifierTotal(mods).total
  };
}

/** Attack roll for a Strike or a spell attack. Returns { degree, total, dc, lines }. */
async function attackRoll(ctx, weapon, target, { spell = false } = {}) {
  const pre = computeAttackModifiers(ctx, weapon, target);
  if (pre.tooFar && !ctx.options.gmOverride) ctx.rule("outOfRange");
  const mods = pre.mods;
  // effects used up by this Strike (e.g. Target Lock success: off-guard to the *next* Strike only)
  if (pre.consumed.length) target.data.effects = target.data.effects.filter((e) => !pre.consumed.includes(e));
  const dc = pre.ac;
  let statistic = null,
    base = 0;
  if (ctx.options.npcStrike) {
    base = weapon.attack;
  } else if (spell) statistic = bestSpellStatistic(ctx.crew);
  else statistic = buildCrewAttack(ctx.crew, weapon);
  const attacker = findObject(ctx.tsc, ctx.shipUuid);
  const secretAttack = !!ctx.privateAction || (ctx.data.role !== "player" && (!attacker || !publicLabel(attacker, "party").known));
  const res = await rollNativeCheck({
    secret: secretAttack,
    statistic: ctx.options.npcStrike ? npcStatistic(ctx, weapon) : statistic,
    createMessage: !(ctx.cardMode && ctx.action.builtin === "spell-attack"),
    onMessage: ctx.onAttackMessage ?? null,
    dc,
    label: `${ct(weapon.name)} — ${ctx.ship.name}`,
    actor: ctx.crew ?? ctx.ship,
    extraModifiers: mods,
    extraRollOptions: [
      "starship-strike",
      ...(weapon.traits ?? []).map((t) => `item:trait:${String(t).toLowerCase().replace(/\s+/g, "-")}`)
    ],
    skipDialog: ctx.options.skipDialog,
    messageMode: ctx.options.messageMode,
    modifierOnly: base + modifierTotal(mods).total
  });
  if (!res) return null;
  ctx.attackResult = {
    total: res.total,
    natural: res.natural ?? null,
    ac: dc,
    baseAC: pre.baseAC,
    degree: res.degree,
    degreeLabel: DEGREE_LABEL(res.degree),
    modifiers: mods.map((m) => ({ label: m.label, value: m.value })),
    acModifiers: pre.acMods.map((m) => ({ label: m.label, value: m.value })),
    distance: pre.distance,
    behind: pre.behind,
    native: !!res.native
  };
  return {
    ...res,
    dc,
    distance: pre.distance,
    behind: pre.behind,
    lines: [
      { label: T("SF2eTSC.chat.attack"), value: T("SF2eTSC.chat.vsAC", { total: res.total, ac: dc, degree: DEGREE_LABEL(res.degree) }) }
    ]
  };
}
/** Pre-roll attack bonus of the roller when the system exposes it reliably (crew Statistic / NPC statblock). */
export function sheetAttackBonus(crew, weapon, ctx = null) {
  if (weapon?.npc && !ctx) return Number.isFinite(weapon.attack) ? weapon.attack : null;
  try {
    const st = weapon?.npc ? npcStatistic(ctx, weapon) : buildCrewAttack(crew, weapon);
    const modifiers = ctx
      ? shipModifiers(ctx.ship, "attack", {
          data: ctx.data,
          stationId: ctx.station?.id,
          actionId: ctx.action?.id,
          weaponId: weapon.id,
          ability: !weapon.traits?.includes("spell") && ctx.options?.npcStrike?.kind !== "melee" ? "dex" : undefined,
          combat: ctx.combat,
          statistic: "check",
          includeStationCheck: true
        })
      : [];
    if (ctx?.stationRow?.tracking)
      modifiers.push({ slug: "tsc-tracking", label: modLabel("tracking"), type: "item", value: ctx.stationRow.tracking });
    const prepared =
      modifiers.length && st
        ? st.clone({
            modifiers: modifiers.map((m) => new game.pf2e.Modifier({ slug: m.slug, label: m.label, modifier: m.value, type: m.type }))
          })
        : st;
    const value = prepared?.check?.mod ?? prepared?.mod ?? (weapon?.npc ? weapon.attack + modifierTotal(modifiers).total : null);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
export function knownAttackBonus(ctx, weapon) {
  if (ctx.options?.npcStrike || weapon?.npc) {
    const native = npcStatistic(ctx, weapon);
    const value = native?.check?.mod ?? native?.mod ?? weapon?.attack;
    return Number.isFinite(value) ? { value, source: "statblock" } : null;
  }
  try {
    const st = buildCrewAttack(ctx.crew, weapon);
    const v = st?.check?.mod ?? st?.mod;
    return Number.isFinite(v) ? { value: v, source: "crew" } : null;
  } catch {
    return null;
  }
}
function npcStatistic(ctx, weapon) {
  const Ctor = ctx.ship?.saves?.fortitude?.constructor ?? ctx.ship?.perception?.constructor;
  if (!Ctor) return null;
  try {
    const native = ctx.ship.system?.actions?.find((s) => s.type === "strike" && s.item?.name === weapon.name);
    const sourceBase = native?.item?._source?.system?.bonus?.value ?? weapon.attack ?? 0;
    const modifiers = native?.modifiers?.map((m) => m.clone()) ?? [
      new game.pf2e.Modifier({ slug: "base", label: T("SF2eTSC.mods.statblock"), modifier: sourceBase, type: "untyped" })
    ];
    if (native && weapon.attack !== sourceBase)
      modifiers.push(
        new game.pf2e.Modifier({
          slug: "tsc-strike-base-adjust",
          label: T("SF2eTSC.mods.statblock"),
          modifier: weapon.attack - sourceBase,
          type: "untyped"
        })
      );
    const ranged = ctx.options.npcStrike?.kind !== "melee";
    return new Ctor(ctx.ship, {
      slug: "starship-strike",
      label: ct(weapon.name),
      domains: [
        "all",
        "check",
        "attack",
        "attack-roll",
        "strike-attack-roll",
        ranged ? "ranged-attack-roll" : "melee-attack-roll",
        ...(ranged ? ["dex-based", "dex-attack-roll"] : [])
      ],
      modifiers,
      check: { type: "attack-roll" },
      rollOptions: native?.item?.getRollOptions?.("item") ?? []
    });
  } catch (err) {
    throw new Error(T("SF2eTSC.attackCard.nativeRollNotCompleted"), { cause: err });
  }
}
function buildCrewAttack(crew, weapon) {
  const Ctor = crew?.skills?.acrobatics?.constructor ?? crew?.perception?.constructor;
  if (!Ctor) return null;
  const ItemCtor = globalThis.CONFIG?.Item?.documentClass;
  if (!ItemCtor || typeof crew.prepareStrike !== "function") throw new Error(T("SF2eTSC.attackCard.nativeRollNotCompleted"));
  const source = buildWeaponItemData(weapon, { systemKeys: new Set(Object.keys(CONFIG.PF2E.weaponTraits)) });
  source.system.category = weapon.category ?? source.system.category;
  source.system.group = weapon.group ?? null;
  source.system.baseItem = weapon.baseItem ?? null;
  // Native preparation needs a ranged marker; all zone distance/range penalties remain module-owned.
  source.system.range = 1;
  const item = new ItemCtor(source, { parent: crew });
  // prepareStrike is an internal system API: use only this transient ship weapon, never a handheld Strike.
  const strike = crew.prepareStrike(item, { handsReallyFree: crew.handsReallyFree });
  const rankOption = strike.options.find((option) => /^item:proficiency:rank:[0-4]$/.test(option));
  if (!rankOption) throw new Error(T("SF2eTSC.attackCard.nativeRollNotCompleted"));
  const domains = [...new Set([...strike.domains, "check", "dex-attack-roll", "starship-strike", "starship-strike-attack-roll"])];
  const rollOptions = [
    ...crew.getRollOptions(domains),
    ...crew.getSelfRollOptions("origin"),
    ...strike.options,
    ...item.getRollOptions("item"),
    "starship",
    "starship-strike"
  ];
  const nativeAdjustments = new Set(strike.domains.flatMap((d) => crew.synthetics.modifierAdjustments[d] ?? []));
  const addedAdjustments = [...new Set(domains.flatMap((d) => crew.synthetics.modifierAdjustments[d] ?? []))].filter(
    (a) => !nativeAdjustments.has(a)
  );
  // Native Strength selection can disable Dexterity before the ship's Dexterity-only check.
  const modifiers = strike.modifiers
    .filter((m) => m.type !== "ability" || m.ability === "dex")
    .map((m) =>
      m.clone({
        ...(m.type === "ability" ? { ignored: false, enabled: true } : {}),
        adjustments: [...m.adjustments, ...addedAdjustments.filter((a) => a.slug === null || a.slug === m.slug)]
      })
    );
  const stationModifiers = domains
    .filter((d) => !strike.domains.includes(d))
    .flatMap((d) =>
      (crew.synthetics.modifiers[d] ?? []).flatMap(
        (factory) => factory({ injectables: { weapon: item }, resolvables: { weapon: item }, test: new Set(rollOptions) }) ?? []
      )
    );
  return preparedCrewAttack(crew, ct(weapon.name), domains, rollOptions, modifiers, stationModifiers);
}

function preparedCrewAttack(crew, label, domains, rollOptions, modifiers, extraModifiers = []) {
  const { Check, CheckModifier } = game.pf2e;
  const adjustments = [...new Set(domains.flatMap((domain) => crew.synthetics.modifierAdjustments[domain] ?? []))];
  const extras = extraModifiers.map((m) => m.clone({ adjustments: adjustments.filter((a) => a.slug === null || a.slug === m.slug) }));
  const prepared = new CheckModifier("starship-strike", { modifiers }, extras, new Set(rollOptions));
  return {
    clone: ({ modifiers: added = [] }) => preparedCrewAttack(crew, label, domains, rollOptions, modifiers, [...extraModifiers, ...added]),
    check: {
      mod: prepared.totalModifier,
      roll: async (options) => {
        const test = new Set([
          ...rollOptions,
          ...(options.extraRollOptions ?? []),
          "check:statistic:starship-strike",
          "check:type:attack-roll"
        ]);
        for (const rule of crew.rules.filter((r) => !r.ignored)) rule.beforeRoll?.(domains, test);
        const twice = domains.flatMap((d) => crew.synthetics.rollTwice[d] ?? []).filter((r) => r.predicate?.test(test) ?? true);
        const higher = twice.some((r) => r.keep === "higher"),
          lower = twice.some((r) => r.keep === "lower");
        const context = {
          actor: crew,
          identifier: foundry.utils.randomID(20),
          token: crew.getActiveTokens(true, true).shift() ?? null,
          type: "attack-roll",
          action: "strike",
          domains,
          options: test,
          dc: options.dc,
          title: options.label ?? label,
          skipDialog: options.skipDialog,
          messageMode: options.messageMode,
          createMessage: options.createMessage,
          notes: domains.flatMap((d) => (crew.synthetics.rollNotes[d] ?? []).map((n) => n.clone())),
          rollTwice: higher === lower ? false : higher ? "keep-higher" : "keep-lower",
          substitutions: domains
            .flatMap((d) => foundry.utils.deepClone(crew.synthetics.rollSubstitutions[d] ?? []))
            .filter((r) => r.predicate?.test(test) ?? true),
          dosAdjustments: domains.flatMap((d) => crew.synthetics.degreeOfSuccessAdjustments[d] ?? [])
        };
        const check = new CheckModifier("starship-strike", { modifiers }, extras, test);
        const roll = await Check.roll(check, context, options.event, options.callback);
        if (roll)
          for (const rule of crew.rules.filter((r) => !r.ignored))
            await rule.afterRoll?.({ roll, check, context, domains, rollOptions: test });
        return roll;
      }
    }
  };
}

export function damageFormula(ctx, weapon, crit) {
  if (weapon.npc) return crit ? `(${weapon.formula})*2` : weapon.formula;
  const dice = ctx.stationRow?.damageDice ?? 1;
  const [n, faces] = String(weapon.die).split("d").map(Number);
  const context = {
    actor: ctx.ship,
    selector: "station-damage",
    stationId: ctx.station?.id,
    actionId: ctx.action?.id,
    weaponId: weapon.id,
    statistic: "check"
  };
  const damageMods = [
    ...effectModifiers(stationEffects(ctx.data.effects, ctx.station?.id, ctx.combat, context), "station-damage", context),
    ...manualModifiersFor(ctx.manualModifiers, "damage")
  ];
  // Prefer SF2e's own stacking implementation; older/testing environments retain the existing module fallback.
  const Modifier = globalThis.game?.pf2e?.Modifier;
  const StatisticModifier = globalThis.game?.pf2e?.StatisticModifier;
  const boost =
    Modifier && StatisticModifier
      ? new StatisticModifier(
          "tsc-station-damage",
          damageMods.map((m, i) => new Modifier({ slug: `tsc-damage-${i}`, label: m.label ?? m.slug, modifier: m.value, type: m.type }))
        ).totalModifier
      : stackModifiers(damageMods).total;
  const base = `${n * dice}d${faces}${boost > 0 ? `+${boost}` : boost < 0 ? `${boost}` : ""}`;
  return crit ? `(${base})*2` : base;
}
async function rollDamage(ctx, formula, flavor) {
  const roll = await new Roll(formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: ctx.ship }), flavor }, secretVisibility(ctx.privateAction));
  return roll.total;
}

/** Strike with the installed weapon / NPC strike against a single starship target. */
export async function resolveStrike(ctx) {
  const weapon = resolveWeapon(ctx);
  if (!weapon) throw new Error(T("SF2eTSC.errors.noWeapon"));
  ctx.weapon = weapon;
  const target = ctx.target;
  if (!target) throw new Error(T("SF2eTSC.errors.needTarget"));
  const me = findObject(ctx.tsc, ctx.shipUuid),
    to = findObject(ctx.tsc, target.key);
  const range = weapon.range;
  if (!ctx.options.gmOverride && !classifyRange(me.zone, to.zone, range).inRange) ctx.rule("outOfRange");
  const res = await attackRoll(ctx, weapon, target);
  if (!res) {
    ctx.cancelled = true;
    return;
  }
  ctx.lines.push(...res.lines);
  ctx.degreeLabel = DEGREE_LABEL(res.degree);
  ctx.degree = res.degree;
  const crit = res.degree === DEGREE.CRITICAL_SUCCESS;
  if (ctx.options.sheetRoll) {
    // sheet roll: attack roll, damage roll and damage application are three separate steps (§8). The target is
    // bound here on the GM side; the card can only roll/apply damage for exactly this target, once. The weapon/target
    // data is bound even on a miss so a system reroll that hits can build the pending damage.
    const traitsL = (weapon.traits ?? []).map((t) => String(t).toLowerCase());
    const profile = weaponProfileOf(weapon);
    const boundTargets = profile.plasma ? ctx.targets : [target];
    const bindings = boundTargets.map((bound) => ({ targetUuid: bound.uuid, targetKey: bound.key }));
    const save = profile.save
      ? {
          ...profile.save,
          dc: profile.save.dc ?? crewClassDC(ctx.crew) + (profile.area ? (ctx.stats.areaDCModifier ?? 0) : 0)
        }
      : null;
    ctx.boundDamage = {
      damageParts: weapon.npc ? weapon.damageParts : null,
      persistentParts: weapon.persistentParts ?? [],
      formula: damageFormula(ctx, weapon, false),
      critFormula: damageFormula(ctx, weapon, true),
      damageType: weapon.damageType,
      extraTypes: (weapon.damageParts ?? []).slice(1).map((p) => p.type),
      traits: traitsL,
      targetUuid: bindings[0].targetUuid,
      targetKey: bindings[0].targetKey,
      ...(profile.plasma ? { plasma: true, profile, targets: bindings, save } : {}),
      ...(ctx.privateAction ? { privateCombatId: ctx.combat.id } : {}),
      source: weapon.name
    };
    if (res.degree >= DEGREE.SUCCESS) {
      ctx.pendingDamage = { ...ctx.boundDamage, crit };
      ctx.reports.push(T("SF2eTSC.rolls.damagePending"));
    } else {
      ctx.reports.push(T("SF2eTSC.chat.miss"));
    }
    return;
  }
  if (res.degree < DEGREE.SUCCESS) {
    ctx.reports.push(T("SF2eTSC.chat.miss"));
    return;
  }
  const persistent = weapon.persistentParts?.length
    ? {
        targetUuid: target.uuid,
        parts: weapon.persistentParts,
        source: ct(weapon.name),
        criticalHit: crit
      }
    : null;
  if (weapon.npc && !weapon.damageParts.length) {
    if (persistent) (ctx.pendingPersistentDamage ??= []).push(persistent);
    return;
  }
  // Keep the same formula and application order, but use the system's typed damage roll for chat.
  const formula = damageFormula(ctx, weapon, crit);
  const flavor = `${ct(weapon.name)}: ${T("SF2eTSC.chat.damage")}`;
  const secret = !!ctx.privateAction || (ctx.data.role !== "player" && (!me || !publicLabel(me, "party").known));
  const DamageRoll = globalThis.CONFIG?.Dice?.rolls?.find((Ctor) => Ctor.name === "DamageRoll");
  const damageType = weapon.damageType ?? "untyped";
  const formulas = weapon.npc
    ? weapon.damageParts.map((part) => ({ ...part, formula: crit ? `(${part.formula})*2` : part.formula }))
    : [{ formula, type: damageType }];
  const types = new Set(formulas.map((part) => part.type));
  const typedFormula = formulas.every((part) => /^[a-z][a-z0-9-]*$/.test(part.type)) ? typedDamageFormula(formulas) : null;
  // Select the fallback before evaluating a roll, never retry after a message might have been posted.
  const nativeAvailable = typedFormula && DamageRoll && (!DamageRoll.validate || DamageRoll.validate(typedFormula));
  let amount, parts;
  if (nativeAvailable) {
    const damageRoll = await rollTypedDamage(typedFormula, { actor: ctx.ship, suppressApply: true, secret, flavor });
    parts = damagePartsFromRoll(damageRoll, types.size === 1 ? formulas[0].type : null);
    amount = parts.reduce((sum, part) => sum + part.amount, 0);
  } else {
    parts = [];
    for (const part of formulas) {
      const roll = await new Roll(part.formula).evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: ctx.ship }), flavor }, secretVisibility(secret));
      parts.push({ type: part.type, amount: roll.total });
    }
    amount = parts.reduce((sum, part) => sum + part.amount, 0);
  }
  const traits = (weapon.traits ?? []).map((t) => String(t).toLowerCase());
  // reaction window (Reposition Shield, Drone Block, ...) before damage is applied to a player ship
  const rx = await Reactions.ask(ctx, target, { amount, traits, crit });
  if (rx.manualDamage) {
    ctx.reports.push(T("SF2eTSC.droneBlock.manualResult", { amount, resistance: rx.resistance ?? 0 }));
    if (rx.manualDamage.protocolManual) ctx.reports.push(T("SF2eTSC.droneBlock.protocolManualResult", { resistance: rx.resistance ?? 0 }));
    return;
  }
  if (persistent) (ctx.pendingPersistentDamage ??= []).push(persistent);
  const dmgTraits = traits.includes("bypassing") || rx.bypassHull ? [...traits, "bypassing"] : traits;
  if (rx.shieldAbsorb) {
    const sp = (await ctx.draft.ship(target.uuid)).data.sp.value;
    const absorbed = Math.min(amount, rx.shieldAbsorb === "full" ? sp : Math.floor(sp / 2));
    amount -= absorbed;
    // Remove absorption from evaluated components in instance/formula order, not from an aggregate alone.
    let remaining = absorbed;
    parts = parts.map((part) => {
      const reduction = Math.min(part.amount, remaining);
      remaining -= reduction;
      return { ...part, amount: part.amount - reduction };
    });
    ctx.reports.push(T("SF2eTSC.chat.shieldAbsorbed", { amount: absorbed }));
  }
  const dmg = await applyDamageInDraft(ctx.draft, target.uuid, {
    amount,
    parts,
    damageType: weapon.damageType,
    strikeResistance: rx.resistance ?? 0,
    traits: dmgTraits,
    criticalHit: crit,
    nonlethal: traits.includes("nonlethal"),
    source: ct(weapon.name),
    attackLine: null,
    silent: true
  });
  recordDamage(ctx, target.actor.name, amount, weapon.damageType, dmg);
  await applyTargetStationRider(ctx, target, dmg, res.degree);
}

/** Damage summary for the attack result card (shield/hull split and consequences). */
function recordDamage(ctx, targetName, rolled, damageType, dmg) {
  (ctx.damageResults ??= []).push({
    target: targetName,
    rolled,
    damageType,
    shield: dmg.shieldDamage,
    hull: dmg.hullDamage,
    immune: dmg.immune,
    resisted: dmg.resistanceReduction,
    hardness: dmg.hardnessReduction,
    weakness: dmg.weaknessIncrease,
    bypassed: dmg.bypassedShields,
    compromised: dmg.becameCompromised,
    compromisedIncrease: dmg.compromisedIncrease,
    malfunction: dmg.stationsMalfunctioned,
    destroyed: dmg.destroyed,
    hp: dmg.newState?.hp,
    sp: dmg.newState?.sp
  });
}

/** Target Battle Station rider on the attacker's effects. */
async function applyTargetStationRider(ctx, target, dmg, degree) {
  const mine = ctx.data.effects.find((e) => e.rider?.kind === "targetStation" && e.rider.targetUuid === target.uuid);
  if (!mine) return;
  ctx.data.effects = ctx.data.effects.filter((e) => e !== mine);
  if (dmg.hullDamage <= 0) return;
  const tdata = (await ctx.draft.ship(target.uuid)).data;
  const st = stationOf(tdata, mine.rider.stationId);
  if (st) {
    st.malfunctioning = true;
    ctx.reports.push(`${st.name}: ${T("SF2eTSC.ui.malfunctioning")}`);
  }
  if (degree === DEGREE.CRITICAL_SUCCESS) ctx.reports.push(T("SF2eTSC.chat.stunned1", { name: target.actor.name }));
}

function areaContactObjects(tsc, shipUuid, contacts) {
  const state = targetingState(tsc, shipUuid, contacts);
  return [
    ...state.objects.filter((o) => !o.tscPrivateProjection),
    ...contacts.filter(
      (o) => !o.pendingReveal && o.actorUuid !== shipUuid && !state.objects.some((p) => p.key === o.key || p.actorUuid === o.actorUuid)
    )
  ];
}

/** Area Fire / Auto-Fire: damage once, each starship in the area makes a basic Reflex save vs the crew's class DC. */
export async function resolveAreaFire(ctx, kind) {
  const weapon = resolveWeapon(ctx);
  if (!weapon) throw new Error(T("SF2eTSC.errors.noWeapon"));
  ctx.weapon = weapon;
  const contacts = privateContacts(ctx.combat.id);
  const objects = areaContactObjects(ctx.tsc, ctx.shipUuid, contacts);
  const me = objects.find((o) => o.key === ctx.shipUuid);
  const areaTrait = (weapon.traits ?? []).map((t) => parseAreaTrait(t, null)).find(Boolean);
  const defaultSize = moduleSetting("areaWeaponZones") || Math.max(1, Math.floor((weapon.range ?? 2) / 2));
  let area;
  if (kind === "auto-fire")
    area = { type: "cone", value: moduleSetting("autoFireConeZones") || Math.max(1, Math.floor((weapon.range ?? 2) / 2)) };
  else area = { type: areaTrait?.type ?? "burst", value: areaTrait?.value ?? defaultSize };
  const origin = area.type === "burst" ? (ctx.options.areaOrigin ?? me.zone) : me.zone;
  if (!ctx.options.gmOverride && classifyRange(me.zone, origin, weapon.range).inRange === false) ctx.rule("outOfRange");
  const zones = calculateAreaZones({ ...area, border: ctx.options.areaOrigin ?? origin }, me.zone, me.heading, ctx.tsc.zones);
  ctx.areaZones = zones;
  const { hit: candidates, excluded } = areaTargets(objects, zones, ctx.shipUuid, ctx.options.areaExcludeKeys);
  const undetected = candidates.filter((o) => !o.alwaysVisible && effectiveDetection(o, [ctx.shipUuid]) === "undetected");
  let included = [];
  if (undetected.length) {
    if (!isActiveGM()) throw new Error(T("SF2eTSC.errors.gmOnly"));
    included = await foundry.applications.api.DialogV2.prompt({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.ui.areaUndetected") },
      content: `<p>${escapeHtml(T("SF2eTSC.ui.areaUndetectedHint"))}</p><fieldset>${undetected
        .map(
          (o, i) =>
            `<label class="tsc-check"><input type="checkbox" name="areaInclude.${i}"> ${escapeHtml(o.name)} (${escapeHtml(T("SF2eTSC.ui.zone"))} ${o.zone})</label>`
        )
        .join("")}</fieldset>`,
      ok: {
        label: T("SF2eTSC.ui.execute"),
        callback: (_event, button) =>
          undetected.filter((_o, i) => button.form.elements.namedItem(`areaInclude.${i}`)?.checked).map((o) => o.key)
      },
      rejectClose: false
    });
    if (included === null) {
      ctx.cancelled = true;
      return;
    }
    if (!isActiveGM() || activeStarshipCombat()?.id !== ctx.combat.id) throw new Error(T("SF2eTSC.attackCard.stale"));
    const fresh = areaContactObjects(getTsc(ctx.combat), ctx.shipUuid, privateContacts(ctx.combat.id));
    const freshCandidates = areaTargets(fresh, zones, ctx.shipUuid, ctx.options.areaExcludeKeys).hit;
    if (
      freshCandidates.length !== candidates.length ||
      !fresh.some((p) => p.key === me.key && p.zone === me.zone && p.heading === me.heading) ||
      candidates.some(
        (o) =>
          !freshCandidates.some(
            (p) =>
              p.key === o.key &&
              p.zone === o.zone &&
              p.actorUuid === o.actorUuid &&
              effectiveDetection(p, [ctx.shipUuid]) === effectiveDetection(o, [ctx.shipUuid])
          )
      )
    )
      throw new Error(T("SF2eTSC.attackCard.stale"));
  }
  const targets = candidates.filter((o) => !undetected.includes(o) || included.includes(o.key));
  if (me.privateContact || targets.some((o) => o.privateContact)) {
    ctx.privateAction = true;
    ctx.draft.privateAction = true;
  }
  if (excluded.length) ctx.lines.push({ label: T("SF2eTSC.chat.areaExcluded"), value: String(excluded.length) });
  if (!targets.length) {
    ctx.reports.push(T("SF2eTSC.chat.noTargetsInArea", { zones: zones.join(", ") }));
    return;
  }
  const traits = (weapon.traits ?? []).map((t) => String(t).toLowerCase());
  const baseDC = shipAreaDC(ctx.crew, ctx.ship, {
    data: ctx.data,
    stationId: ctx.station?.id,
    actionId: ctx.action?.id ?? kind,
    weaponId: weapon.id,
    combat: ctx.combat
  });
  const total = await rollDamage(ctx, damageFormula(ctx, weapon, false), `${ct(weapon.name)}: ${T("SF2eTSC.chat.damage")}`);
  ctx.lines.push({
    label: T("SF2eTSC.chat.area"),
    value: `${T(`SF2eTSC.areaTypes.${area.type}`)} ${area.value} — ${T("SF2eTSC.ui.zone")} ${zones.join(", ")}`
  });
  for (const o of targets) {
    const entry = await ctx.draft.target(o.actorUuid ?? o.key);
    if (entry.data.destroyed) continue;
    const context = { data: entry.data, againstUuid: ctx.shipUuid, area: true, statistic: "check" };
    const hazard = entry.actor.type === "hazard";
    const stat = hazard ? targetStatistic(entry.actor, "reflex") : shipStatistic(entry.actor, "reflex", context);
    const res = await rollNativeCheck({
      statistic: stat,
      dc: baseDC,
      label: `${entry.actor.name}: ${T("SF2eTSC.ui.reflex")}`,
      actor: entry.actor,
      secret: !!ctx.privateAction,
      skipDialog: ctx.options.skipDialog,
      messageMode: ctx.options.messageMode,
      modifierOnly: hazard ? targetSaveModifier(entry.actor, "reflex") : shipModuleValue(entry.actor, "reflex", context)
    });
    if (!res) {
      ctx.cancelled = true;
      return;
    }
    const mult = basicSaveMultiplier(res.degree);
    const amount = Math.floor(total * mult);
    if (amount > 0) {
      const dmg = await applyDamageInDraft(ctx.draft, o.actorUuid ?? o.key, {
        amount,
        damageType: weapon.damageType,
        traits,
        criticalHit: res.degree === DEGREE.CRITICAL_FAILURE,
        nonlethal: traits.includes("nonlethal"),
        source: ct(weapon.name),
        silent: !!ctx.cardMode
      });
      recordDamage(ctx, entry.actor.name, amount, weapon.damageType, dmg);
    }
    ctx.reports.push(`${entry.actor.name}: ${DEGREE_LABEL(res.degree)} (×${mult})`);
  }
}

/** Spell attack builtin (Cosmic Cannon). */
export async function resolveSpellAttack(ctx) {
  const target = ctx.target;
  if (!target) throw new Error(T("SF2eTSC.errors.needTarget"));
  const spec = ctx.action.spellAttack;
  const rank = ctx.options.rank ?? 1;
  const weapon = { name: ct(ctx.action.name), traits: ["spell"], damageType: spec.damageType };
  const res = await attackRoll(ctx, weapon, target, { spell: true });
  if (!res) {
    ctx.cancelled = true;
    return;
  }
  ctx.lines.push(...res.lines);
  ctx.degreeLabel = DEGREE_LABEL(res.degree);
  ctx.degree = res.degree;
  if (res.degree < DEGREE.SUCCESS) {
    ctx.reports.push(T("SF2eTSC.chat.miss"));
    return;
  }
  const crit = res.degree === DEGREE.CRITICAL_SUCCESS;
  const count = spec.damage.count + (rank - 1) * spec.damage.perRank.count;
  const base = `${count}d${spec.damage.faces}`;
  const amount = await rollDamage(ctx, crit ? `(${base})*2` : base, `${ct(ctx.action.name)}: ${T("SF2eTSC.chat.damage")}`);
  const dmg = await applyDamageInDraft(ctx.draft, target.uuid, {
    amount,
    damageType: spec.damageType,
    criticalHit: crit,
    source: ct(ctx.action.name),
    silent: !!ctx.cardMode
  });
  recordDamage(ctx, target.actor.name, amount, spec.damageType, dmg);
}
