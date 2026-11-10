import { isStarship, patchStarship, readStarship } from "../starship/starship-state.mjs";
import { fromUuidSync_, isActiveGM, T } from "../utils/foundry.mjs";
import { log } from "../utils/logging.mjs";

/** Снимок события, чтобы лечение или повторное управление до записи не отменили завершение. */
export function petEndCandidates(data, now, resolve, deletedUuid = null) {
  const stations = data.stations ?? [];
  const result = [];
  for (const station of stations) {
    const session = station?.tscPetOnboard;
    if (
      !session ||
      session.ended === true ||
      typeof session.sessionId !== "string" ||
      !station.id ||
      stations.filter((s) => s?.id === station.id).length !== 1
    )
      continue;
    const pet = resolve(session.petUuid);
    const hp = pet?.system?.attributes?.hp?.value;
    const expired = Number.isFinite(session.end) && Number.isFinite(now) && now >= session.end;
    const noHelm = station.helmedBy !== session.operatorUuid;
    const gone = !!deletedUuid && deletedUuid === session.petUuid;
    const incapacitated = pet?.uuid === session.petUuid && Number.isFinite(hp) && hp <= 0;
    const noUpgrade = (data.upgrades ?? []).filter((u) => u.ref === "pet-drone-shell" && u.stationId === station.id).length !== 1;
    if (expired || noHelm || gone || incapacitated || noUpgrade) result.push({ stationId: station.id, sessionId: session.sessionId });
  }
  return result;
}

/** Активный GM записывает необратимую отметку окончания, не изменяя системные эффекты. */
export async function observePetCabins({ now = game.time?.worldTime, deletedUuid = null } = {}) {
  if (!isActiveGM()) return 0;
  // Не ждём записи прежде чем снять все снимки: событие могло измениться при ожидании очереди.
  const jobs = game.actors
    .filter((actor) => isStarship(actor) && !actor.pack)
    .map((actor) => ({ actor, candidates: petEndCandidates(readStarship(actor), now, fromUuidSync_, deletedUuid) }))
    .filter((job) => job.candidates.length);
  let ended = 0;
  for (const { actor, candidates } of jobs) {
    if (!isActiveGM()) break;
    let changed = 0;
    try {
      await patchStarship(
        actor,
        (data) => {
          if (!isActiveGM()) return;
          for (const candidate of candidates) {
            const stations = data.stations.filter((s) => s.id === candidate.stationId);
            const session = stations.length === 1 ? stations[0].tscPetOnboard : null;
            if (session?.sessionId === candidate.sessionId && session.ended !== true) {
              session.ended = true;
              changed++;
            }
          }
        },
        { reason: T("SF2eTSC.petCabin.title"), undoable: false, announce: false }
      );
      if (changed) {
        ended += changed;
        ui.notifications?.info?.(T("SF2eTSC.petCabin.autoEnded", { ship: actor.name }));
      }
    } catch (error) {
      log.error("pet cabin end marker failed; GM must review", error);
      ui.notifications?.warn?.(T("SF2eTSC.petCabin.monitorFailed"));
    }
  }
  return ended;
}

export function registerPetCabinMonitor() {
  const run = (options = {}) => {
    observePetCabins(options).catch((error) => {
      log.error("pet cabin monitoring failed", error);
      ui.notifications?.warn?.(T("SF2eTSC.petCabin.monitorFailed"));
    });
  };
  Hooks.on("updateActor", () => run());
  Hooks.on("deleteActor", (actor) => run({ deletedUuid: actor?.uuid }));
  Hooks.on("updateWorldTime", (now) => run({ now }));
  run(); // Восстановление при загрузке; события без активного GM могут быть пропущены.
}
