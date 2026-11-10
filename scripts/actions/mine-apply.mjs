import { Draft } from "./draft.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { snapshot, equalState } from "../history/history.mjs";
import { isActiveGM, T } from "../utils/foundry.mjs";
import { serialize } from "../utils/serial.mjs";

/** Вызывается только из помощника активного GM; квитанция и урон сохраняются одним обновлением Actor. */
export async function applyGuidedMineTarget({ targetUuid, sourceUuid, droneId, mineId, combatId, amount, type, degree, validate }) {
  if (
    !isActiveGM() ||
    ![targetUuid, sourceUuid, droneId, mineId, combatId].every((x) => typeof x === "string" && x.length > 0) ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > 100000 ||
    !["fire", "piercing"].includes(type) ||
    !Number.isInteger(degree) ||
    degree < 0 ||
    degree > 3 ||
    typeof validate !== "function"
  )
    throw new Error(T("SF2eTSC.mineApply.invalid"));
  return serialize(`mine-damage:${targetUuid}`, async () => {
    if (!isActiveGM() || activeStarshipCombat()?.id !== combatId || !(await validate())) throw new Error(T("SF2eTSC.mineApply.changed"));
    const draft = new Draft(activeStarshipCombat(), { trackCombat: false });
    const entry = await draft.ship(targetUuid);
    if (entry.actor.pack) throw new Error(T("SF2eTSC.mineApply.readOnly"));
    const records = entry.data.tscMineDamageReceipts;
    if (records != null && (!Array.isArray(records) || records.some((r) => typeof r !== "string")))
      throw new Error(T("SF2eTSC.mineApply.invalid"));
    const key = JSON.stringify([combatId, sourceUuid, droneId, mineId]);
    if ((records ?? []).includes(key)) return { already: true };
    if ((records?.length ?? 0) >= 512) throw new Error(T("SF2eTSC.mineApply.full"));
    entry.writeOptions = { expected: snapshot(entry.before), announce: false, undoable: false };
    entry.data.tscMineDamageReceipts = [...(records ?? []), key];
    const result = await applyDamageInDraft(draft, targetUuid, {
      amount,
      damageType: type,
      criticalHit: degree === 0,
      source: T("SF2eTSC.mineApply.source"),
      silent: true
    });
    const before = snapshot(entry.before),
      after = snapshot(entry.data);
    if (Object.hasOwn(before, "tscMineDamageReceipts")) after.tscMineDamageReceipts = before.tscMineDamageReceipts;
    else delete after.tscMineDamageReceipts;
    if (equalState(before, after)) entry.writeOptions.history = false; // Только квитанция, игровых изменений нет.
    // Последняя проверка перед постановкой в очередь корабля. Другие документы не образуют транзакцию.
    if (!isActiveGM() || !(await validate())) throw new Error(T("SF2eTSC.mineApply.changed"));
    await draft.commit();
    return { already: false, shield: result.shieldDamage, hull: result.hullDamage };
  });
}
