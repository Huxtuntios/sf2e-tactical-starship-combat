import { DEGREE, DEGREE_KEYS } from "../constants.mjs";
import { activeStarshipCombat, getTsc } from "../combat/tsc-state.mjs";
import { can } from "../crew/permissions.mjs";
import { fromUuidSafe, T } from "../utils/foundry.mjs";
import { patchStarship, readStarship } from "../starship/starship-state.mjs";
import { effectModifiers, stationEffects } from "../starship/effects.mjs";
import { snapshot, equalState, recordChange, combatGuard } from "../history/history.mjs";
import { resolveHullRestored } from "../engine/compromised.mjs";
import { Initiative } from "../combat/initiative.mjs";
import { applyDamageInDraft } from "../damage/damage-service.mjs";
import { Draft } from "./draft.mjs";
import { postActionCard } from "../chat/chat-cards.mjs";
import { log } from "../utils/logging.mjs";

const tiers = [
  { dc: 15, bonus: 0, rank: 0 },
  { dc: 20, bonus: 10, rank: 2 },
  { dc: 30, bonus: 30, rank: 3 },
  { dc: 40, bonus: 50, rank: 4 }
];
const invalid = () => new Error(T("SF2eTSC.droneRepair.invalid"));

/** Действие ограничено собственным кораблём: результат и идентификатор сохраняются одной записью Actor. */
export async function executeDroneRepair({ user, ship, crewUuid, stationId, options, action }) {
  if (!/^repair-[a-zA-Z0-9]{8,40}$/.test(options.repairId ?? "")) throw invalid();
  if (options.targetKey && options.targetKey !== ship.uuid) throw invalid();
  if (options.dcChoice != null && (!Number.isInteger(options.dcChoice) || options.dcChoice < 0 || options.dcChoice > 2)) throw invalid();
  const tierIndex = options.dcChoice == null ? 0 : options.dcChoice + 1;
  if (!Number.isInteger(tierIndex) || !tiers[tierIndex]) throw invalid();
  const tier = tiers[tierIndex];
  const crew = await fromUuidSafe(crewUuid);
  const combat = activeStarshipCombat();
  const valid = (data) => {
    if (!crew || !combat || activeStarshipCombat()?.id !== combat.id) throw invalid();
    if (!user.isGM && (!can(user, ship, "operateStation") || !crew.testUserPermission?.(user, "OWNER"))) throw invalid();
    const stations = data.stations.filter((s) => s?.id === stationId);
    const station = stations.length === 1 ? stations[0] : null;
    if (!station || station.type !== "drone-console" || station.helmedBy !== crewUuid || station.malfunctioning || data.destroyed)
      throw invalid();
    const drones = Array.isArray(data.drones) ? data.drones : [];
    if (
      !drones.some(
        (d) =>
          typeof d?.id === "string" &&
          d.id &&
          d.tscVersion === 1 &&
          d.stationId === stationId &&
          d.ref === "repair-drone" &&
          d.deployed === true &&
          drones.filter((other) => other?.id === d.id).length === 1
      )
    )
      throw invalid();
    const objects = getTsc(combat)?.objects?.filter((o) => o?.key === ship.uuid) ?? [];
    if (objects.length !== 1 || !Number.isInteger(objects[0].zone)) throw invalid();
    return { station, zone: objects[0].zone, round: combat.round, turn: combat.turn };
  };
  const fingerprint = JSON.stringify({ crewUuid, stationId, dc: tier.dc });
  let before,
    changed = false,
    damageDraft,
    resultData,
    lostCompromised = false;
  const writeOptions = { history: false };
  const result = await patchStarship(
    ship,
    async (data) => {
      const initial = valid(data);
      const store = data.droneRepairReceipts;
      if (store != null && (typeof store !== "object" || Array.isArray(store))) throw new Error(T("SF2eTSC.droneRepair.receiptFull"));
      const receipts = store ?? {};
      if (Object.hasOwn(receipts, options.repairId)) {
        if (receipts[options.repairId] !== fingerprint) throw new Error(T("SF2eTSC.droneRepair.duplicate"));
        return { ok: true, changed: false, replayed: true };
      }
      if (Object.keys(receipts).length >= 512) throw new Error(T("SF2eTSC.droneRepair.receiptFull"));
      const stat = crew.skills?.crafting ?? crew.getStatistic?.("crafting");
      if (typeof stat?.check?.roll !== "function") throw new Error(T("SF2eTSC.droneRepair.nativeMissing"));
      if (tier.rank && (!Number.isInteger(stat.rank) || stat.rank < tier.rank)) throw new Error(T("SF2eTSC.droneRepair.invalidTier"));
      const boost = effectModifiers(stationEffects(data.effects, stationId, combat), "station-check");
      let statistic = stat;
      if (boost.length) {
        if (typeof stat.clone !== "function" || typeof game.pf2e?.Modifier !== "function")
          throw new Error(T("SF2eTSC.droneRepair.nativeMissing"));
        try {
          statistic = stat.clone({
            modifiers: boost.map(
              (m) => new game.pf2e.Modifier({ slug: `tsc-${m.slug}`, label: m.label ?? m.slug, modifier: m.value, type: m.type })
            )
          });
        } catch (err) {
          throw new Error(T("SF2eTSC.droneRepair.nativeMissing"), { cause: err });
        }
        if (typeof statistic?.check?.roll !== "function") throw new Error(T("SF2eTSC.droneRepair.nativeMissing"));
      }
      before = structuredClone(data);
      writeOptions.expected = snapshot(before);
      writeOptions.expectedCombat = combatGuard(combat);
      let roll;
      try {
        roll = await statistic.check.roll({
          dc: { value: tier.dc },
          action: "repair-hull",
          traits: ["healing", "manipulate", "station"],
          extraRollOptions: ["starship"],
          createMessage: false,
          skipDialog: true
        });
      } catch (err) {
        throw new Error(T("SF2eTSC.droneRepair.nativeMissing"), { cause: err });
      }
      const degree = roll?.degreeOfSuccess;
      if (!Number.isInteger(degree) || degree < 0 || degree > 3 || !Number.isFinite(roll?.total))
        throw new Error(T("SF2eTSC.droneRepair.nativeMissing"));
      const count = degree === DEGREE.CRITICAL_SUCCESS ? 2 : degree === DEGREE.SUCCESS || degree === DEGREE.CRITICAL_FAILURE ? 1 : 0;
      const effectRoll = count ? await new Roll(`${count}d6`).evaluate() : null;
      if (effectRoll && (!Number.isInteger(effectRoll.total) || effectRoll.total < count || effectRoll.total > count * 6)) throw invalid();
      if (!(await fromUuidSafe(crewUuid))) throw new Error(T("SF2eTSC.droneRepair.changed"));
      const current = readStarship(ship);
      const now = valid(current);
      const currentStat = crew.skills?.crafting ?? crew.getStatistic?.("crafting");
      if (
        !equalState(snapshot(current), snapshot(before)) ||
        (tier.rank && (!Number.isInteger(currentStat?.rank) || currentStat.rank < tier.rank)) ||
        initial.zone !== now.zone ||
        initial.round !== now.round ||
        initial.turn !== now.turn
      )
        throw new Error(T("SF2eTSC.droneRepair.changed"));
      let report = T("SF2eTSC.droneRepair.none");
      if (degree === DEGREE.SUCCESS || degree === DEGREE.CRITICAL_SUCCESS) {
        const hpBefore = data.hp.value;
        data.hp.value = Math.min(data.hp.max, hpBefore + effectRoll.total + tier.bonus);
        const r = resolveHullRestored(
          { compromised: data.compromised, wrecked: data.wrecked, inoperable: data.inoperable },
          hpBefore,
          data.hp.value
        );
        data.compromised = r.compromised;
        data.wrecked = r.wrecked;
        data.inoperable = r.inoperable;
        lostCompromised = r.lostCompromised;
        report = T("SF2eTSC.droneRepair.applied", { amount: data.hp.value - hpBefore, before: hpBefore, after: data.hp.value });
      } else if (degree === DEGREE.CRITICAL_FAILURE) {
        damageDraft = new Draft(combat, { trackCombat: false });
        damageDraft.ships.set(ship.uuid, { actor: ship, before, data });
        const damage = await applyDamageInDraft(damageDraft, ship.uuid, {
          amount: effectRoll.total,
          damageType: "piercing",
          source: T("SF2eTSC.droneRepair.title"),
          silent: true
        });
        report = T("SF2eTSC.droneRepair.damage", { rolled: effectRoll.total, sp: damage.shieldDamage, hp: damage.hullDamage });
      }
      changed = !equalState(snapshot(before), snapshot(data));
      data.droneRepairReceipts = { ...receipts, [options.repairId]: fingerprint };
      resultData = {
        degree,
        total: roll.total,
        modifiers: boost.map((m) => `${m.label ?? m.slug} (${m.type} ${m.value >= 0 ? "+" : ""}${m.value})`).join(", "),
        effect: effectRoll ? `${count}d6 = ${effectRoll.total}${tier.bonus && degree >= DEGREE.SUCCESS ? ` + ${tier.bonus}` : ""}` : "—",
        report,
        stationName: initial.station.name
      };
      return { ok: true, changed, replayed: false };
    },
    writeOptions
  );
  if (result.replayed) return result;
  // Запись уже сохранена: дальнейшая ошибка не должна предлагать повтор игрового эффекта.
  const follow = async (fn) => {
    try {
      await fn();
    } catch (err) {
      log.error("Drone repair was saved, but a follow-up failed", err);
      ui.notifications?.warn?.(T("SF2eTSC.droneRepair.savedWarning"));
    }
  };
  if (changed)
    await follow(() =>
      recordChange(ship, before, readStarship(ship), { reason: T("SF2eTSC.droneRepair.title"), undoable: false, announce: false })
    );
  if (lostCompromised) await follow(() => Initiative.leaveCompromised(combat, ship));
  for (const [name, ...args] of damageDraft?.hooks ?? []) await follow(() => Hooks.callAll(name, ...args));
  for (const fn of damageDraft?.after ?? []) await follow(fn);
  await follow(() =>
    postActionCard({
      actor: ship,
      action,
      crewName: crew.name,
      stationName: resultData.stationName,
      degreeLabel: T(`SF2eTSC.degree.${DEGREE_KEYS[resultData.degree]}`),
      lines: [
        { label: T("SF2eTSC.ui.target"), value: ship.name },
        { label: T("SF2eTSC.chat.check"), value: T("SF2eTSC.chat.vsDC", { total: resultData.total, dc: tier.dc }) },
        ...(resultData.modifiers ? [{ label: T("SF2eTSC.droneRepair.modifiers"), value: resultData.modifiers }] : []),
        { label: T("SF2eTSC.droneRepair.dice"), value: resultData.effect }
      ],
      reports: [resultData.report]
    })
  );
  return { ...result, degree: resultData.degree };
}
