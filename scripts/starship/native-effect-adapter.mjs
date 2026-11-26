import { MODULE_ID } from "../constants.mjs";

const error = (key) => new Error(globalThis.game?.i18n?.localize?.(`SF2eTSC.effects.errors.${key}`) ?? `SF2eTSC.effects.errors.${key}`);
const moduleConditions = [
  { slug: "off-kilter", valued: false },
  { slug: "inoperable", valued: false },
  { slug: "compromised", valued: true },
  { slug: "wrecked", valued: true },
  { slug: "malfunctioning", valued: false }
];

export function getConditionOptions() {
  const manager = globalThis.game?.pf2e?.ConditionManager;
  const native = (manager?.conditionsSlugs ?? [])
    .filter((slug) => slug !== "persistent-damage")
    .map((slug) => {
      const condition = manager.getCondition(slug);
      const rules = condition.system.rules ?? [];
      return {
        slug,
        label: condition.name,
        valued: condition.system.value.isValued,
        nativeCrew: true,
        shipSupported:
          rules.some((r) => r.key === "FlatModifier") &&
          rules.every((r) => r.key === "FlatModifier") &&
          !["doomed", "unconscious", "broken", "prone"].includes(slug)
      };
    });
  return [
    ...moduleConditions.map((c) => ({
      ...c,
      label: game.i18n.localize(`SF2eTSC.conditions.${c.slug}`),
      nativeCrew: false,
      shipSupported: true
    })),
    ...native
  ];
}

function nativeDomains(selector, context) {
  const domains = new Set(["all", selector]);
  if (["ac", "ac-against-strikes", "reflex", "reflex-against-area"].includes(selector)) domains.add("dex-based");
  if (selector === "fortitude") domains.add("con-based");
  if (selector === "will" || selector === "perception") domains.add("wis-based");
  if (["fortitude", "reflex", "will", "reflex-against-area"].includes(selector)) domains.add("saving-throw");
  if (["attack", "attack-roll"].includes(selector)) domains.add("attack-roll");
  if (selector === "ac-against-strikes") domains.add("ac");
  if (selector === "reflex-against-area") domains.add("reflex");
  const skill = selector === "station-check" ? context.skill : selector;
  const ability = context.ability ?? globalThis.CONFIG?.PF2E?.skills?.[skill]?.attribute;
  if (ability) domains.add(`${ability}-based`);
  if (skill && Object.hasOwn(globalThis.CONFIG?.PF2E?.skills ?? {}, skill)) {
    domains.add(skill);
    domains.add("skill-check");
  }
  return domains;
}

export const manualModifierSlug = (applicationId, index) => `tsc-${applicationId}-${index}`;

export function modifierSelectorMatches(selector, requested, context = {}) {
  if (selector === requested) return true;
  if (["station-damage", "damage", "speed", "sensor-range"].includes(requested)) return false;
  return nativeDomains(requested, context).has(selector);
}

export function deriveConditionModifiers(slug, value, context = {}) {
  const selector = context.selector;
  if (!selector || ["speed", "sensor-range", "station-damage", "damage"].includes(selector)) return [];
  if (slug === "off-kilter")
    return ["attack", "reflex", "area-dc"].includes(selector)
      ? [{ selector, type: "circumstance", value: -2, label: game.i18n.localize("SF2eTSC.mods.offKilter") }]
      : [];
  if (["inoperable", "compromised"].includes(slug))
    return ["ac", "perception", "reflex"].includes(selector)
      ? [{ selector, type: "status", value: -4, label: game.i18n.localize("SF2eTSC.mods.inoperable") }]
      : [];
  if (["wrecked", "malfunctioning"].includes(slug)) return [];
  const template = globalThis.game?.pf2e?.ConditionManager?.getCondition(slug);
  if (!template || !context.actor?.clone) throw error("nativeUnavailable");
  const source = template.toObject();
  if ((source.system.rules ?? []).some((r) => r.key !== "FlatModifier")) throw error("incompatibleShipCondition");
  if (source.system.value.isValued) source.system.value.value = value;
  const actor = context.actor.clone({ items: [] }, { keepId: true });
  actor.synthetics.modifiers = {};
  const item = new CONFIG.Item.documentClass(source, { parent: actor });
  const Rule = game.pf2e.RuleElements?.builtin?.FlatModifier;
  if (!Rule) throw error("nativeUnavailable");
  for (const [index, sourceRule] of (source.system.rules ?? []).entries()) {
    const rule = foundry.utils.deepClone(sourceRule);
    if (context.applicationId) rule.slug = manualModifierSlug(context.applicationId, index);
    new Rule(rule, { parent: item }).beforePrepareData();
  }
  const options = [...new Set([...(context.options ?? actor.getRollOptions?.(["all", selector]) ?? []), ...(context.rollOptions ?? [])])];
  return [...nativeDomains(selector, context)].flatMap((domain) =>
    (actor.synthetics.modifiers[domain] ?? []).flatMap((factory) => {
      const modifier = factory({ test: options });
      return modifier && modifier.enabled !== false && !modifier.ignored && Number.isFinite(modifier.modifier)
        ? [
            {
              selector,
              type: modifier.type,
              value: modifier.modifier,
              label: modifier.label,
              ...(context.applicationId ? { slug: modifier.slug } : {})
            }
          ]
        : [];
    })
  );
}

