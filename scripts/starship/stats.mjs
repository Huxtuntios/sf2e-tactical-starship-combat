import { stackModifiers } from "../engine/stacking.mjs";
import { effectModifiers, hasCondition, stationEffects, offGuardAgainst } from "./effects.mjs";
import { manualModifierSlug } from "./native-effect-adapter.mjs";
import { nativeConditionModifiers, nativeHasCondition } from "./native-condition-adapter.mjs";
import { isStarship, readStarship } from "./starship-state.mjs";
import { Content } from "../content/loader.mjs";
import { log } from "../utils/logging.mjs";
import { DEGREE } from "../constants.mjs";
import { degreeOfSuccess } from "../engine/degree.mjs";
/** Localized label with an English fallback (stats are also used by pure unit tests without i18n). */
const L = (key, fallback) => (globalThis.game?.i18n?.has?.(`SF2eTSC.${key}`) ? globalThis.game.i18n.localize(`SF2eTSC.${key}`) : fallback);

const mod = (type, value, label) => ({ type, value, label });

/** Item bonuses granted by helmed stations (passive benefits remain even while a station is malfunctioning). */
function helmedBonuses(data) {
  const out = { ac: [], fortitude: [], reflex: [], will: [], sensorRange: 0 };
  for (const st of data.stations) {
    const def = Content.stations.get(st.type);
    const row = def?.advancement?.find((r) => r.grade === st.grade);
    if (!row) continue;
    if (st.type === "scanners") out.sensorRange += row.sensorIncrease ?? 0; // scanners always add to sensor range
    if (!st.helmedBy) continue;
    if (row.helmedAC) out.ac.push(mod("item", row.helmedAC, def.name));
    if (row.helmedReflex) out.reflex.push(mod("item", row.helmedReflex, def.name));
    if (row.helmedFortitude) out.fortitude.push(mod("item", row.helmedFortitude, def.name));
    if (row.helmedWill) out.will.push(mod("item", row.helmedWill, def.name));
  }
  return out;
}

/**
 * Piloting DC of the crew member helming the pilot's console: 10 + the pilot's Piloting modifier (starship AC equals it
 * if higher). null while nobody helms the console or the pilot has no Piloting skill.
 */
export function pilotingDC(data) {
  const st = data.stations.find((s) => s.type === "pilot" && s.helmedBy);
  if (!st) return null;
  const crew = fromUuidSync(st.helmedBy);
  const dc = crew?.skills?.piloting?.dc?.value;
  if (Number.isFinite(dc)) return dc;
  const m = crew?.skills?.piloting?.mod ?? crew?.skills?.piloting?.check?.mod;
  return Number.isFinite(m) ? 10 + m : null;
}

// Broad native selectors already belong to the primary statistic; aliases add only explicit modifiers.
function explicitEffectModifiers(effects, selector, context) {
  return effects.flatMap((effect) => {
    if (!effect.manual) return effectModifiers([effect], selector, context);
    const slugs = (effect.modifiers ?? []).flatMap((m, index) =>
      m.selector === selector ? [m.slug ?? manualModifierSlug(effect.id, index)] : []
    );
    return slugs.length ? effectModifiers([effect], selector, context).filter((m) => slugs.includes(m.slug)) : [];
  });
}

