import { DEGREE } from "../constants.mjs";
import { findObject } from "../engine/sensor-ops.mjs";
import { classifyRange, calculateZoneDistance, rangePenalty } from "../engine/range.mjs";
import { isAttackFromBehind } from "../engine/heading.mjs";
import { calculateAreaZones, parseAreaTrait, areaTargets } from "../engine/areas.mjs";
import { stackModifiers } from "../engine/stacking.mjs";
import { effectModifiers, effectsAgainst, consumedByStrike, offGuardAgainst } from "../starship/effects.mjs";
import { computeShipStats, shipStatistic, rollNativeCheck, crewClassDC, bestSpellStatistic } from "../starship/stats.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { basicSaveMultiplier } from "./dice.mjs";
import { stationOf } from "../starship/starship-state.mjs";
import { Content } from "../content/loader.mjs";
import { T, moduleSetting } from "../utils/foundry.mjs";
import { Reactions } from "./reactions.mjs";
import { log } from "../utils/logging.mjs";
import { ct } from "../content/content-i18n.mjs";

const DEGREE_LABEL = (d) => T(`SF2eTSC.degree.${["criticalFailure", "failure", "success", "criticalSuccess"][d]}`);

/** Resolve the weapon used by the current context (player weapon installed on a station, or an NPC strike). */
export function resolveWeapon(ctx) {
  if (ctx.options.npcStrike) {
    const s = ctx.options.npcStrike;
    const parts = npcDamageParts(s.damage);
    return {
      id: s.name,
      name: s.name,
      npc: true,
      attack: s.attack,
      formula: parts.map((p) => p.formula).join(" + "),
      damageType: parts[0].type,
      damageParts: parts,
      traits: s.traits ?? [],
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
const DAMAGE_PART = /(\d+d\d+(?:\s*[+-]\s*\d+)?)(?:\s+(?:persistent\s+)?([a-z]+))?/gi;
const NOT_A_TYPE = new Set(["plus", "and", "damage"]);
/** Damage components of a statblock damage string: [{formula, type}] (always at least one). */
export function npcDamageParts(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(DAMAGE_PART)) {
    const type = m[2] && !NOT_A_TYPE.has(m[2].toLowerCase()) ? m[2].toLowerCase() : null;
    out.push({ formula: m[1].replace(/\s+/g, ""), type });
  }
  if (!out.length) out.push({ formula: "1d6", type: null });
  const first = out.find((p) => p.type)?.type ?? "untyped";
  return out.map((p, i) => ({ ...p, type: p.type ?? (i === 0 ? first : first) }));
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
  const fx = ctx.data.effects;
  const mods = [];
  if (row?.tracking) mods.push({ slug: "tsc-tracking", label: modLabel("tracking"), type: "item", value: row.tracking });
  for (const m of effectModifiers(
    fx.filter((e) => !e.station || e.station === ctx.station?.id),
    "station-check"
  ))
    mods.push({ slug: `tsc-${m.slug}`, label: effectLabel(m.slug, m.label), type: m.type, value: m.value });
  for (const m of effectModifiers(fx, "attack"))
    mods.push({ slug: `tsc-${m.slug}`, label: effectLabel(m.slug, m.label), type: m.type, value: m.value });
  if (ctx.stats.attackModifier)
    mods.push({ slug: "tsc-off-kilter", label: modLabel("offKilter"), type: "circumstance", value: ctx.stats.attackModifier });
  for (const n of rp.notes) mods.push({ slug: `tsc-${n.key}`, label: modLabel(n.key), type: "untyped", value: n.value });
  if (mapPenalty) mods.push({ slug: "multiple-attack-penalty", label: T("SF2eTSC.ui.map"), type: "untyped", value: mapPenalty });
  const tstats = computeShipStats(target.actor);
  const against = effectsAgainst(target.data.effects, ctx.shipUuid);
  const acMods = [
    ...effectModifiers(against, "ac-against-strikes").map((m) => ({ label: effectLabel(m.slug, m.label), type: m.type, value: m.value }))
  ];
  const behind = isAttackFromBehind(me.zone, to.zone, to.heading ?? target.data.heading);
  if (tstats.offGuard || behind || offGuardAgainst(target.data.effects, ctx.shipUuid))
    acMods.push({ label: behind ? modLabel("behind") : modLabel("offGuard"), type: "circumstance", value: -2 });
  const consumed = consumedByStrike(target.data.effects, ctx.shipUuid);
  return {
    mods,
    acMods,
    baseAC: tstats.ac,
    ac: tstats.ac + stackModifiers(acMods).total,
    distance,
    behind,
    tooFar: rp.tooFar,
    consumed,
    total: stackModifiers(mods).total
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
  const res = await rollNativeCheck({
    statistic: ctx.options.npcStrike ? npcStatistic(ctx, weapon) : statistic,
    dc,
    label: `${ct(weapon.name)} — ${ctx.ship.name}`,
    actor: ctx.crew ?? ctx.ship,
    extraModifiers: mods,
    extraRollOptions: [
      "starship-strike",
      ...(weapon.traits ?? []).map((t) => `item:trait:${String(t).toLowerCase().replace(/\s+/g, "-")}`)
    ],
    modifierOnly: base + stackModifiers(mods).total
  });
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
export function sheetAttackBonus(crew, weapon) {
  if (weapon?.npc) return Number.isFinite(weapon.attack) ? weapon.attack : null;
  try {
    const st = buildCrewAttack(crew, weapon);
    const v = st?.check?.mod ?? st?.mod;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
export function knownAttackBonus(ctx, weapon) {
  if (ctx.options?.npcStrike || weapon?.npc) return Number.isFinite(weapon?.attack) ? { value: weapon.attack, source: "statblock" } : null;
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
    return new Ctor(ctx.ship, {
      slug: "starship-strike",
      label: ct(weapon.name),
      domains: ["attack", "attack-roll", "ranged-attack-roll"],
      modifiers: [
        new game.pf2e.Modifier({ slug: "base", label: T("SF2eTSC.mods.statblock"), modifier: weapon.attack ?? 0, type: "untyped" })
      ],
      check: { type: "attack-roll" }
    });
  } catch (err) {
    log.warn("npc attack statistic failed", err);
    return null;
  }
}
function buildCrewAttack(crew, weapon) {
  const Ctor = crew?.skills?.acrobatics?.constructor ?? crew?.perception?.constructor;
  if (!Ctor) return null;
  const category = weapon.category ?? "martial";
  const rank = crew.system?.proficiencies?.attacks?.[category]?.rank ?? crew.system?.proficiencies?.attacks?.martial?.rank ?? 1;
  try {
    return new Ctor(crew, {
      slug: "starship-strike",
      label: ct(weapon.name),
      attribute: "dex",
      rank,
      domains: ["attack", "attack-roll", "ranged-attack-roll", "dex-attack-roll", "starship-strike"],
      modifiers: [],
      check: { type: "attack-roll" }
    });
  } catch (err) {
    log.warn("crew attack statistic failed", err);
    return null;
  }
}

export function damageFormula(ctx, weapon, crit) {
  if (weapon.npc) return crit ? `(${weapon.formula})*2` : weapon.formula;
  const dice = ctx.stationRow?.damageDice ?? 1;
  const [n, faces] = String(weapon.die).split("d").map(Number);
  const boost = effectModifiers(
    ctx.data.effects.filter((e) => !e.station || e.station === ctx.station?.id),
    "station-damage"
  ).reduce((a, m) => a + m.value, 0);
  const base = `${n * dice}d${faces}${boost ? `+${boost}` : ""}`;
  return crit ? `(${base})*2` : base;
}
async function rollDamage(ctx, formula, flavor) {
  const roll = await new Roll(formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: ctx.ship }), flavor });
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
  ctx.lines.push(...res.lines);
  ctx.degreeLabel = DEGREE_LABEL(res.degree);
  ctx.degree = res.degree;
  if (res.degree < DEGREE.SUCCESS) {
    ctx.reports.push(T("SF2eTSC.chat.miss"));
    return;
  }
  const crit = res.degree === DEGREE.CRITICAL_SUCCESS;
  if (ctx.options.sheetRoll) {
    // sheet roll: attack roll, damage roll and damage application are three separate steps (§8). The target is
    // bound here on the GM side; the card can only roll/apply damage for exactly this target, once.
    const traitsL = (weapon.traits ?? []).map((t) => String(t).toLowerCase());
    ctx.pendingDamage = {
      damageParts: weapon.npc ? weapon.damageParts : null,
      formula: damageFormula(ctx, weapon, false),
      critFormula: damageFormula(ctx, weapon, true),
      crit,
      damageType: weapon.damageType,
      extraTypes: (weapon.damageParts ?? []).slice(1).map((p) => p.type),
      traits: traitsL,
      targetUuid: target.uuid,
      targetKey: target.key,
      source: weapon.name
    };
    ctx.reports.push(T("SF2eTSC.rolls.damagePending"));
    return;
  }
  let amount = await rollDamage(ctx, damageFormula(ctx, weapon, crit), `${ct(weapon.name)}: ${T("SF2eTSC.chat.damage")}`);
  const traits = (weapon.traits ?? []).map((t) => String(t).toLowerCase());
  // reaction window (Reposition Shield, Drone Block, ...) before damage is applied to a player ship
  const rx = await Reactions.ask(ctx, target, { amount, traits, crit });
  const dmgTraits = traits.includes("bypassing") || rx.bypassHull ? [...traits, "bypassing"] : traits;
  if (rx.resistance) amount = Math.max(0, amount - rx.resistance);
  if (rx.shieldAbsorb) {
    const sp = (await ctx.draft.ship(target.uuid)).data.sp.value;
    const absorbed = Math.min(amount, rx.shieldAbsorb === "full" ? sp : Math.floor(sp / 2));
    amount -= absorbed;
    ctx.reports.push(T("SF2eTSC.chat.shieldAbsorbed", { amount: absorbed }));
  }
  const dmg = await applyDamageInDraft(ctx.draft, target.uuid, {
    amount,
    damageType: weapon.damageType,
    traits: dmgTraits,
    criticalHit: crit,
    source: ct(weapon.name),
    attackLine: null,
    silent: !!ctx.cardMode
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

/** Area Fire / Auto-Fire: damage once, each starship in the area makes a basic Reflex save vs the crew's class DC. */
export async function resolveAreaFire(ctx, kind) {
  const weapon = resolveWeapon(ctx);
  if (!weapon) throw new Error(T("SF2eTSC.errors.noWeapon"));
  ctx.weapon = weapon;
  const me = findObject(ctx.tsc, ctx.shipUuid);
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
  const { hit: targets, excluded } = areaTargets(ctx.tsc.objects, zones, ctx.shipUuid, ctx.options.areaExcludeKeys);
  if (excluded.length) ctx.lines.push({ label: T("SF2eTSC.chat.areaExcluded"), value: String(excluded.length) });
  if (!targets.length) {
    ctx.reports.push(T("SF2eTSC.chat.noTargetsInArea", { zones: zones.join(", ") }));
    return;
  }
  const baseDC = crewClassDC(ctx.crew) + (ctx.stats.areaDCModifier ?? 0);
  const total = await rollDamage(ctx, damageFormula(ctx, weapon, false), `${ct(weapon.name)}: ${T("SF2eTSC.chat.damage")}`);
  ctx.lines.push({
    label: T("SF2eTSC.chat.area"),
    value: `${T(`SF2eTSC.areaTypes.${area.type}`)} ${area.value} — ${T("SF2eTSC.ui.zone")} ${zones.join(", ")}`
  });
  for (const o of targets) {
    const entry = await ctx.draft.ship(o.key);
    if (entry.data.destroyed) continue;
    const lockOn = effectModifiers(effectsAgainst(entry.data.effects, ctx.shipUuid), "reflex-against-area").reduce(
      (a, m) => a + m.value,
      0
    );
    const stat = shipStatistic(entry.actor, "reflex");
    const res = await rollNativeCheck({
      statistic: stat,
      dc: baseDC,
      label: `${entry.actor.name}: ${T("SF2eTSC.ui.reflex")}`,
      actor: entry.actor,
      extraModifiers: lockOn ? [{ slug: "tsc-lock-on", label: modLabel("lockOn"), type: "circumstance", value: lockOn }] : [],
      modifierOnly: computeShipStats(entry.actor).reflex + lockOn
    });
    const mult = basicSaveMultiplier(res.degree);
    const amount = Math.floor(total * mult);
    if (amount > 0) {
      const dmg = await applyDamageInDraft(ctx.draft, o.key, {
        amount,
        damageType: weapon.damageType,
        traits: weapon.traits.map((t) => String(t).toLowerCase()),
        criticalHit: res.degree === DEGREE.CRITICAL_FAILURE,
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
