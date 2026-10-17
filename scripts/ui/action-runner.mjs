import { Content } from "../content/loader.mjs";
import { gradeAtLeast } from "../engine/advancement.mjs";
import { isFrequencyAvailable, frequencyKey } from "../engine/frequency.mjs";
import { findObject, effectiveDetection } from "../engine/sensor-ops.mjs";
import { observerKeys } from "../sensor/map-model.mjs";
import { readStarship } from "../starship/starship-state.mjs";
import { computeShipStats } from "../starship/stats.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { request } from "../socket.mjs";
import { actionLabel } from "../actions/action-engine.mjs";
import { Targeting } from "./targeting.mjs";
import { npcStrikeRange } from "../actions/strike.mjs";
import { T, moduleSetting } from "../utils/foundry.mjs";
import { notifyError } from "../utils/logging.mjs";
import { isCardAttack, beginCardTargeting } from "../chat/attack-card.mjs";
import { ct } from "../content/content-i18n.mjs";
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
  // warn mode (default): only "no starship combat" really blocks; every rule problem is a warning on an enabled button
  if (moduleSetting("ruleEnforcement") === "strict") return { enabled: reasons.length === 0, reasons, warnings: [] };
  const hard = !combat ? [T("SF2eTSC.errors.noCombat")] : [];
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
  if (Array.isArray(action.cost))
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.actionsToSpend")}</label><select name="actions">${action.cost.map((c) => `<option value="${c}">${"◆".repeat(c)}</option>`).join("")}</select></div>`
    );
  if (action.spell)
    fields.push(
      `<div class="form-group"><label>${T("SF2eTSC.ui.spellRank")}</label><select name="rank">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></div>`
    );
  const skills = action.check?.skillsByStation ? (action.check.skillsByStation[station?.type] ?? []) : (action.check?.skills ?? []);
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
        if (o.type !== "starship" || o.key === ship.uuid) continue;
        const level = game.user.isGM ? "identified" : effectiveDetection(o, own);
        if (level === "undetected") continue;
        const a = fromUuidSync(o.actorUuid ?? o.key);
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
    window: { title: actionLabel(action) },
    content: fields.join(""),
    ok: { label: T("SF2eTSC.ui.execute"), callback: (e, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
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
  const { ship, crew, station } = ctx;
  const needsTarget = ["starship"].includes(action.targeting?.type);
  const weaponRange = (() => {
    if (action.builtin === "npc-strike") return npcStrikeRange(action.strike, computeShipStats(ship).sensorRange);
    const d = readStarship(ship);
    const w = d.weapons.find((x) => x.id === station?.weaponId) ?? d.weapons[0];
    return w ? (Content.weapons.get(w.weaponRef ?? w.id)?.range ?? w.range) : 6;
  })();
  const execute = async (targetKey, targetObj) => {
    const opts = await promptOptions(action, { ship, crew, station, target: targetObj });
    if (opts === null) return;
    const send = (extra = {}) =>
      request("executeAction", {
        shipUuid: ship.uuid,
        actionId: action.id,
        crewUuid: crew?.uuid ?? null,
        stationId: station?.id ?? null,
        options: { ...opts, targetKey, ...extra }
      });
    try {
      await send();
    } catch (err) {
      // GM may override any restriction after seeing why it was refused
      if (game.user.isGM) {
        const go = await foundry.applications.api.DialogV2.confirm({
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
  if (!needsTarget) return execute(null, null);
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
        await beginCardTargeting(res.messageId);
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
    gm: game.user.isGM && false,
    onPick: async (key) => {
      const tgt = fromUuidSync(key);
      await execute(key, { actor: tgt });
    }
  });
}