export function shipModifiers(actor, selector, context = {}) {
  const data = context.data ?? readStarship(actor);
  const fx = data.effects ?? [];
  const scope = { actor, statistic: ["ac", "area-dc"].includes(selector) ? "dc" : "check", ...context, selector };
  const legacy = fx.filter((e) => !e.manual);
  const helm = helmedBonuses(data);
  const out = (helm[selector] ?? []).map((m, i) => ({ ...m, slug: `tsc-helm-${selector}-${i}` }));
  const inoperable =
    data.inoperable || data.compromised > 0 || hasCondition(fx, "inoperable", scope) || hasCondition(fx, "compromised", scope);
  if (
    (data.inoperable || data.compromised > 0 || hasCondition(legacy, "inoperable", scope) || hasCondition(legacy, "compromised", scope)) &&
    ["ac", "perception", "reflex"].includes(selector)
  )
    out.push({ slug: "tsc-inoperable", ...mod("status", -4, L("mods.inoperable", "Inoperable")) });
  if ((data.offKilter || hasCondition(legacy, "off-kilter", scope)) && ["attack", "reflex", "area-dc"].includes(selector))
    out.push({ slug: "tsc-off-kilter", ...mod("circumstance", -2, L("mods.offKilter", "Off-Kilter")) });
  if (
    selector === "ac" &&
    (inoperable ||
      context.offGuard ||
      (context.againstUuid ? offGuardAgainst(legacy, context.againstUuid, scope) : hasCondition(legacy, "off-guard", scope)))
  )
    out.push({ slug: "tsc-off-guard", ...mod("circumstance", -2, L("mods.offGuard", "Off-Guard")) });
  out.push(
    ...(selector === "station-check"
      ? explicitEffectModifiers(stationEffects(fx, context.stationId, context.combat, scope), selector, scope)
      : effectModifiers(fx, selector, scope))
  );
  if (context.againstUuid && selector === "ac") out.push(...explicitEffectModifiers(fx, "ac-against-strikes", scope));
  if (context.againstUuid && selector === "reflex" && context.area) out.push(...explicitEffectModifiers(fx, "reflex-against-area", scope));
  if (context.stationId && context.includeStationCheck)
    out.push(...explicitEffectModifiers(stationEffects(fx, context.stationId, context.combat, scope), "station-check", scope));
  out.push(
    ...(data.customModifiers ?? []).filter((m) => m.selector === selector).map((m, i) => ({ ...m, slug: `tsc-custom-${selector}-${i}` }))
  );
  return out;
}

export function modifierTotal(modifiers, options = new Set()) {
  const Native = globalThis.game?.pf2e?.StatisticModifier;
  if (!Native) return stackModifiers(modifiers);
  const result = new Native(
    "starship",
    modifiers.map((m, i) =>
      typeof m.clone === "function"
        ? m.clone()
        : newModifier({
            slug: m.slug ?? `tsc-modifier-${i}`,
            label: m.label ?? m.slug ?? L("mods.starship", "Starship"),
            modifier: m.value,
            type: m.type ?? "untyped"
          })
    ),
    options
  );
  return {
    total: result.totalModifier,
    applied: result.modifiers.filter((m) => m.enabled).map((m) => ({ slug: m.slug, label: m.label, type: m.type, value: m.modifier }))
  };
}

export function shipAC(actor, context = {}) {
  const data = context.data ?? readStarship(actor);
  const base = Math.max(data.ac, pilotingDC(data) ?? 0);
  const native = actor.armorClass?.dc ?? actor.armorClass ?? actor.getStatistic?.("ac")?.dc;
  const components = shipModifiers(actor, "ac", context);
  const pilotStation = data.stations.find((station) => station.type === "pilot" && station.helmedBy);
  const pilot = pilotStation ? fromUuidSync(pilotStation.helmedBy)?.skills?.piloting?.dc : null;
  if (pilot?.modifiers && pilot.value >= data.ac) {
    const donor = pilot.modifiers.map((modifier) => {
      const copy = modifier.clone?.() ?? { ...modifier };
      if (!copy.slug?.startsWith("tsc-")) copy.slug = `tsc-pilot-${copy.slug}`;
      return copy;
    });
    const source = actor._source?.system?.attributes?.ac?.value;
    const adjustment = native?.modifiers ? -(Number.isFinite(source) ? source : native.value) + 10 : 0;
    const result = modifierTotal(
      [
        ...(native?.modifiers ?? []),
        ...donor,
        { slug: "tsc-ac-base-adjust", type: "untyped", value: adjustment },
        ...components.filter((component) => !donor.some((modifier) => modifier.slug === component.slug))
      ],
      new Set([...(native?.options ?? []), ...(pilot.options ?? [])])
    );
    return { value: 10 + result.total, base, applied: result.applied };
  }
  if (native?.modifiers) {
    const nativeMods = native.modifiers;
    const source = actor._source?.system?.attributes?.ac?.value;
    const adjustment = base - (Number.isFinite(source) ? source : native.value);
    const result = modifierTotal(
      [...nativeMods, { slug: "tsc-ac-base-adjust", type: "untyped", value: adjustment }, ...components],
      native.options
    );
    return { value: 10 + result.total, base, applied: result.applied };
  }
  const Ctor = statisticCtor(actor);
  if (Ctor) {
    const stat = new Ctor(actor, {
      slug: "starship-ac",
      label: L("ui.ac", "AC"),
      domains: ["all", "dex-based", "ac"],
      modifiers: [{ slug: "tsc-ac-base", type: "untyped", value: base - 10 }, ...components].map((m) =>
        newModifier({ ...m, modifier: m.value, label: m.label ?? m.slug })
      ),
      dc: { domains: ["ac"] }
    });
    return { value: stat.dc.value, base, applied: components };
  }
  const result = modifierTotal(components);
  return { value: base + result.total, base, applied: result.applied };
}

