import { Content } from "../content/loader.mjs";
import { gradeAtLeast } from "../engine/advancement.mjs";
import { isFrequencyAvailable, frequencyKey } from "../engine/frequency.mjs";
import { findObject, effectiveDetection } from "../engine/sensor-ops.mjs";
import { observerKeys } from "../sensor/map-model.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { computeShipStats, crewStatistic, shipModuleValue } from "../starship/stats.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { request } from "../socket.mjs";
import { actionLabel } from "../actions/action-engine.mjs";
import { Targeting } from "./targeting.mjs";
import { npcStrikeRange } from "../actions/strike.mjs";
import { T, escapeHtml, moduleSetting, fromUuidSync_ } from "../utils/foundry.mjs";
import { notifyError } from "../utils/logging.mjs";
import { isCardAttack, beginCardTargeting } from "../chat/attack-card.mjs";
import { ct } from "../content/content-i18n.mjs";
import { randomId } from "../utils/ids.mjs";
import { stationEffects } from "../starship/effects.mjs";
import { beginNativeWeaponAttack } from "./native-attack.mjs";
import { eligibleDroneMovements } from "../engine/drone-state.mjs";
import { rollEventOptions } from "../starship/stats.mjs";
import { formatActionResultText } from "../actions/result-text.mjs";
import { sendActionDescriptionToChat } from "./action-controls.mjs";
const CONFIRM_ACTION_IDS = new Set(["deploy-drone", "retrieve-drone", "deploy-starship-mine", "drone-block", "repair-hull-drone"]);
const ATTACK_BUILTINS = new Set(["strike", "npc-strike", "spell-attack"]);
const skillLabel = (s) => {
  const k = `SF2eTSC.skills.${String(s).toLowerCase()}`;
  return game.i18n.has(k) ? T(k) : s;
};

export const COST_ICON = (cost) =>
  cost === "reaction"
    ? "↺"
    : cost === "free"
      ? "◇"
      : Array.isArray(cost)
        ? `◆–${"◆".repeat(Math.max(...cost))}`
        : "◆".repeat(Number(cost) || 1);

export function requiresActionConfirmation(action) {
  if (ATTACK_BUILTINS.has(action?.builtin)) return false;
  if (CONFIRM_ACTION_IDS.has(action?.id)) return true;
  if (["area-fire", "auto-fire", "seek"].includes(action?.builtin)) return true;
  return !!action?.frequency || (action?.effects ?? []).some((effect) => effect?.type && effect.type !== "manual");
}

function actionConsequenceText(action, ctx) {
  const reports = (action.effects ?? []).map((effect) => {
    if (effect.type === "manual") return ct(effect.text);
    if (effect.type === "applyEffect") return ct(effect.effect?.label ?? effect.effect?.slug ?? effect.type);
    if (effect.type === "moveAlongHeading") {
      const speed = effect.zones === "speed" ? computeShipStats(ctx.ship).speed : Number(effect.zones);
      const combat = activeStarshipCombat();
      const object = combat ? findObject(getTsc(combat), ctx.ship.uuid) : null;
      return T("SF2eTSC.ui.moveManual", { speed, zone: object?.zone ?? "—" });
    }
    if (effect.type === "damage") return `${T("SF2eTSC.chat.damage")}: ${effect.dice ?? effect.type}`;
    if (effect.type === "restoreShields") return `${T("SF2eTSC.ui.shieldPoints")}: ${effect.dice ?? effect.type}`;
    if (effect.type === "restoreHull") return `${T("SF2eTSC.ui.hullPoints")}: ${effect.dice ?? effect.type}`;
    if (effect.type === "malfunction") return T("SF2eTSC.ui.malfunctioning");
    if (effect.type === "clearMalfunction") return T("SF2eTSC.chat.repaired");
    if (effect.type === "setOffKilter") return T("SF2eTSC.mods.offKilter");
    if (effect.type === "clearOffKilter") return T("SF2eTSC.chat.offKilterEnded");
    return ct(effect.text ?? effect.type);
  });
  return formatActionResultText({ reports }, { localize: T });
}

