import { registerHandler, request } from "../socket.mjs";
import { MODULE_ID } from "../constants.mjs";
import { loadStarship, readStarship, patchStarship, isStarship } from "./starship-state.mjs";
import { actionsForStation, Content } from "../content/loader.mjs";
import { gradeIndex } from "../engine/advancement.mjs";
import { collectNpcActions } from "../actions/npc-rows.mjs";
import { effectModifiers } from "./effects.mjs";
import { crewStatistic, shipModuleValue } from "./stats.mjs";
import { STARSHIP_IMMUNITIES } from "../engine/validation.mjs";
import { safeDiceFormula } from "../content/inline-dice.mjs";
import { sanitizeTiming } from "./effect-timing.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { EFFECT_MECHANICS, normalizeEffectTargets, matchesEffectScope } from "./effect-scopes.mjs";
import {
  getConditionOptions,
  deriveConditionModifiers,
  nativeModifierSelectors,
  createNativeEffect,
  removeNativeEffect
} from "./native-effect-adapter.mjs";

const error = (key, detail = "") => new Error(`${game.i18n.localize(`SF2eTSC.effects.errors.${key}`)}${detail ? `: ${detail}` : ""}`);
const text = (value, max = 240) => typeof value === "string" && value.trim() && value.length <= max;
const id = (value, max = 128) => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= max;
const queues = new Map();
const shipSelection = (targets) =>
  targets.entire ||
  targets.mechanics.length ||
  targets.stations.length ||
  targets.actions.length ||
  targets.weaponAttacks ||
  targets.weapons.length;
const patchOptions = { history: false, announce: false, undoable: false };

function enqueue(shipUuid, operation) {
  const previous = queues.get(shipUuid) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  queues.set(shipUuid, task);
  task
    .finally(() => {
      if (queues.get(shipUuid) === task) queues.delete(shipUuid);
    })
    .catch(() => {});
  return task;
}

function npcActionsForShip(actor, data) {
  return collectNpcActions(data, { actions: Content.actions.values(), get: (id) => Content.actions.get(id) }, (slug, station) => {
    const member = station?.helmedBy ? globalThis.fromUuidSync?.(station.helmedBy) : null;
    return member ? !!crewStatistic(member, slug) : shipModuleValue(actor, slug) !== null;
  });
}

export function getEffectTargetCatalog(actor) {
  const data = readStarship(actor);
  const raw = actor.flags?.[MODULE_ID]?.starship ?? {};
  const crewUuids = new Set(
    [
      ...(data.crew ?? []).map((c) => c.actorUuid),
      ...(raw.crew ?? []).map((c) => c.actorUuid),
      ...(raw.stations ?? []).map((s) => s.helmedBy)
    ].filter(Boolean)
  );
  const crew = [...crewUuids].flatMap((uuid) => {
    const member = globalThis.fromUuidSync?.(uuid);
    return member && !isStarship(member) && ["character", "npc", "familiar"].includes(member.type) ? [{ uuid, label: member.name }] : [];
  });
  const npcActions = data.role === "npc" ? npcActionsForShip(actor, data) : null;
  return {
    mechanics: [...EFFECT_MECHANICS],
    stations: data.stations.map((station) => ({
      id: station.id,
      label: station.name ?? Content.stations.get(station.type)?.name ?? station.id,
      actions: (npcActions
        ? npcActions.filter((entry) => entry.station?.id === station.id && entry.action).map((entry) => entry.action)
        : actionsForStation(station.type, station.grade, gradeIndex, { data, station })
      ).map((action) => ({
        id: action.id,
        label: action.name ?? action.id
      }))
    })),
    weapons: data.weapons.map((weapon) => ({ id: weapon.id, label: weapon.name ?? Content.weapons.get(weapon.ref)?.name ?? weapon.id })),
    crew,
    weaponDefensesSupported: false
  };
}