export function computeShipStats(actor, context = {}) {
  const data = context.data ?? readStarship(actor);
  const helm = helmedBonuses(data);
  const fx = data.effects ?? [];
  const includeNativeConditions = context.includeNativeConditions !== false;
  const scope = { ...context, selector: "ac" };
  const inoperable = !!(
    data.inoperable ||
    data.compromised > 0 ||
    hasCondition(fx, "inoperable", scope) ||
    hasCondition(fx, "compromised", scope)
  );
  const total = (selector) =>
    modifierTotal([
      ...shipModifiers(actor, selector, context),
      ...(includeNativeConditions ? nativeConditionModifiers(actor, selector, context) : [])
    ]);
  const aggregate = (slug) => {
    const base = shipStoredValue(actor, slug, context);
    if (base == null) return null;
    const native = slug === "perception" ? actor.perception : SHIP_SAVE_SLUGS.includes(slug) ? actor.saves?.[slug] : actor.skills?.[slug];
    if (includeNativeConditions && actor.type === "npc" && native) return shipModuleValue(actor, slug, context);
    return base + total(slug).total;
  };
  const acBase = Math.max(data.ac, pilotingDC(data) ?? 0);
  const nativeAC = actor.armorClass?.dc ?? actor.armorClass ?? actor.getStatistic?.("ac")?.dc;
  const pilotStation = data.stations.find((station) => station.type === "pilot" && station.helmedBy);
  const pilot = pilotStation ? fromUuidSync(pilotStation.helmedBy)?.skills?.piloting?.dc : null;
  const ac =
    (includeNativeConditions && nativeAC?.modifiers) || (pilot?.modifiers && pilot.value >= data.ac)
      ? shipAC(actor, context)
      : (() => {
          const result = total("ac");
          return { value: acBase + result.total, base: acBase, applied: result.applied };
        })();
  const fort = total("fortitude"),
    ref = total("reflex"),
    will = total("will");
  return {
    ac: ac.value,
    pilotingDC: pilotingDC(data),
    fortitude: aggregate("fortitude"),
    reflex: aggregate("reflex"),
    will: aggregate("will"),
    perception: aggregate("perception"),
    speed: Math.max(0, data.speed + total("speed").total),
    sensorRange: data.sensorRange == null ? null : data.sensorRange + helm.sensorRange,
    attackModifier: total("attack").total,
    areaDCModifier: total("area-dc").total,
    offGuard: hasCondition(fx, "off-guard", scope) || (includeNativeConditions && nativeHasCondition(actor, "off-guard")) || inoperable,
    offKilter: !!(data.offKilter || hasCondition(fx, "off-kilter", { ...context, selector: "attack" })),
    inoperable,
    breakdown: { ac: ac.applied, fortitude: fort.applied, reflex: ref.applied, will: will.applied }
  };
}
export const shipDC = (stats, slug) => (slug === "ac" ? stats.ac : 10 + (stats[slug] ?? 0));

export function targetStatistic(actor, slug) {
  if (actor?.type !== "hazard") return shipStatistic(actor, slug);
  if (slug === "perception") return actor.perception ?? actor.getStatistic?.("perception") ?? null;
  return actor.saves?.[slug] ?? actor.getStatistic?.(slug) ?? null;
}

export function targetSaveModifier(actor, slug) {
  if (actor?.type !== "hazard") return computeShipStats(actor)[slug];
  return Number(actor.system?.saves?.[slug]?.value ?? actor.saves?.[slug]?.mod ?? 0);
}

export function targetArmorClass(actor) {
  if (actor?.type !== "hazard") return computeShipStats(actor).ac;
  return Number(actor.system?.attributes?.ac?.value ?? 0);
}

/* ------------------------------------------------------------------ rolling helpers (native SF2e pipeline first) */
/**
 * Chat visibility of a secret check. Foundry v14 calls the modes `messageMode` ("gm"), older code and systems still read
 * `rollMode` ("gmroll"): both are passed so a secret roll is never published by accident. A normal roll passes nothing,
 * so it follows the player's own chat roll-mode selector.
 */
