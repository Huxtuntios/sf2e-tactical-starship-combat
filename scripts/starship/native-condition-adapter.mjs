export { deriveConditionModifiers, getConditionOptions, manualModifierSlug, modifierSelectorMatches } from "./native-effect-adapter.mjs";

import { getConditionOptions, modifierSelectorMatches } from "./native-effect-adapter.mjs";

const error = (key) => new Error(globalThis.game?.i18n?.localize?.(`SF2eTSC.effects.errors.${key}`) ?? `SF2eTSC.effects.errors.${key}`);

export async function addNativeCondition(actor, slug, value) {
  if (!globalThis.game?.user?.isGM) throw error("gmOnly");
  const option = getConditionOptions().find((condition) => condition.slug === slug);
  if (!option || option.slug === "persistent-damage") throw error("invalidCondition");
  if (typeof actor.increaseCondition !== "function") throw error("nativeUnavailable");
  const conditionValue = option.valued ? value : null;
  if (option.valued && (!Number.isInteger(conditionValue) || conditionValue < 1 || conditionValue > 100))
    throw error("invalidConditionValue");
  const condition = await actor.increaseCondition(slug, option.valued ? { value: conditionValue } : {});
  if (!condition) throw error("nativeRejected");
  return condition;
}

export async function removeNativeCondition(actor, itemId) {
  if (!globalThis.game?.user?.isGM) throw error("gmOnly");
  if (typeof itemId !== "string" || !itemId || itemId.length > 128) throw error("conditionNotFound");
  const condition = actor.items.get(itemId);
  const isCondition = condition
    ? typeof condition.isOfType === "function"
      ? condition.isOfType("condition")
      : condition.type === "condition"
    : false;
  if (!isCondition) throw error("conditionNotFound");
  if (typeof actor.decreaseCondition !== "function") throw error("nativeUnavailable");
  await actor.decreaseCondition(condition, { forceRemove: true });
  if (actor.items.has(itemId)) throw error("nativeRemovalFailed");
  return true;
}

function conditionSources(actor) {
  const sources = new Set();
  for (const item of actor.items?.values?.() ?? []) {
    const isCondition = typeof item.isOfType === "function" ? item.isOfType("condition") : item.type === "condition";
    if (!isCondition || item.active === false) continue;
    if (item.uuid) sources.add(item.uuid);
    if (item.id) sources.add(item.id);
  }
  return sources;
}

function compatibilityModifierDomains(selector, context) {
  const domains = new Set();
  if (!["station-damage", "damage", "speed", "sensor-range"].includes(selector)) domains.add("all");
  if (selector === "speed") domains.add("all-speeds");
  if (selector === "will") domains.add("saving-throw");
  if (selector === "station-check" && context.skill) domains.add(context.skill);
  if (context.ability) domains.add(`${context.ability}-based`);
  return domains;
}

export function nativeConditionModifiers(actor, selector, context = {}) {
  const sources = conditionSources(actor);
  if (!sources.size || !selector) return [];
  const compatibilityDomains = compatibilityModifierDomains(selector, context);
  const domains = Object.keys(actor.synthetics?.modifiers ?? {}).filter(
    (domain) => compatibilityDomains.has(domain) || modifierSelectorMatches(domain, selector, context)
  );
  const factories = new Set();
  for (const domain of domains) for (const factory of actor.synthetics?.modifiers?.[domain] ?? []) factories.add(factory);
  const options = ["starship", ...(context.options ?? actor.getRollOptions?.(["all", selector]) ?? [])];
  return [...factories].flatMap((factory) => {
    const modifier = factory({ test: options });
    if (!modifier || modifier.enabled === false || modifier.ignored || !sources.has(modifier.source)) return [];
    if (!Number.isFinite(modifier.modifier)) return [];
    return [
      {
        selector,
        type: modifier.type,
        value: modifier.modifier,
        label: modifier.label,
        slug: modifier.slug
      }
    ];
  });
}

export function nativeHasCondition(actor, slug) {
  if (typeof actor.hasCondition === "function") return actor.hasCondition(slug);
  return [...(actor.items?.values?.() ?? [])].some(
    (item) =>
      item.active !== false &&
      (typeof item.isOfType === "function" ? item.isOfType("condition") : item.type === "condition") &&
      item.slug === slug
  );
}
