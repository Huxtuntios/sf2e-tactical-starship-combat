export const EFFECT_MECHANICS = Object.freeze(["abilities", "skills", "attacks", "saves", "ac", "defenses"]);

export function normalizeEffectTargets(input = {}) {
  return {
    entire: input.entire ?? true,
    mechanics: [...new Set(input.mechanics ?? [])],
    stations: [...new Set(input.stations ?? [])],
    actions: [
      ...new Map(
        (input.actions ?? []).map((a) => [JSON.stringify([a.stationId, a.actionId]), { stationId: a.stationId, actionId: a.actionId }])
      ).values()
    ],
    weaponAttacks: input.weaponAttacks ?? false,
    weaponDefenses: input.weaponDefenses ?? false,
    weapons: [...new Set(input.weapons ?? [])],
    allCrew: input.allCrew ?? false,
    crew: [...new Set(input.crew ?? [])]
  };
}

export function mechanicForSelector(selector) {
  if (["ac", "ac-against-strikes"].includes(selector)) return "ac";
  if (["fortitude", "reflex", "will", "saving-throw", "reflex-against-area"].includes(selector)) return "saves";
  if (["attack", "attack-roll", "area-dc", "station-damage", "damage"].includes(selector)) return "attacks";
  if (selector === "ability-check" || /^(str|dex|con|int|wis|cha)(-based|-check)?$/.test(selector ?? "")) return "abilities";
  if (
    ["station-check", "skill-check", "perception"].includes(selector) ||
    Object.hasOwn(globalThis.CONFIG?.PF2E?.skills ?? {}, selector ?? "")
  )
    return "skills";
  return null;
}

export function matchesEffectScope(effect, context = {}) {
  if (effect.manual && effect.status && effect.status !== "active") return false;
  if (effect.statistic && effect.statistic !== "both" && context.statistic && effect.statistic !== context.statistic) return false;
  if (effect.against && Object.hasOwn(context, "againstUuid") && effect.against !== context.againstUuid) return false;
  if (!effect.targets) return !context.stationId || !effect.station || effect.station === context.stationId;
  const targets = normalizeEffectTargets(effect.targets);
  if (targets.entire) return true;
  const mechanic = mechanicForSelector(context.selector);
  if (mechanic && targets.mechanics.includes(mechanic)) return true;
  if (targets.mechanics.includes("defenses") && mechanic === "skills" && context.statistic === "dc") return true;
  const check = mechanic && mechanic !== "ac" && !["speed", "sensor-range"].includes(context.selector);
  if (check && context.stationId && targets.stations.includes(context.stationId)) return true;
  if (
    check &&
    context.stationId &&
    context.actionId &&
    targets.actions.some((a) => a.stationId === context.stationId && a.actionId === context.actionId)
  )
    return true;
  const weaponAttack = ["attack", "attack-roll", "area-dc", "station-damage", "damage"].includes(context.selector) && !!context.weaponId;
  return weaponAttack && (targets.weaponAttacks || targets.weapons.includes(context.weaponId));
}

export function applicableEffects(effects, context = {}) {
  const seen = new Set();
  return (effects ?? []).filter((effect) => {
    const key = effect.id ?? effect;
    if (seen.has(key) || !matchesEffectScope(effect, context)) return false;
    seen.add(key);
    return true;
  });
}