export const secretVisibility = (secret) => (secret ? { messageMode: "gm", rollMode: "gmroll" } : {});

/** Serialize the system's click-event roll behavior before a request is sent to the GM. */
export function rollEventOptions(event, type = "check") {
  if (!event || typeof event.shiftKey !== "boolean") return {};
  const setting = type === "damage" ? "showDamageDialogs" : "showCheckDialogs";
  const showByDefault = !!globalThis.game?.user?.settings?.[setting];
  const options = { skipDialog: event.shiftKey ? showByDefault : !showByDefault };
  const defaultMessageMode = globalThis.game?.settings?.get?.("core", "messageMode");
  if (typeof defaultMessageMode === "string" && Object.hasOwn(globalThis.CONFIG?.ChatMessage?.modes ?? {}, defaultMessageMode))
    options.messageMode = defaultMessageMode;
  if (event.ctrlKey || event.metaKey) options.messageMode = game.user.isGM ? "gm" : "blind";
  return options;
}

function statisticCtor(actor) {
  return actor?.saves?.fortitude?.constructor ?? actor?.skills?.acrobatics?.constructor ?? actor?.perception?.constructor ?? null;
}
function newModifier(data) {
  return new game.pf2e.Modifier(data);
}

/**
 * Roll a check using the native Statistic.check.roll pipeline. Falls back to a plain d20 roll + chat message only if the
 * native pipeline is unavailable for that actor (kept deliberately small).
 * @returns {Promise<{degree:number,total:number,natural:number|null,roll:Roll|null,native:boolean}|null>}
 */
export async function rollNativeCheck({
  statistic,
  dc,
  label,
  extraModifiers = [],
  extraRollOptions = [],
  secret = false,
  actor = null,
  modifierOnly = null,
  skipDialog,
  event = null,
  messageMode,
  createMessage = true,
  onMessage = null
}) {
  if (statistic && typeof statistic.check?.roll === "function") {
    const stat = extraModifiers.length
      ? statistic.clone({
          modifiers: extraModifiers.map((m) =>
            newModifier({
              slug: m.slug ?? `tsc-${m.label ?? "mod"}`.toLowerCase().replace(/\s+/g, "-"),
              label: m.label ?? L("mods.modifier", "Modifier"),
              modifier: m.value,
              type: m.type ?? "untyped"
            })
          )
        })
      : statistic;
    const roll = await stat.check.roll({
      dc: typeof dc === "number" ? { value: dc } : (dc ?? undefined),
      extraRollOptions: ["starship", ...extraRollOptions],
      createMessage,
      ...(onMessage
        ? {
            callback: async (_roll, _outcome, message) => {
              await onMessage(message);
            }
          }
        : {}),
      skipDialog,
      event: event ?? undefined,
      messageMode,
      label,
      ...secretVisibility(secret)
    });
    if (!roll) return null;
    return {
      degree: roll.degreeOfSuccess ?? (dc == null ? null : degreeOfSuccess(roll.total, dc?.value ?? dc)),
      total: roll.total,
      natural: roll.dice?.[0]?.total ?? null,
      roll,
      native: true
    };
  }
  if (statistic && onMessage && createMessage)
    throw new Error(
      L("attackCard.nativeRollNotCompleted", "The system attack roll did not complete. Check chat and ship state before retrying.")
    );
  // fallback: plain roll
  const mod_ = modifierOnly ?? statistic?.check?.mod ?? statistic?.mod ?? 0;
  const roll = await new Roll(`1d20 + ${mod_}`).evaluate();
  const natural = roll.dice[0].total;
  const dcv = typeof dc === "number" ? dc : dc?.value;
  const degree = dcv == null ? null : degreeOfSuccess(roll.total, dcv, natural);
  const degreeText = degree == null ? "" : ` — ${L(`degree.${["criticalFailure", "failure", "success", "criticalSuccess"][degree]}`, "")}`;
  const dcText = dcv == null ? "" : ` (${L("ui.dcShort", "DC")} ${dcv})`;
  if (createMessage) {
    const message = await roll.toMessage(
      { speaker: ChatMessage.getSpeaker({ actor }), flavor: `${label ?? L("ui.check", "Check")}${dcText}${degreeText}` },
      { create: true, ...secretVisibility(secret) }
    );
    if (onMessage) await onMessage(message);
  }
  return { degree, total: roll.total, natural, roll, native: false };
}

