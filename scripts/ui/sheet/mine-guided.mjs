import { applyGuidedMineTarget } from "../../actions/mine-apply.mjs";
import { request } from "../../socket.mjs";
import { activeStarshipCombat } from "../../combat/tsc-state.mjs";
import { shipStatistic } from "../../starship/stats.mjs";
import { typedDamageFormula } from "../../rolls/typed-damage.mjs";
import { fromUuidSafe, T, isActiveGM } from "../../utils/foundry.mjs";
import { escHTML } from "./sheet-model.mjs";

/** Только базовая степень успеха; иммунитеты, сопротивление, слабости и SP ещё не учтены. */
export function mineBasicDamage(total, degree) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(degree) || degree < 0 || degree > 3) throw new Error("invalid damage");
  return Math.floor(total * [2, 1, 0.5, 0][degree]);
}
const esc = escHTML;
const label = (key, values) => esc(T(`SF2eTSC.mineGuided.${key}`, values));
const applyLabel = (key, values) => esc(T(`SF2eTSC.mineApply.${key}`, values));
const degreeLabel = (degree) => esc(T(`SF2eTSC.degree.${["criticalFailure", "failure", "success", "criticalSuccess"][degree]}`));

/** Один локальный GM-процесс: карточка хранит пройденные шаги, но не является транзакцией мира. */
export async function guidedMineResolution({ ship, fresh, choice, excluded, recipients, plan, mineId, droneId, stationId }) {
  if (!isActiveGM()) throw new Error(T("SF2eTSC.mineGuided.activeGM"));
  const { result, targets, operator } = fresh;
  const affected = targets.filter((target) => target.key !== excluded);
  const bonus = result.modification === "targeting" ? result.bonus : 0;
  const expression = `${result.dice}d8${bonus ? ` + ${bonus}` : ""}`;
  const state = {
    damage: null,
    damageStatus: "pending",
    saves: affected.map((target) => ({ ...target, status: "pending", total: null, degree: null }))
  };
  let stale = false;
  const render = () => {
    const rows = state.saves
      .map((row) => {
        const applied = row.applied ? ` — ${applyLabel(row.applied, row.result ?? {})}` : "";
        const stateText =
          row.degree != null
            ? `${degreeLabel(row.degree)}${row.total != null ? ` (${row.total})` : ` — ${label("manualDegree")}`}`
            : label(row.status);
        const amount =
          row.degree != null && state.damage != null ? ` — ${label("raw", { amount: mineBasicDamage(state.damage, row.degree) })}` : "";
        return `<li>${esc(row.name)} (${esc(row.key)}): ${stateText}${amount}${applied}</li>`;
      })
      .join("");
    const ignored = targets
      .filter((x) => x.key === excluded)
      .map((x) => `<li>${esc(x.name)} (${esc(x.key)}) — ${label("excluded")}</li>`)
      .join("");
    const damageText =
      state.damage == null
        ? T(`SF2eTSC.mineGuided.${state.damageStatus}`)
        : `${state.damage}${state.damageStatus === "manualRoll" ? ` (${T("SF2eTSC.mineGuided.manualDegree")})` : ""}`;
    return `<p><strong>${label("title")}</strong></p><p>${label("identity", { operator: operator.name, mine: mineId, drone: droneId, zone: result.zone })}</p><p>${label("mapWarning")}</p><p>${esc(T(choice.reaction ? "SF2eTSC.mineAssist.reactionLabel" : "SF2eTSC.mineAssist.actionLabel"))}</p><p>${label("damage", { formula: expression, type: T(`SF2eTSC.mineAssist.${choice.type}`), total: damageText })}; ${label("dc", { dc: result.dc })}</p><ul>${rows}${ignored}</ul><p>${stale ? label("stale") : state.saves.some((row) => row.applied) ? applyLabel("reminder") : label("manual")}</p>`;
  };
  // При ошибке сохранения карточки броски ещё не начались.
  const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: ship }), whisper: recipients, content: render() });
  const save = async () => {
    try {
      return await message.update({ content: render() });
    } catch (err) {
      ui.notifications?.warn?.(T("SF2eTSC.mineGuided.progressFailed"));
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
  state.damageStatus = "rolling";
  await save(); // При обрыве можно увидеть, что бросок мог выполниться: автоматический повтор запрещён.
  try {
    const Ctor = globalThis.CONFIG?.Dice?.rolls?.find((ctor) => ctor.name === "DamageRoll");
    if (!Ctor) throw new Error("native damage unavailable");
    const formula = typedDamageFormula([{ formula: expression, type: choice.type }]);
    if (Ctor.validate && !Ctor.validate(formula)) throw new Error("invalid formula");
    const rolled = await new Ctor(formula, {}, { rollerId: game.user.id }).evaluate();
    if (!Number.isInteger(rolled?.total) || rolled.total < result.dice + bonus || rolled.total > result.dice * 8 + bonus)
      throw new Error("invalid roll");
    state.damage = rolled.total;
    state.damageStatus = "rolled";
  } catch {
    state.damageStatus = "manualRoll";
  }
  await save();
  for (const row of state.saves) {
    if (!(await valid())) {
      stale = true;
      await save();
      return;
    }
    let statistic;
    try {
      const actor = await fromUuidSafe(row.uuid);
      if (!actor || actor.uuid !== row.uuid) throw new Error("actor unavailable");
      statistic = shipStatistic(actor, "reflex");
      if (typeof statistic?.check?.roll !== "function") throw new Error("native save unavailable");
    } catch {
      row.status = "manualSave";
      await save();
      continue;
    }
    row.status = "rolling";
    await save();
    try {
      const rolled = await statistic.check.roll({
        dc: { value: result.dc },
        extraRollOptions: ["starship", "starship-check:reflex"],
        createMessage: false,
        skipDialog: true
      });
      if (
        !Number.isInteger(rolled?.degreeOfSuccess) ||
        rolled.degreeOfSuccess < 0 ||
        rolled.degreeOfSuccess > 3 ||
        !Number.isInteger(rolled?.total)
      )
        throw new Error("invalid save");
      row.degree = rolled.degreeOfSuccess;
      row.total = rolled.total;
      row.status = "rolled";
    } catch {
      row.status = "manualSave";
    }
    await save();
  }
  if (!(await valid())) {
    stale = true;
    await save();
    return;
  }
  const selects = state.saves
    .map(
      (row, i) =>
        `<p><label>${esc(row.name)} (${esc(row.key)}) <select name="save${i}"><option value="">${label("pending")}</option>${[0, 1, 2, 3].map((d) => `<option value="${d}"${row.degree === d ? " selected" : ""}>${degreeLabel(d)}</option>`).join("")}</select></label> <label><input type="checkbox" name="apply${i}" /> ${applyLabel("apply")}</label></p>`
    )
    .join("");
  const damageInput =
    state.damage == null
      ? `<p><label>${label("manualTotal")} <input name="damageTotal" type="number" min="${result.dice + bonus}" max="${result.dice * 8 + bonus}" /></label></p>`
      : "";
  const selected = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.mineGuided.reviewTitle") },
    content: `${render()}<p>${label("review")}</p><p>${applyLabel("applyWarning")}</p>${damageInput}${selects}`,
    ok: {
      label: T("SF2eTSC.mineGuided.reviewButton"),
      callback: (_e, b) => ({
        damage: b.form.elements.damageTotal?.value ?? "",
        degrees: state.saves.map((_r, i) => b.form.elements[`save${i}`].value),
        apply: state.saves.map((_r, i) => b.form.elements[`apply${i}`]?.checked ?? false)
      })
    },
    rejectClose: false
  }).catch(() => null);
  if (!selected) return; // Карточка сохраняет прогресс без заявления о завершении.
  if (!(await valid())) {
    stale = true;
    await save();
    return;
  }
  if (state.damage == null && selected.damage !== "") {
    const value = Number(selected.damage);
    if (!Number.isInteger(value) || value < result.dice + bonus || value > result.dice * 8 + bonus)
      throw new Error(T("SF2eTSC.mineGuided.invalid"));
    state.damage = value;
    state.damageStatus = "manualRoll";
  }
  if (
    !Array.isArray(selected.degrees) ||
    selected.degrees.length !== state.saves.length ||
    selected.degrees.some((v) => !["", "0", "1", "2", "3"].includes(v))
  )
    throw new Error(T("SF2eTSC.mineGuided.invalid"));
  state.saves.forEach((row, i) => {
    const value = selected.degrees[i];
    if (value === "") {
      row.degree = null;
      row.status = "manualSave";
      return;
    }
    const d = Number(value);
    if (row.degree !== d || row.status !== "rolled") {
      row.degree = d;
      row.total = null;
      row.status = "manualDegree";
    }
  });
  await save();
  if (!Array.isArray(selected.apply) || !selected.apply.some(Boolean)) return;
  if (selected.apply.length !== state.saves.length || selected.apply.some((x) => typeof x !== "boolean"))
    throw new Error(T("SF2eTSC.mineGuided.invalid"));
  let expected = fresh.snapshot;
  const combatId = activeStarshipCombat()?.id ?? null;
  const validate = async () => {
    if (!isActiveGM()) return false;
    try {
      return (await plan()).snapshot === expected;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < state.saves.length; i++) {
    const row = state.saves[i];
    if (!selected.apply[i]) continue;
    if (state.damage == null || row.degree == null) {
      row.applied = "missingResult";
      await save();
      continue;
    }
    if (!(await validate())) {
      stale = true;
      await save();
      return;
    }
    row.applied = "applying";
    await save(); // При обрыве запись может уже состояться; не повторять вслепую.
    try {
      const applied = await applyGuidedMineTarget({
        targetUuid: row.uuid,
        sourceUuid: ship.uuid,
        droneId,
        mineId,
        combatId,
        amount: mineBasicDamage(state.damage, row.degree),
        type: choice.type,
        degree: row.degree,
        validate
      });
      row.applied = applied.already ? "already" : "applied";
      row.result = applied;
      expected = (await plan()).snapshot;
      await save();
    } catch (err) {
      row.applied = "uncertain";
      await save();
      ui.notifications?.warn?.(T("SF2eTSC.mineApply.failed", { message: err.message }));
      return;
    }
  }
  if (state.saves.every((r) => ["applied", "already"].includes(r.applied)) && stationId && combatId) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["sf2e-tsc"],
      window: { title: T("SF2eTSC.mineApply.closeTitle") },
      content: `<p>${applyLabel("closeWarning")}</p>`,
      rejectClose: false
    }).catch(() => false);
    if (confirmed && (await validate())) {
      await request("closeDroneMine", { shipUuid: ship.uuid, stationId, droneId, mineId, resolution: "detonated" });
      await message.update({ content: `${render()}<p>${applyLabel("closed")}</p>` });
    }
  }
}