async function confirmActionConsequences(action, ctx) {
  const consequences = actionConsequenceText(action, ctx);
  const content = [
    `<p>${escapeHtml(ct(action.text ?? ""))}</p>`,
    consequences ? `<div class="tsc-action-consequences">${escapeHtml(consequences).replace(/\n/g, "<br>")}</div>` : "",
    `<p class="hint">${escapeHtml(T("SF2eTSC.ui.softAutomationHint"))}</p>`
  ].join("");
  return foundry.applications.api.DialogV2.confirm({
    classes: ["sf2e-tsc"],
    window: { title: actionLabel(action) },
    content,
    yes: { label: T("SF2eTSC.ui.execute"), icon: "fa-solid fa-check", callback: () => "confirm" },
    no: { label: T("SF2eTSC.ui.cancel"), icon: "fa-solid fa-xmark", default: true, callback: () => "cancel" },
    buttons: [{ action: "edit", label: T("SF2eTSC.ui.editOptions"), icon: "fa-solid fa-pen", callback: () => "edit" }],
    rejectClose: false
  }).catch(() => "cancel");
}

/** Client-side availability preview (the GM re-validates everything authoritatively). */
export function previewAction(action, { ship, crew, station, combat = activeStarshipCombat() }) {
  const reasons = [];
  const data = readStarship(ship);
  const stats = computeShipStats(ship);
  const tsc = combat ? getTsc(combat) : null;
  if (data.destroyed) reasons.push(T("SF2eTSC.errors.shipDestroyed"));
  if (station?.malfunctioning && !["repair-station", "jump-start"].includes(action.id)) reasons.push(T("SF2eTSC.errors.malfunctioning"));
  if (station && !gradeAtLeast(station.grade, action.minGrade ?? "commercial")) reasons.push(T("SF2eTSC.errors.gradeTooLow"));
  if (action.requirements?.some((r) => r.type === "notOffKilter") && stats.offKilter) reasons.push(T("SF2eTSC.requirements.offKilter"));
  if (action.requirements?.some((r) => r.type === "inoperable") && !stats.inoperable) reasons.push(T("SF2eTSC.requirements.notInoperable"));
  if (action.requirements?.some((r) => r.type === "helmingMalfunctioning") && !station?.malfunctioning)
    reasons.push(T("SF2eTSC.requirements.notMalfunctioning"));
  if (action.requirements?.some((r) => r.type === "hasShields") && data.sp.value <= 0) reasons.push(T("SF2eTSC.requirements.noShields"));
  if (!combat) reasons.push(T("SF2eTSC.errors.noCombat"));
  if (
    action.frequency &&
    !isFrequencyAvailable(action.frequency, data.frequencyUsed?.[frequencyKey(action, station)], {
      round: combat?.round ?? 0,
      turn: combat?.turn ?? 0,
      time: game.time.worldTime
    })
  )
    reasons.push(T("SF2eTSC.errors.frequencyUsed"));
  if (tsc && !findObject(tsc, ship.uuid) && ["moveAlongHeading"].some(() => action.id === "boost-thrusters"))
    reasons.push(T("SF2eTSC.errors.notPlaced"));
  const droneHard = [];
  if (["deploy-drone", "retrieve-drone"].includes(action.id)) {
    const matchingStations = data.stations.filter((s) => s?.id === station?.id);
    if (
      matchingStations.length !== 1 ||
      matchingStations[0].type !== "drone-console" ||
      !matchingStations[0].helmedBy ||
      (crew && matchingStations[0].helmedBy !== crew.uuid) ||
      matchingStations[0].malfunctioning ||
      data.destroyed
    ) {
      droneHard.push(T("SF2eTSC.droneControl.errors.station"));
    } else {
      const op = action.id === "deploy-drone" ? "deploy" : "retrieve";
      const env = {
        definition: Content.stations.get("drone-console"),
        droneTypes: Content.drones,
        worldTime: game.time?.worldTime,
        combat: activeStarshipCombat()
      };
      if (!eligibleDroneMovements(data, station.id, op, env).length) droneHard.push(T("SF2eTSC.droneControl.errors.noEligible"));
    }
  }
  reasons.push(...droneHard);
  // warn mode (default): only "no starship combat" really blocks; every rule problem is a warning on an enabled button
  if (moduleSetting("ruleEnforcement") === "strict") return { enabled: reasons.length === 0, reasons, warnings: [] };
  const hard = [...(!combat ? [T("SF2eTSC.errors.noCombat")] : []), ...droneHard];
  return { enabled: hard.length === 0, reasons: hard, warnings: reasons.filter((r) => !hard.includes(r)) };
}