/** Flat check (hull integrity). Uses the system's flat check pipeline when possible. */
export async function rollFlatCheck({ actor, dc, label, secret = false }) {
  const Ctor = statisticCtor(actor);
  if (Ctor) {
    try {
      const stat = new Ctor(actor, {
        slug: "hull-integrity",
        label,
        domains: ["flat-check"],
        modifiers: [],
        check: { type: "flat-check" }
      });
      const roll = await stat.check.roll({
        dc: { value: dc },
        createMessage: true,
        skipDialog: true,
        label,
        extraRollOptions: ["starship", "hull-integrity"],
        ...secretVisibility(secret)
      });
      if (roll)
        return {
          degree: roll.degreeOfSuccess ?? degreeOfSuccess(roll.total, dc, roll.dice?.[0]?.total),
          total: roll.total,
          roll,
          native: true
        };
    } catch (err) {
      log.warn("native flat check failed", err);
    }
  }
  const roll = await new Roll("1d20").evaluate();
  const degree = degreeOfSuccess(roll.total, dc, roll.total);
  await roll.toMessage(
    { speaker: ChatMessage.getSpeaker({ actor }), flavor: `${label} (${L("ui.dcShort", "DC")} ${dc})` },
    secretVisibility(secret)
  );
  return { degree, total: roll.total, roll, native: false };
}