function validateTargets(input, catalog) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) throw error("invalidTargets");
  input ??= {};
  for (const key of ["entire", "weaponAttacks", "weaponDefenses", "allCrew"])
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw error("invalidTargets", key);
  for (const key of ["mechanics", "stations", "actions", "weapons", "crew"])
    if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 256)) throw error("invalidTargets", key);
  for (const key of ["mechanics", "stations", "weapons", "crew"])
    if ((input[key] ?? []).some((value) => !text(value, 512))) throw error("invalidTargets", key);
  if ((input.actions ?? []).some((action) => !action || !text(action.stationId) || !text(action.actionId)))
    throw error("invalidTargets", "actions");
  const targets = normalizeEffectTargets(input);
  if (targets.mechanics.some((m) => !EFFECT_MECHANICS.includes(m))) throw error("invalidTargets", "mechanics");
  if (targets.stations.some((stationId) => !catalog.stations.some((s) => s.id === stationId)))
    throw error("staleTargets", targets.stations.join(", "));
  if (
    targets.actions.some(
      (action) => !catalog.stations.find((s) => s.id === action.stationId)?.actions.some((a) => a.id === action.actionId)
    )
  )
    throw error("staleTargets", "actions");
  if (targets.weapons.some((weaponId) => !catalog.weapons.some((w) => w.id === weaponId)))
    throw error("staleTargets", targets.weapons.join(", "));
  if (targets.crew.some((uuid) => !catalog.crew.some((c) => c.uuid === uuid))) throw error("staleTargets", targets.crew.join(", "));
  if (targets.weaponDefenses && !catalog.weaponDefensesSupported) throw error("unsupportedWeaponDefenses");
  if (targets.weaponAttacks && !catalog.weapons.length) throw error("noTargets");
  if (targets.allCrew && !catalog.crew.length) throw error("noTargets");
  if (!shipSelection(targets) && !targets.allCrew && !targets.crew.length) throw error("noTargets");
  return targets;
}

function modifierTargetContexts(actor, catalog) {
  const data = readStarship(actor);
  const contexts = ["ac", "ac-against-strikes"].map((selector) => ({ actor, selector, statistic: "dc" }));
  for (const selector of ["fortitude", "reflex", "reflex-against-area", "will", "perception", ...Object.keys(CONFIG.PF2E?.skills ?? {})]) {
    if (shipModuleValue(actor, selector === "reflex-against-area" ? "reflex" : selector) === null) continue;
    contexts.push(...["check", "dc"].map((statistic) => ({ actor, selector, statistic })));
  }
  const actions =
    data.role === "npc"
      ? npcActionsForShip(actor, data)
      : catalog.stations.flatMap((station) =>
          station.actions.map((action) => ({
            station: data.stations.find((entry) => entry.id === station.id),
            action: Content.actions.get(action.id)
          }))
        );
  for (const { station, action: definition } of actions) {
    if (!definition) continue;
    const context = { actor, stationId: station?.id, actionId: definition.id };
    const check = definition.check;
    if (check && check.kind !== "none") {
      const skills =
        check.kind === "targetSave"
          ? [check.dcSkill]
          : check.kind === "perception"
            ? ["perception"]
            : check.skillsByStation
              ? (check.skillsByStation[station?.type] ?? Object.values(check.skillsByStation)[0])
              : (check.skills ?? ["perception"]);
      for (const skill of skills) {
        contexts.push({ ...context, selector: skill, skill, statistic: check.kind === "targetSave" ? "dc" : "check" });
        if (check.kind !== "targetSave") contexts.push({ ...context, selector: "station-check", skill, statistic: "check" });
      }
    }
    if (["strike", "npc-strike", "spell-attack"].includes(definition.builtin))
      contexts.push({
        ...context,
        selector: "attack",
        statistic: "check",
        ability: definition.builtin !== "spell-attack" && definition.strike?.kind !== "melee" ? "dex" : undefined
      });
    if (["area-fire", "auto-fire"].includes(definition.builtin)) contexts.push({ ...context, selector: "area-dc", statistic: "dc" });
  }
  for (const weapon of catalog.weapons) {
    const station =
      data.stations.find((entry) => entry.weaponId === weapon.id) ??
      data.stations.find((entry) => entry.id === data.weapons.find((entry) => entry.id === weapon.id)?.stationId);
    for (const [selector, statistic, actionId] of [
      ["attack", "check", "strike"],
      ["area-dc", "dc", "area-fire"],
      ["station-damage", "check", "strike"]
    ])
      contexts.push({
        actor,
        selector,
        statistic,
        stationId: station?.id,
        actionId,
        weaponId: weapon.id,
        ability: selector === "attack" ? "dex" : undefined
      });
  }
  return contexts;
}