function targetRange(action, ship, weaponRange) {
  const r = action.targeting?.range ?? "sensor";
  if (r === "sensor") return computeShipStats(ship).sensorRange;
  if (r === "weapon") return weaponRange ?? 6;
  return Number(r);
}

/** Ask for the options an action needs (cost variant, spell rank, skill, DC tier, weapon, target station, area origin). */
async function promptOptions(action, { ship, crew, station, target }) {
  const fields = [];
  if (action.id === "repair-hull-drone") fields.push(`<p class="hint">${foundry.utils.escapeHTML(T("SF2eTSC.droneRepair.hint"))}</p>`);
  if (action.id === "boost-battle-station") {
    const data = readStarship(ship);
    const combat = activeStarshipCombat();
    const esc = foundry.utils.escapeHTML;
    const stations = data.stations.filter((st) => st.id && data.stations.filter((other) => other.id === st.id).length === 1);
    if (!stations.length) {
      notifyError("SF2eTSC.errors.boostInvalidTarget");
      return null;
    }
    const entries = stations
      .map((st) => {
        const names =
          [...new Set([st.helmedBy, ...data.crew.filter((c) => c.stationId === st.id).map((c) => c.actorUuid)].filter(Boolean))]
            .map((uuid) => fromUuidSync_(uuid)?.name ?? data.crew.find((c) => c.actorUuid === uuid)?.name ?? uuid)
            .join(", ") || T("SF2eTSC.boost.unoccupied");
        const active = stationEffects(data.effects, st.id, combat).some((e) => e.slug === "boost-battle-station");
        const state = st.malfunctioning ? T("SF2eTSC.ui.malfunctioning") : T("SF2eTSC.boost.available");
        return `<option value="${esc(st.id)}">${esc(ct(st.name))} — ${esc(names)} — ${esc(state)}${active ? ` — ${esc(T("SF2eTSC.boost.active"))}` : ""}</option>`;
      })
      .join("");
    fields.push(
      `<p class="hint">${esc(T("SF2eTSC.boost.hint"))}</p><div class="form-group"><label>${esc(T("SF2eTSC.boost.choose"))}</label><select name="targetStationId">${entries}</select></div>`
    );
  }
  if (isCardAttack(action) && ["strike", "npc-strike"].includes(action.builtin))
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.map")}</label><select name="mapChoice"><option value="0">${T("SF2eTSC.rolls.map0")}</option><option value="1">${T("SF2eTSC.rolls.map1")}</option><option value="2">${T("SF2eTSC.rolls.map2")}</option></select></div>`
    );
  if (action.id === "drone-block") {
    const records = readStarship(ship).drones;
    const drones = (Array.isArray(records) ? records : []).filter(
      (d) =>
        d?.tscVersion === 1 &&
        d.stationId === station?.id &&
        d.deployed === true &&
        records.filter((other) => other?.id === d.id).length === 1
    );
    if (!drones.length) {
      notifyError("SF2eTSC.errors.generic", { message: T("SF2eTSC.droneControl.errors.noEligible") });
      return null;
    }
    const entries = drones
      .map(
        (d) =>
          `<option value="${foundry.utils.escapeHTML(d.id)}">${foundry.utils.escapeHTML(ct(Content.drones.find((t) => t.id === d.ref)?.name ?? d.ref))} (${foundry.utils.escapeHTML(d.id)})</option>`
      )
      .join("");
    fields.push(`<div class="form-group"><label>${T("SF2eTSC.droneControl.type")}</label><select name="droneId">${entries}</select></div>`);
  }
  if (["deploy-drone", "retrieve-drone", "deploy-starship-mine"].includes(action.id)) {
    const deployed = action.id !== "deploy-drone";
    const records = readStarship(ship).drones;
    const drones =
      action.id === "deploy-starship-mine"
        ? (Array.isArray(records) ? records : []).filter(
            (d) =>
              d?.tscVersion === 1 &&
              d.stationId === station?.id &&
              d.deployed === deployed &&
              d.ref === action.requiresDroneType &&
              records.filter((other) => other?.id === d.id).length === 1
          )
        : eligibleDroneMovements(readStarship(ship), station?.id, deployed ? "retrieve" : "deploy", {
            definition: Content.stations.get("drone-console"),
            droneTypes: Content.drones,
            worldTime: game.time?.worldTime,
            combat: activeStarshipCombat()
          });
    if (!drones.length) {
      notifyError("SF2eTSC.errors.generic", { message: T("SF2eTSC.droneControl.errors.noEligible") });
      return null;
    }
    const entries = drones
      .map(
        (d) =>
          `<option value="${foundry.utils.escapeHTML(d.id)}">${foundry.utils.escapeHTML(ct(Content.drones.find((t) => t.id === d.ref)?.name ?? d.ref))} (${foundry.utils.escapeHTML(d.id)})</option>`
      )
      .join("");
    fields.push(`<div class="form-group"><label>${T("SF2eTSC.droneControl.type")}</label><select name="droneId">${entries}</select></div>`);
    if (action.id === "deploy-starship-mine") {
      // Подготовленные при Install Mine мины хранятся в дроне; обычное развёртывание остаётся доступным.
      const esc = foundry.utils.escapeHTML;
      const stored = drones.flatMap((d) =>
        (Array.isArray(d.mineStock) ? d.mineStock : []).map((m) => ({
          drone: d.id,
          id: m.id,
          label: m.label,
          mods: (m.installed?.mods ?? []).map((x) => x.label)
        }))
      );
      if (stored.length) {
        const opts = stored
          .map(
            (m) =>
              `<option value="${esc(m.id)}">${esc(m.label)}${m.mods.length ? ` — ${esc(m.mods.join(", "))}` : ""} (${esc(m.drone)})</option>`
          )
          .join("");
        fields.push(
          `<div class="form-group"><label>${T("SF2eTSC.mineStock.choose")}</label><select name="stockId"><option value="">${T("SF2eTSC.mineStock.plain")}</option>${opts}</select></div><p class="hint">${T("SF2eTSC.mineStock.chooseHint")}</p>`
        );
      }
    }
  }
  if (Array.isArray(action.cost))
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.actionsToSpend")}</label><select name="actions">${action.cost.map((c) => `<option value="${c}">${"◆".repeat(c)}</option>`).join("")}</select></div>`
    );
  if (action.spell)
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.spellRank")}</label><select name="rank">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></div>`
    );
  let skills = action.check?.skillsByStation ? (action.check.skillsByStation[station?.type] ?? []) : (action.check?.skills ?? []);
  if (readStarship(ship).role === "npc")
    skills = skills.filter((slug) => crewStatistic(crew ?? ship, slug) || (!crew && shipModuleValue(ship, slug) !== null));
  if (skills.length > 1)
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.skill")}</label><select name="skill">${skills.map((s) => `<option value="${s}">${skillLabel(s)}</option>`).join("")}</select></div>`
    );
  if (action.check?.dcOptions)
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.dcTier")}</label><select name="dcChoice"><option value="">${T("SF2eTSC.ui.dcShort")} ${action.check.dc.value}</option>${action.check.dcOptions.map((o, i) => `<option value="${i}">${T("SF2eTSC.ui.dcShort")} ${o.dc} (+${o.bonus})</option>`).join("")}</select></div>`
    );
  if (action.check?.dc?.type === "levelBased" || action.check?.dc?.type === "manualReflexDC")
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.manualDC")}</label><input type="number" name="manualDC" placeholder="${T("SF2eTSC.ui.auto")}"></div>`
    );
  if (action.requirements?.some((r) => r.type === "identifiedStation") && target) {
    const tdata = readStarship(target.actor);
    const known = getTsc(activeStarshipCombat()).knowledge?.[tdata.sourceId ?? tdata.name]?.stations ?? [];
    const opts = tdata.stations
      .filter((s) => known.includes(s.id) || game.user.isGM)
      .map((s) => `<option value="${s.id}">${foundry.utils.escapeHTML(ct(s.name))}</option>`)
      .join("");
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.targetStation")}</label><select name="targetStationId">${opts}</select></div>`
    );
  }
  if (action.builtin === "area-fire")
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.areaOrigin")}</label><input type="number" name="areaOrigin" min="1" placeholder="${T("SF2eTSC.ui.auto")}"></div>`
    );
  const data = readStarship(ship);
  if (action.builtin && ["strike", "area-fire", "auto-fire"].includes(action.builtin) && data.weapons.length > 1)
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.weapon")}</label><select name="weaponId">${data.weapons.map((w) => `<option value="${w.id}" ${w.id === station?.weaponId ? "selected" : ""}>${foundry.utils.escapeHTML(ct(w.name))}</option>`).join("")}</select></div>`
    );
  // area attacks list the starships on the map; checked ones are excluded from the area (own side pre-checked)
  const areaKeys = [];
  if (action.builtin === "area-fire" || action.builtin === "auto-fire") {
    const combat = activeStarshipCombat();
    const tsc = combat ? getTsc(combat) : null;
    if (tsc) {
      const own = game.user.isGM ? [] : observerKeys(tsc, game.user);
      const side = (r) => (r === "player" || r === "ally" ? "party" : "enemy");
      const mySide = side(data.role);
      const rows = [];
      for (const o of tsc.objects) {
        if ((o.type !== "starship" && !(o.tscPrivateProjection && o.objectType === "starship")) || o.key === ship.uuid) continue;
        const level = game.user.isGM ? "identified" : effectiveDetection(o, own);
        if (level === "undetected") continue;
        const a = o.tscPrivateProjection ? null : fromUuidSync(o.actorUuid ?? o.key);
        const label = level === "identified" ? o.name : (o.designation ?? T("SF2eTSC.detection.contact"));
        const friendly = a ? side(readStarship(a).role) === mySide : false;
        const i = areaKeys.push(o.key) - 1;
        rows.push(
          `<label class="tsc-check"><input type="checkbox" name="areaExclude.${i}" ${friendly ? "checked" : ""}> ${foundry.utils.escapeHTML(label)} <small>(${T("SF2eTSC.ui.zone")} ${o.zone}${friendly ? `, ${T("SF2eTSC.ui.areaFriendly")}` : ""})</small></label>`
        );
      }
      if (rows.length)
        fields.push(
          `<fieldset class="tsc-area-exclude"><legend>${T("SF2eTSC.ui.areaExclude")}</legend><p class="hint">${T("SF2eTSC.ui.areaExcludeHint")}</p>${rows.join("")}</fieldset>`
        );
    }
  }
  if (!fields.length) return {};
  const res = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: actionLabel(action) },
    content: fields.join(""),
    ok: { label: T("SF2eTSC.ui.execute"), callback: (e, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
    buttons: [
      {
        action: "sendDescription",
        label: T("SF2eTSC.ui.sendDescription"),
        icon: "fa-solid fa-comment",
        callback: async () => {
          await sendActionDescriptionToChat({ action, ship, crew, station });
          return "";
        }
      }
    ],
    rejectClose: false
  }).catch(() => null);
  if (!res) return null;
  const o = {};
  const flat = foundry.utils.flattenObject(res);
  const exclude = areaKeys.filter((k, i) => flat[`areaExclude.${i}`] === true);
  if (exclude.length) o.areaExcludeKeys = exclude;
  for (const [k, v] of Object.entries(res)) {
    if (k.startsWith("areaExclude")) continue;
    if (v === "" || v == null || v === false) continue;
    o[k] = ["actions", "rank", "dcChoice", "manualDC", "areaOrigin"].includes(k) ? Number(v) : v === true ? true : v;
  }
  return o;
}

