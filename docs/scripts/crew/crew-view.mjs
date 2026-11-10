/** Crew panel view model, shared by the Crew Manager window and the starship sheet "Crew" tab. */
import { readStarship } from "../starship/starship-state.mjs";
import { combatantForActor } from "../combat/tsc-state.mjs";
import { Crew } from "./crew-service.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError } from "../utils/logging.mjs";
import { permissionsFor } from "./permissions.mjs";
import { occupantView } from "./occupant.mjs";
import { stationOptions } from "./station-options.mjs";

/** One ship card of the crew panel (null when the user may not view the ship). */
export function crewShipView(ship, { combat = null, isGM = game.user.isGM } = {}) {
  const d = readStarship(ship);
  const perms = permissionsFor(game.user, ship);
  if (!isGM && !perms.has("viewShip")) return null;
  const rows = d.crew.map((c) => {
    const a = fromUuidSync(c.actorUuid);
    const st = d.stations.find((s) => s.helmedBy === c.actorUuid);
    const cb = combat ? combatantForActor(combat, a) : null;
    const user = game.users.find((u) => a?.testUserPermission?.(u, "OWNER") && !u.isGM);
    const occupant = occupantView(c.actorUuid, { fallbackName: c.name });
    return {
      actorUuid: c.actorUuid,
      occupant,
      combatantMissing: !!combat && !!a && !cb && c.role !== "observer",
      name: occupant.name,
      player: user?.name ?? "—",
      role: T(`SF2eTSC.roles.${c.role}`),
      station: st?.name ?? "—",
      stationId: st?.id ?? "",
      roleId: c.role,
      ready: !!c.ready,
      mine: !!a?.testUserPermission?.(game.user, "OWNER") || (!!c.userId && c.userId === game.user.id),
      stations: stationOptions(d, c.actorUuid),
      observer: c.role === "observer"
    };
  });
  const posts = d.stations.map((s) => ({
    id: s.id,
    name: s.name,
    malf: s.malfunctioning,
    free: !s.helmedBy,
    occupant: occupantView(s.helmedBy, { fallbackName: d.crew.find((c) => c.actorUuid === s.helmedBy)?.name ?? null })
  }));
  const free = d.stations.filter((s) => !s.helmedBy).map((s) => ({ id: s.id, name: s.name, malf: s.malfunctioning }));
  const canAssign = isGM || perms.has("assignCrew");
  for (const r of rows) r.canChange = !r.observer && (r.mine || canAssign);
  const myCrewUuid = rows.find((r) => r.mine && !r.observer)?.actorUuid ?? null;
  return {
    uuid: ship.uuid,
    name: ship.name,
    rows,
    posts,
    free,
    canAssign,
    myCrewUuid,
    small: d.crew.filter((c) => c.role !== "observer").length < 4
  };
}

/** Wire the per-row station selects (idempotent: each select is wired once). */
export function wireCrewSelects(root, rerender = () => {}) {
  root?.querySelectorAll?.("select[data-station-select]").forEach((sel) => {
    if (sel.dataset.tscWired) return;
    sel.dataset.tscWired = "1";
    sel.addEventListener("change", async () => {
      const { shipUuid, crewUuid, current } = sel.dataset;
      const next = sel.value;
      if (next === current) return;
      sel.blur();
      try {
        if (!next) {
          await Crew.release(shipUuid, current, crewUuid);
          return;
        }
        const opt = sel.selectedOptions[0];
        // occupied station: GM / crew managers reassign it (the previous occupant is moved off); others get the "occupied" error
        await Crew.claim(shipUuid, next, crewUuid, opt?.dataset.occupied === "true" && sel.dataset.canAssign === "true");
      } catch (err) {
        notifyError("SF2eTSC.errors.generic", { message: err.message });
      } finally {
        rerender();
      }
    });
  });
}