function validateInput(input, actor, catalog) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !id(input.operationId)) throw error("invalidInput");
  if (!["condition", "bonus", "penalty", "persistent-damage"].includes(input.kind)) throw error("invalidInput", "kind");
  if (input.ignoreImmunities !== undefined && typeof input.ignoreImmunities !== "boolean") throw error("invalidInput", "ignoreImmunities");
  if (input.statistic !== undefined && !["check", "dc", "both"].includes(input.statistic)) throw error("invalidInput", "statistic");
  if (input.label !== undefined && !text(input.label)) throw error("invalidInput", "label");
  if (input.sourceUuid != null && !text(input.sourceUuid, 512)) throw error("invalidInput", "sourceUuid");
  const targets = validateTargets(input.targets, catalog);
  const record = {
    id: `manual-${input.operationId}`,
    operationId: input.operationId,
    shipUuid: actor.uuid,
    manual: true,
    kind: input.kind,
    slug: input.slug ?? input.kind,
    label: input.label ?? input.slug ?? input.kind,
    modifiers: [],
    conditions: [],
    targets,
    ignoreImmunities: input.ignoreImmunities === true,
    nativeTargets: [],
    conditionValue: null,
    persistent: null,
    sourceUuid: input.sourceUuid ?? null,
    timing: input.timing ? sanitizeTiming(input.timing, activeStarshipCombat()) : null,
    ...(input.statistic ? { statistic: input.statistic } : {}),
    status: "pending"
  };
  if (input.kind === "condition") {
    const option = getConditionOptions().find((c) => c.slug === input.slug);
    if (!option || input.slug === "persistent-damage") throw error("invalidCondition");
    if (option.valued && (!Number.isInteger(input.conditionValue) || input.conditionValue < 1 || input.conditionValue > 100))
      throw error("invalidConditionValue");
    if (!option.valued && input.conditionValue != null) throw error("invalidConditionValue");
    record.conditionValue = option.valued ? input.conditionValue : null;
    record.stateValue = record.conditionValue;
    if (["wrecked", "compromised"].includes(record.slug) && !targets.entire) throw error("incompatibleStateTargets");
    if (
      record.slug === "malfunctioning" &&
      ((!targets.entire &&
        (!targets.stations.length ||
          targets.mechanics.length ||
          targets.actions.length ||
          targets.weapons.length ||
          targets.weaponAttacks)) ||
        !catalog.stations.length)
    )
      throw error("incompatibleStateTargets");
    record.label = input.label ?? option.label;
    record.conditions = [record.slug, ...(["compromised", "inoperable"].includes(record.slug) ? ["inoperable", "off-guard"] : [])].filter(
      (slug, index, all) => all.indexOf(slug) === index
    );
    if (shipSelection(targets)) {
      if (!option.shipSupported) throw error("incompatibleShipCondition", option.label);
      const data = readStarship(actor);
      const immunities = data.role === "player" || !data.immunities.length ? [...STARSHIP_IMMUNITIES, ...data.immunities] : data.immunities;
      if (["doomed", "unconscious"].includes(record.slug)) throw error("incompatibleShipCondition", option.label);
      if (!record.ignoreImmunities && immunities.includes(record.slug)) throw error("shipImmune", option.label);
      const selectors = [
        "ac",
        "fortitude",
        "reflex",
        "will",
        "perception",
        "attack",
        "area-dc",
        "station-check",
        ...Object.keys(CONFIG.PF2E?.skills ?? {})
      ];
      for (const selector of selectors)
        record.modifiers.push(...deriveConditionModifiers(record.slug, record.conditionValue, { actor, selector }));
      if (!["off-kilter", "inoperable", "compromised", "wrecked", "malfunctioning"].includes(record.slug)) {
        const contexts = [
          ...selectors.map((selector) => ({ actor, selector })),
          ...catalog.stations.flatMap((station) =>
            station.actions.flatMap((action) => {
              const definition = Content.actions.get(action.id);
              return (definition?.check?.skills ?? []).map((skill) => ({
                actor,
                selector: skill,
                skill,
                stationId: station.id,
                actionId: action.id
              }));
            })
          ),
          ...catalog.weapons.map((weapon) => ({
            actor,
            selector: "attack",
            weaponId: weapon.id,
            stationId: data.weapons.find((w) => w.id === weapon.id)?.stationId,
            actionId: "strike"
          }))
        ];
        if (
          !contexts.some(
            (context) =>
              matchesEffectScope({ ...record, status: "active" }, context) &&
              deriveConditionModifiers(record.slug, record.conditionValue, context).length
          )
        )
          throw error("incompatibleShipCondition", option.label);
      }
    }
    if ((targets.allCrew || targets.crew.length) && !option.nativeCrew) throw error("incompatibleCrewCondition", option.label);
  } else if (input.kind === "persistent-damage") {
    const persistent = input.persistent;
    if (
      !persistent ||
      typeof persistent.formula !== "string" ||
      !safeDiceFormula(persistent.formula) ||
      !Object.hasOwn(CONFIG.PF2E?.damageTypes ?? {}, persistent.damageType)
    )
      throw error("invalidPersistentDamage");
    if (persistent.dc !== undefined && (!Number.isInteger(persistent.dc) || persistent.dc < 1 || persistent.dc > 50))
      throw error("invalidPersistentDamage");
    if (persistent.criticalHit !== undefined && typeof persistent.criticalHit !== "boolean") throw error("invalidPersistentDamage");
    if (shipSelection(targets) && !targets.entire) throw error("incompatiblePersistentTargets");
    record.slug = "persistent-damage";
    record.label = input.label ?? game.i18n.localize("SF2eTSC.persistent.label");
    if (shipSelection(targets)) {
      const condition = game.pf2e?.ConditionManager?.getCondition(record.slug);
      if (!condition) throw error("nativeUnavailable");
      if (actor.isAffectedBy?.(condition) === false) throw error("incompatibleShipCondition");
      if (!record.ignoreImmunities && (readStarship(actor).immunities.includes(record.slug) || actor.isImmuneTo?.(condition) === true))
        throw error("shipImmune");
    }
    record.persistent = {
      formula: safeDiceFormula(persistent.formula),
      damageType: persistent.damageType,
      dc: persistent.dc ?? 15,
      criticalHit: persistent.criticalHit ?? false
    };
  } else {
    const modifiers = input.modifiers ?? [{ selector: input.selector ?? "all", type: input.type, value: input.value }];
    if (!Array.isArray(modifiers) || !modifiers.length || modifiers.length > 32) throw error("invalidModifier");
    const selectors = new Set([
      "all",
      "ac",
      "ac-against-strikes",
      "fortitude",
      "reflex",
      "reflex-against-area",
      "will",
      "perception",
      "attack",
      "attack-roll",
      "area-dc",
      "station-check",
      "station-damage",
      "skill-check",
      "saving-throw",
      "ability-check",
      "str-based",
      "dex-based",
      "con-based",
      "int-based",
      "wis-based",
      "cha-based",
      ...Object.keys(CONFIG.PF2E?.skills ?? {})
    ]);
    for (const modifier of modifiers) {
      if (
        !modifier ||
        !selectors.has(modifier.selector) ||
        !["status", "circumstance", "item", "untyped"].includes(modifier.type) ||
        !Number.isInteger(modifier.value) ||
        Math.abs(modifier.value) > 100 ||
        (input.kind === "bonus" ? modifier.value <= 0 : modifier.value >= 0)
      )
        throw error("invalidModifier");
      if (modifier.label !== undefined && !text(modifier.label)) throw error("invalidModifier");
      if (
        (targets.allCrew || targets.crew.length) &&
        ["station-check", "station-damage", "area-dc", "ac-against-strikes", "reflex-against-area"].includes(modifier.selector)
      )
        throw error("incompatibleCrewModifier");
      record.modifiers.push({
        selector: modifier.selector,
        type: modifier.type,
        value: modifier.value,
        label: modifier.label ?? record.label
      });
    }
    if (!targets.allCrew && !targets.crew.length) {
      const contexts = modifierTargetContexts(actor, catalog);
      for (const modifier of record.modifiers)
        if (
          !contexts.some(
            (context) => effectModifiers([{ ...record, status: "active", modifiers: [modifier] }], context.selector, context).length
          )
        )
          throw error("invalidModifier", modifier.selector);
    }
    record.ignoreImmunities = false;
  }
  if (
    (targets.allCrew || targets.crew.length) &&
    ["condition", "persistent-damage"].includes(record.kind) &&
    record.statistic &&
    record.statistic !== "both"
  )
    throw error("incompatibleCrewStatistic");
  return record;
}