const nativeQueues = new Map();
function nativeQueue(actor, operation) {
  const previous = nativeQueues.get(actor.uuid) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  nativeQueues.set(actor.uuid, task);
  task
    .finally(() => {
      if (nativeQueues.get(actor.uuid) === task) nativeQueues.delete(actor.uuid);
    })
    .catch(() => {});
  return task;
}

export function nativeModifierSelectors(actor, modifier, statistic = "both") {
  const selector = modifier.selector === "attack" ? "attack-roll" : modifier.selector;
  if (statistic === "both") return [selector];
  if (selector === "attack-roll" && statistic === "check") return [selector];
  const statistics = [
    ...new Set(
      [
        actor.getStatistic?.(selector),
        actor.armorClass?.parent,
        actor.perception,
        ...Object.values(actor.saves ?? {}),
        ...Object.values(actor.skills ?? {}),
        ...(actor.synthetics?.statistics?.values?.() ?? [])
      ].filter(Boolean)
    )
  ];
  if (selector === "all" && statistic === "check" && statistics.some((stat) => stat.check?.domains?.includes("check"))) return ["check"];
  const matching = statistics.filter(
    (stat) => selector === "all" || stat.slug === selector || stat.domains?.includes(selector) || stat.dc?.domains?.includes(selector)
  );
  const selectors = [
    ...new Set(
      matching.flatMap((stat) => {
        if (selector === "ac" && statistic === "check") return [];
        const domains = (statistic === "check" ? stat.check : stat.dc)?.domains ?? [];
        const other = (statistic === "check" ? stat.dc : stat.check)?.domains ?? [];
        return domains.filter(
          (domain) => !stat.domains?.includes(domain) && !other.includes(domain) && (statistic !== "check" || domain !== "check")
        );
      })
    )
  ];
  if (!selectors.length) throw error("incompatibleCrewStatistic");
  return selectors;
}

function nativeSource(record, actor) {
  let source;
  if (["condition", "persistent-damage"].includes(record.kind)) {
    const condition = game.pf2e.ConditionManager?.getCondition(record.slug);
    if (!condition) throw error("nativeUnavailable");
    source = condition.toObject();
    if (source.system.value.isValued) source.system.value.value = record.conditionValue;
    source.system.rules = (source.system.rules ?? []).map((rule, index) =>
      rule.key === "FlatModifier" ? { ...rule, slug: manualModifierSlug(record.id, index) } : rule
    );
    if (record.kind === "persistent-damage") source.system.persistent = { ...record.persistent };
  } else {
    source = {
      type: "effect",
      name: record.label,
      img: "icons/svg/aura.svg",
      system: {
        slug: `tsc-${record.id}`,
        level: { value: 0 },
        duration: { unit: "unlimited", value: -1, expiry: null, sustained: false },
        tokenIcon: { show: true },
        rules: (record.modifiers ?? []).map((m, index) => ({
          key: "FlatModifier",
          selector: nativeModifierSelectors(actor, m, record.statistic),
          slug: manualModifierSlug(record.id, index),
          label: m.label ?? record.label,
          type: m.type,
          value: m.value
        }))
      }
    };
  }
  source._id = record.nativeItemId ?? foundry.utils.randomID(16);
  // Native creation replaces expired effects by source identity, including unlinked ones.
  source._stats = { duplicateSource: `${actor.uuid}.Item.${source._id}` };
  source.flags ??= {};
  source.flags[MODULE_ID] = { applicationId: record.id, shipUuid: record.shipUuid ?? null };
  return source;
}

export function createNativeEffect(actor, record) {
  return nativeQueue(actor, async () => {
    if (!game.user.isGM) throw error("gmOnly");
    const source = nativeSource(record, actor);
    const descriptor = Object.getOwnPropertyDescriptor(actor, "isImmuneTo");
    const original = actor.isImmuneTo;
    const override =
      record.ignoreImmunities === true && ["condition", "persistent-damage"].includes(record.kind) && typeof original === "function";
    let available = true;
    if (override) {
      Object.defineProperty(actor, "isImmuneTo", {
        configurable: true,
        writable: true,
        value(item) {
          if (
            available &&
            game.user.isGM &&
            typeof item === "object" &&
            item.parent === actor &&
            item.id === source._id &&
            item.slug === source.system.slug &&
            item.flags?.[MODULE_ID]?.applicationId === record.id
          ) {
            available = false;
            return false;
          }
          return original.call(this, item);
        }
      });
    }
    try {
      const items = await actor.createEmbeddedDocuments("Item", [source], { keepId: true });
      if (items.length !== 1) throw error("nativeRejected");
      return items[0];
    } catch (err) {
      const owned = actor.items.get(source._id);
      if (owned?.flags?.[MODULE_ID]?.applicationId === record.id) err.nativeTargets = [{ actorUuid: actor.uuid, itemId: owned.id }];
      throw err;
    } finally {
      if (override) {
        if (descriptor) Object.defineProperty(actor, "isImmuneTo", descriptor);
        else delete actor.isImmuneTo;
      }
    }
  });
}

export async function removeNativeEffect(actor, record, itemId) {
  if (!game.user.isGM) throw error("gmOnly");
  const item = actor.items.get(itemId);
  if (!item) return true;
  if (item.flags?.[MODULE_ID]?.applicationId !== record.id || item.flags?.[MODULE_ID]?.shipUuid !== (record.shipUuid ?? null))
    throw error("foreignItem");
  await actor.deleteEmbeddedDocuments("Item", [itemId]);
  if (actor.items.has(itemId)) throw error("nativeRemovalFailed");
  return true;
}
