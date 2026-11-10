import { patchStarship, isStarship } from "../starship/starship-state.mjs";
import { snapshot, combatGuard } from "../history/history.mjs";
import { activeStarshipCombat } from "../combat/tsc-state.mjs";
import { fromUuidSafe, isActiveGM, T } from "../utils/foundry.mjs";

/** Существующие эффекты корабля, не системные Item-состояния: применять только после подтверждения GM. */
export async function applyHarryEffect({ targetUuid, sourceUuid, messageId, degree, combatId, validate }) {
  if (
    !isActiveGM() ||
    ![targetUuid, sourceUuid, messageId, combatId].every((x) => typeof x === "string" && x) ||
    ![0, 1, 2].includes(degree) ||
    typeof validate !== "function"
  )
    throw new Error(T("SF2eTSC.harryApply.invalid"));
  const actor = await fromUuidSafe(targetUuid);
  const combat = activeStarshipCombat();
  if (!actor || !isStarship(actor) || actor.pack || combat?.id !== combatId || !(await validate()))
    throw new Error(T("SF2eTSC.harryApply.invalid"));
  let changed = false;
  const opts = { reason: T("SF2eTSC.harryAssist.title"), undoable: false, announce: false };
  await patchStarship(
    actor,
    async (data) => {
      if (!isActiveGM() || activeStarshipCombat()?.id !== combatId || !(await validate())) throw new Error(T("SF2eTSC.harryApply.changed"));
      opts.expected = snapshot(data);
      opts.expectedCombat = combatGuard(combat);
      const receipts = data.tscHarryReceipts;
      if (receipts != null && (!Array.isArray(receipts) || receipts.some((x) => typeof x !== "string")))
        throw new Error(T("SF2eTSC.harryApply.invalid"));
      if ((receipts ?? []).includes(messageId)) return;
      if ((receipts?.length ?? 0) >= 512) throw new Error(T("SF2eTSC.harryApply.full"));
      let timing = null;
      if (degree === 2) {
        const turns = combat.turns;
        if (
          !Array.isArray(turns) ||
          !Number.isInteger(combat.turn) ||
          !Number.isInteger(combat.round) ||
          combat.round < 1 ||
          turns.some((x) => !x?.id) ||
          new Set(turns.map((x) => x.id)).size !== turns.length
        )
          throw new Error(T("SF2eTSC.harryApply.anchor"));
        const matches = turns.map((x, i) => ({ x, i })).filter(({ x }) => x.actor?.uuid === targetUuid);
        if (matches.length !== 1) throw new Error(T("SF2eTSC.harryApply.anchor"));
        timing = {
          combatId,
          combatantId: matches[0].x.id,
          mode: "turn-start",
          round: combat.round + (matches[0].i <= combat.turn ? 1 : 0),
          createdTurn: { id: turns[combat.turn]?.id, round: combat.round, turn: combat.turn }
        };
      }
      data.effects.push({
        id: `harry-${messageId}`,
        slug: "harry-sensors",
        label: T("SF2eTSC.harryAssist.title"),
        modifiers: [],
        conditions: degree === 0 ? ["off-kilter", "off-guard"] : ["off-kilter"],
        timing,
        expire: null,
        sourceUuid
      });
      data.tscHarryReceipts = [...(receipts ?? []), messageId];
      changed = true;
    },
    opts
  );
  return changed;
}
