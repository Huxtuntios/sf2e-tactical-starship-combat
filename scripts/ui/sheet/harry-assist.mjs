import { applyHarryEffect } from "../../actions/harry-apply.mjs";
import { MODULE_ID, FLAGS } from "../../constants.mjs";
import { activeStarshipCombat } from "../../combat/tsc-state.mjs";
import { readStarship } from "../../starship/starship-state.mjs";
import { shipStatistic } from "../../starship/stats.mjs";
import { mappedMineTargets, targetSnapshots } from "../../actions/mine-targets.mjs";
import { fromUuidSafe, T, isActiveGM } from "../../utils/foundry.mjs";
import { escHTML } from "./sheet-model.mjs";

const open = new Set();
const esc = escHTML;
const label = (key, data) => esc(T(`SF2eTSC.harryAssist.${key}`, data));
const degreeKeys = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** GM-помощник: только бросок и инструкции; состояния никогда не применяются автоматически. */
export async function prepareHarrySensors(ship, button) {
  if (!game.user.isGM) throw new Error(T("SF2eTSC.errors.gmOnly"));
  if (!isActiveGM()) throw new Error(T("SF2eTSC.harryAssist.activeGM"));
  const { stationId, droneId } = button.dataset;
  const key = JSON.stringify([ship.uuid, stationId, droneId]);
  if (open.has(key)) return;
  open.add(key);
  try {
    const plan = async () => {
      const data = readStarship(ship),
        combat = activeStarshipCombat();
      if (!combat?.id || data.destroyed) throw new Error(T("SF2eTSC.harryAssist.invalid"));
      const stations = data.stations.filter((s) => s?.id === stationId),
        drones = data.drones.filter((d) => d?.id === droneId);
      if (
        stations.length !== 1 ||
        stations[0].type !== "drone-console" ||
        stations[0].malfunctioning ||
        !stations[0].helmedBy ||
        drones.length !== 1 ||
        drones[0].stationId !== stationId ||
        drones[0].ref !== "scramble-drone" ||
        drones[0].tscVersion !== 1 ||
        drones[0].deployed !== true
      )
        throw new Error(T("SF2eTSC.harryAssist.invalid"));
      const operator = await fromUuidSafe(stations[0].helmedBy);
      if (!operator || operator.uuid !== stations[0].helmedBy || !operator.name) throw new Error(T("SF2eTSC.harryAssist.invalid"));
      const map = combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT];
      const source = map?.objects?.filter((o) => o?.key === ship.uuid) ?? [];
      if (source.length !== 1) throw new Error(T("SF2eTSC.harryAssist.invalid"));
      const { targets } = await mappedMineTargets(map, source[0].zone, ship.uuid, fromUuidSafe);
      const targetState = await targetSnapshots(targets, fromUuidSafe);
      let dc = null;
      try {
        const candidate = operator.getStatistic?.("class-spell")?.dc?.value;
        if (Number.isInteger(candidate) && candidate > 0 && candidate <= 100) dc = candidate;
      } catch {
        /* Ведущий самостоятельно проверит КС. */
      }
      return {
        targets,
        dc,
        operator: { uuid: operator.uuid, name: operator.name },
        zone: source[0].zone,
        snapshot: JSON.stringify({
          data,
          map,
          combatId: combat.id,
          round: combat.round,
          turn: combat.turn,
          dc,
          targets,
          targetState,
          operator: operator.uuid
        })
      };
    };
    const initial = await plan();
    if (!initial.targets.length) throw new Error(T("SF2eTSC.harryAssist.invalid"));
    const dcField =
      initial.dc == null
        ? `<p><label>${label("manualDC")} <input name="manualDC" type="number" min="1" max="100" required /></label></p>`
        : `<p>${label("dc", { dc: initial.dc })}</p>`;
    const choice = await foundry.applications.api.DialogV2.prompt({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.harryAssist.title") },
      content: `<p>${label("intro", { operator: initial.operator.name, zone: initial.zone })}</p><p>${label("warning")}</p>${dcField}<p><label>${label("target")} <select name="target">${initial.targets.map((x) => `<option value="${esc(x.key)}">${esc(x.name)} (${esc(x.key)})</option>`).join("")}</select></label></p>`,
      ok: {
        label: T("SF2eTSC.harryAssist.roll"),
        callback: (_e, b) => ({ target: b.form.elements.target.value, dc: b.form.elements.manualDC?.value ?? "" })
      },
      rejectClose: false
    }).catch(() => null);
    if (!choice) return;
    if (!isActiveGM()) throw new Error(T("SF2eTSC.harryAssist.activeGM"));
    const fresh = await plan();
    if (fresh.snapshot !== initial.snapshot) throw new Error(T("SF2eTSC.harryAssist.changed"));
    const target = fresh.targets.find((x) => x.key === choice.target),
      dc = initial.dc ?? Number(choice.dc);
    if (!target || !Number.isInteger(dc) || dc < 1 || dc > 100 || (initial.dc == null && choice.dc === ""))
      throw new Error(T("SF2eTSC.harryAssist.invalid"));
    const recipients = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
    if (!recipients.length) throw new Error(T("SF2eTSC.errors.gmOnly"));
    let degree = null,
      total = null,
      status = "pending",
      stale = false,
      appliedStatus = "";
    const render = () =>
      `<p><strong>${label("title")}</strong></p><p>${label("identity", { operator: fresh.operator.name, drone: droneId, target: target.name, dc })}</p><p>${degree == null ? label(status) : `${esc(T(`SF2eTSC.degree.${degreeKeys[degree]}`))}${total == null ? ` — ${label("manualDegree")}` : ` (${total})`}`}</p><p>${degree == null ? label("manual") : label(degreeKeys[degree])}</p><p>${appliedStatus ? esc(T(`SF2eTSC.harryApply.${appliedStatus}`)) : label("notApplied")}</p>${stale ? `<p>${label("changed")}</p>` : ""}`;
    const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: ship }), whisper: recipients, content: render() });
    const save = async () => {
      try {
        return await message.update({ content: render() });
      } catch (err) {
        ui.notifications?.warn?.(T("SF2eTSC.harryAssist.progressFailed"));
        throw err;
      }
    };
    const valid = async () => {
      if (!isActiveGM()) return false;
      try {
        return (await plan()).snapshot === fresh.snapshot;
      } catch {
        return false;
      }
    };
    if (!(await valid())) {
      stale = true;
      await save();
      return;
    }
    let stat = null;
    try {
      stat = shipStatistic(await fromUuidSafe(target.uuid), "will");
    } catch {
      /* Manual fallback. */
    }
    if (typeof stat?.check?.roll === "function") {
      status = "rolling";
      await save();
      try {
        const roll = await stat.check.roll({
          dc: { value: dc },
          extraRollOptions: ["starship", "starship-check:will"],
          createMessage: false,
          skipDialog: true
        });
        if (
          !Number.isInteger(roll?.degreeOfSuccess) ||
          roll.degreeOfSuccess < 0 ||
          roll.degreeOfSuccess > 3 ||
          !Number.isInteger(roll?.total)
        )
          throw new Error("invalid save");
        degree = roll.degreeOfSuccess;
        total = roll.total;
      } catch {
        status = "manual";
      }
    } else status = "manual";
    await save();
    if (!(await valid())) {
      stale = true;
      await save();
      return;
    }
    const review = await foundry.applications.api.DialogV2.prompt({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.harryAssist.reviewTitle") },
      content: `${render()}<p><label>${label("degree")} <select name="degree"><option value="">${label("pending")}</option>${degreeKeys.map((k, i) => `<option value="${i}"${degree === i ? " selected" : ""}>${esc(T(`SF2eTSC.degree.${k}`))}</option>`).join("")}</select></label></p><p><label><input type="checkbox" name="applyEffect" /> ${esc(T("SF2eTSC.harryApply.confirm"))}</label></p><p>${esc(T("SF2eTSC.harryApply.limit"))}</p>`,
      ok: {
        label: T("SF2eTSC.harryAssist.save"),
        callback: (_e, b) => ({ degree: b.form.elements.degree.value, apply: b.form.elements.applyEffect?.checked ?? false })
      },
      rejectClose: false
    }).catch(() => null);
    if (review == null) return;
    const apply = typeof review === "object" && review.apply === true;
    const reviewedDegree = typeof review === "object" ? review.degree : review;
    if (!(await valid())) {
      stale = true;
      await save();
      return;
    }
    if (!["", "0", "1", "2", "3"].includes(reviewedDegree)) throw new Error(T("SF2eTSC.harryAssist.invalid"));
    if (reviewedDegree === "") {
      degree = null;
      total = null;
      status = "manual";
    } else if (degree !== Number(reviewedDegree)) {
      degree = Number(reviewedDegree);
      total = null;
    }
    await save();
    if (apply && degree != null && degree !== 3) {
      try {
        const changed = await applyHarryEffect({
          targetUuid: target.uuid,
          sourceUuid: ship.uuid,
          messageId: message.id,
          degree,
          combatId: activeStarshipCombat()?.id,
          validate: valid
        });
        appliedStatus = changed ? "applied" : "already";
        await save();
      } catch (err) {
        ui.notifications?.warn?.(T("SF2eTSC.harryApply.failed", { message: err.message }));
        appliedStatus = "manual";
        await save();
      }
    }
  } finally {
    open.delete(key);
  }
}