/** Full client flow for an action: target selection -> options -> authoritative execution. */
export async function runAction(action, ctx) {
  const { ship, crew, station, event = null } = ctx;
  const rollOptions = rollEventOptions(event);
  const needsTarget = ["starship"].includes(action.targeting?.type);
  const weaponRange = (() => {
    if (action.builtin === "npc-strike") return npcStrikeRange(action.strike, computeShipStats(ship).sensorRange);
    const d = readStarship(ship);
    const w = d.weapons.find((x) => x.id === station?.weaponId) ?? d.weapons[0];
    return w ? (Content.weapons.get(w.weaponRef ?? w.id)?.range ?? w.range) : 6;
  })();
  const execute = async (targetUUIDs, targetObjs) => {
    const targetKey = targetUUIDs.length === 1 ? targetUUIDs[0] : null;
    let opts = await promptOptions(action, { ship, crew, station, target: targetObjs[0] ?? null });
    while (opts !== null && requiresActionConfirmation(action)) {
      const choice = await confirmActionConsequences(action, ctx);
      if (choice === true || choice === "confirm") break;
      if (choice === "edit") {
        opts = await promptOptions(action, { ship, crew, station, target: targetObjs[0] ?? null });
        continue;
      }
      return;
    }
    if (opts === null) return;
    if (action.id === "deploy-starship-mine") opts.mineId = randomId("mine");
    if (action.id === "repair-hull-drone") opts.repairId = randomId("repair");
    const send = (extra = {}) =>
      request("executeAction", {
        shipUuid: ship.uuid,
        actionId: action.id,
        crewUuid: crew?.uuid ?? null,
        stationId: station?.id ?? null,
        options: { ...opts, ...(targetUUIDs.length ? { targetUUIDs } : { targetKey }), ...extra, ...rollOptions }
      });
    try {
      await send();
    } catch (err) {
      // GM may override any restriction after seeing why it was refused
      if (game.user.isGM && action.id !== "repair-hull-drone") {
        const go = await foundry.applications.api.DialogV2.confirm({
          classes: ["sf2e-tsc"],
          window: { title: T("SF2eTSC.ui.gmOverride") },
          content: `<p>${foundry.utils.escapeHTML(err.message)}</p><p>${T("SF2eTSC.ui.overrideAsk")}</p>`,
          rejectClose: false
        }).catch(() => false);
        if (go) {
          try {
            await send({ gmOverride: true });
          } catch (e2) {
            notifyError("SF2eTSC.errors.generic", { message: e2.message });
          }
        }
      } else notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  };
  if (!needsTarget) return execute([], []);
  const currentTargets = Targeting.targetUUIDs();
  if (currentTargets.length === 1 && !isCardAttack(action))
    return execute(
      currentTargets,
      currentTargets.map((key) => fromUuidSync_(key))
    );
  if (isCardAttack(action) && ["strike", "npc-strike"].includes(action.builtin)) {
    const opts = await promptOptions(action, { ship, crew, station, target: null });
    if (opts !== null)
      await beginNativeWeaponAttack(
        {
          shipUuid: ship.uuid,
          actionId: action.id,
          crewUuid: crew?.uuid ?? null,
          stationId: station?.id ?? null,
          options: opts
        },
        event
      );
    return;
  }
  // single-target attacks: declaration card first (no roll, nothing spent), then the target is chosen on the card
  // or on the Sensor Map — both resolve through the same GM handler (resolveAttackCard)
  if (isCardAttack(action) && moduleSetting("attackCards") !== false) {
    const opts = await promptOptions(action, { ship, crew, station, target: null });
    if (opts === null) return;
    try {
      const res = await request("declareAttack", {
        shipUuid: ship.uuid,
        actionId: action.id,
        crewUuid: crew?.uuid ?? null,
        stationId: station?.id ?? null,
        options: opts
      });
      if (res?.messageId) {
        ui.notifications.info(T("SF2eTSC.attackCard.declared"));
        await beginCardTargeting(res.messageId, undefined, rollOptions);
      }
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
    return;
  }
  Targeting.begin({
    shipUuid: ship.uuid,
    label: actionLabel(action),
    range: targetRange(action, ship, weaponRange),
    allowSelf: !!action.targeting?.allowSelf,
    enforceDetection: readStarship(ship).role === "player" && action.builtin !== "seek",
    gm: game.user.isGM,
    singleTarget: true,
    onExecute: async (keys) => {
      await execute(
        keys,
        keys.map((key) => fromUuidSync_(key))
      );
    }
  });
}
