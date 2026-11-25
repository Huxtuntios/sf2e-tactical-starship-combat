const error = (key) => new Error(globalThis.game?.i18n?.localize?.(`SF2eTSC.effects.errors.${key}`) ?? `SF2eTSC.effects.errors.${key}`);

export function getConditionOptions() {
  const manager = globalThis.game?.pf2e?.ConditionManager;
  if (!manager) return [];
  return (manager.conditionsSlugs ?? [])
    .filter((slug) => slug !== "persistent-damage")
    .flatMap((slug) => {
      const condition = manager.getCondition(slug);
      return condition ? [{ slug, label: condition.name, valued: condition.system?.value?.isValued === true }] : [];
    });
}

export async function addNativeCondition(actor, slug, value) {
  if (!globalThis.game?.user?.isGM) throw error("gmOnly");
  const option = getConditionOptions().find((condition) => condition.slug === slug);
  if (!option) throw error("invalidCondition");
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

function modifierDomains(selector, context) {
  const domains = new Set(["all", selector]);
  if (selector === "ac") domains.add("dex-based");
  if (["fortitude", "reflex", "will"].includes(selector)) {
    domains.add("saving-throw");
    domains.add(`${selector === "fortitude" ? "con" : selector === "reflex" ? "dex" : "wis"}-based`);
  }
  if (selector === "perception") domains.add("wis-based");
  if (selector === "attack") domains.add("attack-roll");
  if (selector === "speed") domains.add("all-speeds");
  if (selector === "station-check") {
    const skill = context.skill;
    if (skill) domains.add(skill);
  }
  const skill = selector === "station-check" ? context.skill : selector;
  const ability = context.ability ?? globalThis.CONFIG?.PF2E?.skills?.[skill]?.attribute;
  if (ability) domains.add(`${ability}-based`);
  if (skill && Object.hasOwn(globalThis.CONFIG?.PF2E?.skills ?? {}, skill)) domains.add("skill-check");
  return domains;
}

export function nativeConditionModifiers(actor, selector, context = {}) {
  const sources = conditionSources(actor);
  if (!sources.size || !selector) return [];
  const factories = new Set();
  for (const domain of modifierDomains(selector, context))
    for (const factory of actor.synthetics?.modifiers?.[domain] ?? []) factories.add(factory);
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