function resultFor(record) {
  return {
    applicationId: record.id,
    status: record.status === "active" ? (record.rejectedTargets?.length ? "partial" : "applied") : record.status,
    rejectedTargets: record.rejectedTargets ?? [],
    nativeTargets: record.nativeTargets,
    record
  };
}

async function applyAsGM({ user, payload }) {
  if (!user?.isGM || !game.user.isGM) throw error("gmOnly");
  const actor = await loadStarship(payload.shipUuid);
  return enqueue(actor.uuid, async () => {
    const fingerprint = JSON.stringify(payload.input);
    const previous = readStarship(actor).effectOperations?.find((op) => op.operationId === payload.input?.operationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw error("operationConflict");
      const existing = readStarship(actor).effects.find((e) => e.id === previous.applicationId);
      if (existing && existing.status !== "active")
        throw error(existing.status === "failed" ? "nativeRejected" : "incompleteApplication", existing.id);
      return existing ? resultFor(existing) : { applicationId: previous.applicationId, status: "removed", rejectedTargets: [] };
    }
    let record;
    let crew;
    await patchStarship(
      actor,
      async (data) => {
        const catalog = getEffectTargetCatalog(actor);
        record = validateInput(payload.input, actor, catalog);
        const selected = new Set([...record.targets.crew, ...(record.targets.allCrew ? catalog.crew.map((c) => c.uuid) : [])]);
        crew = await Promise.all(
          [...selected].map(async (uuid) => {
            const member = await fromUuid(uuid);
            if (!member || isStarship(member) || !["character", "npc", "familiar"].includes(member.type)) throw error("staleTargets", uuid);
            return member;
          })
        );
        validateTargets(record.targets, getEffectTargetCatalog(actor));
        if (["bonus", "penalty"].includes(record.kind))
          for (const member of crew) for (const modifier of record.modifiers) nativeModifierSelectors(member, modifier, record.statistic);
        record.nativeTargets = crew.map((member) => ({ actorUuid: member.uuid, itemId: foundry.utils.randomID(16) }));
        record.targetSnapshot = {
          mechanics: [...record.targets.mechanics],
          stations: catalog.stations.filter((station) => record.targets.entire || record.targets.stations.includes(station.id)),
          actions: record.targets.actions.map((action) => ({
            ...action,
            label: catalog.stations.find((s) => s.id === action.stationId).actions.find((a) => a.id === action.actionId).label
          })),
          weapons: catalog.weapons.filter(
            (weapon) => record.targets.entire || record.targets.weaponAttacks || record.targets.weapons.includes(weapon.id)
          ),
          crew: catalog.crew.filter((member) => selected.has(member.uuid))
        };
        data.effects.push(record);
        (data.effectOperations ??= []).push({ operationId: record.operationId, applicationId: record.id, fingerprint });
      },
      patchOptions
    );
    const rejectedTargets = [];
    let successes = 0;
    for (const member of crew) {
      const handle = record.nativeTargets.find((target) => target.actorUuid === member.uuid);
      try {
        const item = await createNativeEffect(member, { ...record, nativeItemId: handle.itemId });
        if (item.id !== handle.itemId) throw error("nativeIdentityMismatch", member.name);
        successes++;
      } catch (err) {
        rejectedTargets.push({ actorUuid: member.uuid, label: member.name, error: err.message });
      }
    }
    await patchStarship(
      actor,
      (data) => {
        const current = data.effects.find((e) => e.id === record.id);
        if (!current) throw error("applicationNotFound");
        validateTargets(record.targets, getEffectTargetCatalog(actor));
        current.rejectedTargets = rejectedTargets;
        current.nativeTargets = record.nativeTargets.filter((handle) =>
          crew.find((member) => member.uuid === handle.actorUuid)?.items.has(handle.itemId)
        );
        current.status = shipSelection(record.targets) || successes ? "active" : "failed";
        record = current;
      },
      patchOptions
    );
    if (rejectedTargets.length)
      ui.notifications?.warn?.(`${error("nativeRejected").message}: ${rejectedTargets.map((t) => `${t.label} (${t.error})`).join("; ")}`);
    if (record.status === "failed") throw error("nativeRejected", rejectedTargets.map((t) => `${t.label} (${t.error})`).join("; "));
    return resultFor(record);
  });
}