const SHIP_SAVE_SLUGS = ["fortitude", "reflex", "will"];
export const skillSlug = (k) =>
  String(k ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
/** Numeric value of a stored ship skill entry (statblock values are FINAL modifiers, not bonuses). */
export function shipSkillValue(skills, slug) {
  for (const [k, v] of Object.entries(skills ?? {})) {
    if (skillSlug(k) !== slug) continue;
    const n = v && typeof v === "object" ? Number(v.base ?? v.mod ?? v.value) : Number(v);
    return v === null || v === "" || !Number.isFinite(n) ? null : n;
  }
  return null;
}
function shipStoredValue(actor, slug, context = {}) {
  const data = context.data ?? readStarship(actor);
  return slug === "perception"
    ? data.perception
    : SHIP_SAVE_SLUGS.includes(slug)
      ? data[slug === "fortitude" ? "fort" : slug]
      : shipSkillValue(data.skills, slug);
}
export function shipModuleValue(actor, slug, context = {}) {
  const base = shipStoredValue(actor, slug, context);
  if (base == null) return null;
  const statistic = shipStatistic(actor, slug, context);
  if (context.statistic === "dc" && Number.isFinite(statistic?.dc?.value)) return statistic.dc.value - 10;
  return statistic?.check?.mod ?? statistic?.mod ?? base + modifierTotal(shipModifiers(actor, slug, context)).total;
}
/** Value stored in the actor's own system data (before system effects), used to compute the module delta. */
function nativeSourceBase(actor, slug) {
  const s = actor?._source?.system;
  if (!s) return null;
  const v = slug === "perception" ? s.perception?.mod : SHIP_SAVE_SLUGS.includes(slug) ? s.saves?.[slug]?.value : s.skills?.[slug]?.base;
  return Number.isFinite(v) ? v : null;
}

// Native source bases and typed modifiers stay separate so system effects retain native stacking.
export function shipStatistic(actor, slug, context = {}) {
  const isSave = SHIP_SAVE_SLUGS.includes(slug),
    isSkill = !isSave && slug !== "perception";
  const value = shipStoredValue(actor, slug, context);
  if (value == null) return null;
  const native = slug === "perception" ? actor.perception : isSave ? actor.saves?.[slug] : actor.skills?.[slug];
  const Ctor = statisticCtor(actor);
  const components = shipModifiers(actor, slug, { ...context, includeStationCheck: false });
  const modifiers = components.map((m, i) =>
    newModifier({ slug: m.slug ?? `tsc-${slug}-${i}`, label: m.label ?? m.slug ?? slug, modifier: m.value, type: m.type ?? "untyped" })
  );
  const checkModifiers = context.includeStationCheck
    ? shipModifiers(actor, "station-check", { ...context, includeStationCheck: false })
    : [];
  const check = {
    modifiers: checkModifiers.map((m, i) =>
      newModifier({ slug: m.slug ?? `tsc-station-${i}`, label: m.label ?? m.slug, modifier: m.value, type: m.type ?? "untyped" })
    )
  };
  const domains = isSave ? [slug, "saving-throw", "all"] : isSkill ? [slug, "skill-check", "all"] : [slug, "perception", "all"];
  if (slug === "reflex") domains.push("dex-based");
  if (native && actor.type === "npc") {
    const base = nativeSourceBase(actor, slug);
    const delta = value - (base ?? native.mod ?? 0);
    if (delta)
      modifiers.unshift(newModifier({ slug: "tsc-ship-adjust", label: L("mods.starship", "Starship"), modifier: delta, type: "untyped" }));
    if (!modifiers.length && !checkModifiers.length) return native;
    return modifiers.length || checkModifiers.length || domains.some((d) => !native.domains?.includes(d))
      ? native.clone({ domains, modifiers, check })
      : native;
  }
  const label = isSkill ? L(`skills.${slug}`, slug) : L(`ui.${slug}`, slug.charAt(0).toUpperCase() + slug.slice(1));
  if (!Ctor) {
    const fallbackCheck = shipModifiers(actor, slug, { ...context, statistic: "check", includeStationCheck: false });
    const fallbackDC = shipModifiers(actor, slug, { ...context, statistic: "dc", includeStationCheck: false });
    const checkMod = value + modifierTotal([...fallbackCheck, ...checkModifiers]).total;
    return {
      slug,
      label,
      domains,
      mod: checkMod,
      check: { mod: checkMod },
      dc: { value: 10 + value + modifierTotal(fallbackDC).total }
    };
  }
  return new Ctor(actor, {
    slug,
    label,
    domains,
    modifiers: [newModifier({ slug: "base", label: L("mods.starship", "Starship"), modifier: value, type: "untyped" }), ...modifiers],
    check: { ...check, type: isSave ? "saving-throw" : isSkill ? "skill-check" : "perception-check" }
  });
}

export function stationStatistic(crew, ship, slug, context = {}) {
  if (!crew || (isStarship(crew) && readStarship(crew).role === "npc"))
    return shipStatistic(crew ?? ship, slug, { ...context, includeStationCheck: true });
  const native = crewStatistic(crew, slug);
  if (!native) return null;
  const components = shipModifiers(ship, slug, { ...context, includeStationCheck: false });
  const boost = explicitEffectModifiers(
    stationEffects((context.data ?? readStarship(ship)).effects, context.stationId, context.combat, context),
    "station-check",
    { ...context, selector: slug, statistic: "check" }
  );
  const convert = (m, i) =>
    newModifier({ slug: m.slug ?? `tsc-station-${i}`, label: m.label ?? m.slug ?? slug, modifier: m.value, type: m.type ?? "untyped" });
  return components.length || boost.length
    ? native.clone({ modifiers: components.map(convert), check: { modifiers: boost.map(convert) } })
    : native;
}

/** Resolve a skill/perception Statistic of a crew member (or of an NPC ship). */
export function crewStatistic(actor, skill) {
  if (!actor) return null;
  if (isStarship(actor) && readStarship(actor).role === "npc") return shipStatistic(actor, skill);
  if (skill === "perception") return actor.perception ?? null;
  return actor.skills?.[skill] ?? actor.getStatistic?.(skill) ?? null;
}
export function crewClassDC(actor) {
  return (
    actor?.classDC?.dc?.value ??
    actor?.getStatistic?.("class-dc")?.dc?.value ??
    actor?.getStatistic?.("class")?.dc?.value ??
    10 + (actor?.level ?? 1) + 4
  );
}
export function shipAreaDC(crew, ship, context = {}) {
  const source = crew ?? (readStarship(ship).role === "npc" ? ship : null);
  const native = source?.classDC ?? source?.getStatistic?.("class-dc") ?? source?.getStatistic?.("class");
  const modifiers = shipModifiers(ship, "area-dc", { ...context, statistic: "dc" });
  if (native?.clone)
    return native.clone({
      modifiers: modifiers.map((m, i) =>
        newModifier({ slug: m.slug ?? `tsc-area-${i}`, label: m.label ?? m.slug, modifier: m.value, type: m.type ?? "untyped" })
      )
    }).dc.value;
  return crewClassDC(source) + modifierTotal(modifiers).total;
}
export function bestSpellStatistic(actor) {
  const entry = actor?.spellcasting?.contents?.find((e) => e.statistic) ?? actor?.spellcasting?.find?.((e) => e.statistic);
  return entry?.statistic ?? null;
}
export { DEGREE };