async function removeAsGM({ user, payload }) {
  if (!user?.isGM || !game.user.isGM) throw error("gmOnly");
  if (!id(payload.applicationId, 135)) throw error("invalidInput");
  const actor = await loadStarship(payload.shipUuid);
  return enqueue(actor.uuid, async () => {
    const record = readStarship(actor).effects.find((e) => e.id === payload.applicationId && e.manual);
    if (!record) return { applicationId: payload.applicationId, status: "removed" };
    const failures = [];
    if (record.shipUuid === actor.uuid)
      for (const handle of record.nativeTargets ?? []) {
        try {
          const member = await fromUuid(handle.actorUuid);
          if (member) await removeNativeEffect(member, record, handle.itemId);
        } catch (err) {
          failures.push(`${handle.actorUuid}: ${err.message}`);
        }
      }
    if (failures.length) throw error("nativeRemovalFailed", failures.join("; "));
    await patchStarship(
      actor,
      (data) => {
        data.effects = data.effects.filter((effect) => effect.id !== record.id);
      },
      patchOptions
    );
    return { applicationId: record.id, status: "removed" };
  });
}

export function applyManualEffect(shipUuid, input) {
  return request("applyManualEffect", { shipUuid, input: { ...input, operationId: input?.operationId ?? foundry.utils.randomID(16) } });
}
export function removeManualEffect(shipUuid, applicationId) {
  return request("removeManualEffect", { shipUuid, applicationId });
}
export function cleanupShipEffectTargets(actor) {
  if (!game.user.isGM) throw error("gmOnly");
  return enqueue(actor.uuid, async () => {
    const failures = [];
    for (const record of readStarship(actor).effects.filter((effect) => effect.manual && effect.shipUuid === actor.uuid))
      for (const handle of record.nativeTargets ?? []) {
        try {
          const member = await fromUuid(handle.actorUuid);
          if (member) await removeNativeEffect(member, record, handle.itemId);
        } catch (err) {
          failures.push(`${handle.actorUuid}: ${err.message}`);
        }
      }
    if (failures.length) throw error("nativeRemovalFailed", failures.join("; "));
  });
}

let cleanupHooks;
export function registerApplicationService() {
  registerHandler("applyManualEffect", applyAsGM);
  registerHandler("removeManualEffect", removeAsGM);
  if (cleanupHooks === Hooks) return;
  cleanupHooks = Hooks;
  Hooks.on("deleteActor", (actor) => {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !isStarship(actor)) return;
    cleanupShipEffectTargets(actor).catch((err) => ui.notifications.error(err.message));
  });
}
