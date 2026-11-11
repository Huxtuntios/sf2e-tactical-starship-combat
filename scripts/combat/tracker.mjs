import { MODULE_ID } from "../constants.mjs";
import { Initiative } from "./initiative.mjs";
import { isStarshipCombat } from "./tsc-state.mjs";
import { readStarship, statusOf } from "../starship/starship-state.mjs";
import { T, escapeHtml } from "../utils/foundry.mjs";
import { syncCrewCombatants } from "./crew-sync.mjs";
import { openSensorMap, openStartWizard } from "../ui/launchers.mjs";
import { can } from "../crew/permissions.mjs";

const ICON = { ship: "🚀", compromised: "⚠🚀", hazard: "⚠" };

/**
 * exact Hull / Shield Points are shown only to viewers allowed to see the ship (GM, owner/observer of the
 * actor, or a crew member — the viewShip permission). Everyone else gets level and status only, so the tracker no
 * longer leaks enemy HP/SP that the sensor map keeps hidden.
 */
export function canSeeShipPools(user, ship) {
  if (!user || !ship) return false;
  if (user.isGM) return true;
  try {
    return can(user, ship, "viewShip");
  } catch {
    return false;
  }
}
export function shipBadgeHTML(d, { kind = "ship", showPools = false } = {}) {
  const status = escapeHtml(T(`SF2eTSC.status.${statusOf(d)}`));
  const pools = showPools
    ? ` <span class="hp" title="${T("SF2eTSC.ui.hullPoints")}">${d.hp.value}/${d.hp.max}</span> <span class="sp" title="${T("SF2eTSC.ui.shieldPoints")}">${d.sp.value}/${d.sp.max}</span>`
    : "";
  return `<span class="tsc-badge" title="${status}"><span class="ic" aria-hidden="true">${ICON[kind] ?? ICON.ship}</span> <b>L${d.level}</b>${pools} <span class="st">${status}</span></span>`;
}

/** Decorate (never replace) the native Combat Tracker: starship icon, level, HP/SP, status, action pips, hazard icon, buttons. */
export function decorateTracker(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const combat = app.viewed ?? game.combat;
  if (!root || !combat) return;
  const enabled = isStarshipCombat(combat);
  for (const li of root.querySelectorAll("li.combatant[data-combatant-id]")) {
    li.querySelector(".tsc-badge")?.remove();
    const c = combat.combatants.get(li.dataset.combatantId);
    if (!c?.actor) continue;
    const kind = Initiative.kindOf(c);
    let html = "";
    if (kind === "ship" || kind === "compromised") {
      const ship = kind === "compromised" ? fromUuidSync(c.flags[MODULE_ID].shipUuid) : c.actor;
      if (!ship) continue;
      const d = readStarship(ship);
      html = shipBadgeHTML(d, { kind, showPools: canSeeShipPools(game.user, ship) });
    } else if (kind === "hazard") {
      html = `<span class="tsc-badge"><span class="ic" aria-hidden="true">${ICON.hazard}</span> <span class="st">${T("SF2eTSC.hazards.complex")}</span></span>`;
    }
    if (html) (li.querySelector(".token-name, .combatant-name, .name") ?? li).insertAdjacentHTML("afterend", html);
  }
  root.querySelector(".tsc-tracker-controls")?.remove();
  const bar = document.createElement("div");
  bar.className = "tsc-tracker-controls";
  if (enabled)
    bar.insertAdjacentHTML(
      "beforeend",
      `<button type="button" data-tsc="map"><i class="fa-solid fa-satellite"></i> ${T("SF2eTSC.ui.openSensorMap")}</button>`
    );
  if (game.user.isGM) {
    if (enabled)
      bar.insertAdjacentHTML(
        "beforeend",
        `<button type="button" data-tsc="syncCrew" data-combat-id="${combat.id}" title="${T("SF2eTSC.initiative.syncCrew")}"><i class="fa-solid fa-users-gear"></i></button>`
      );
    if (!enabled)
      bar.insertAdjacentHTML(
        "beforeend",
        `<button type="button" data-tsc="wizard" class="tsc-start"><i class="fa-solid fa-jet-fighter"></i> ${T("SF2eTSC.ui.startCombat")}</button>`
      );
  }
  if (!bar.children.length) return;
  bar.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-tsc]");
    if (!b) return;
    if (b.dataset.tsc === "map") openSensorMap();
    else if (b.dataset.tsc === "wizard") openStartWizard();
    else if (b.dataset.tsc === "syncCrew") {
      try {
        const r = await syncCrewCombatants(await resolveTrackerCombat(b.dataset.combatId), null, { notify: true });
        ui.notifications.info(
          T("SF2eTSC.initiative.syncDone", { created: r.created.length, existing: r.existing.length, missing: r.missing.length })
        );
      } catch (err) {
        ui.notifications.error(err.message);
      }
    }
  });
  (root.querySelector("header, .combat-tracker-header") ?? root).insertAdjacentElement("afterend", bar);
}

/**
 * The tracker may hold a stale Combat reference (deleted/recreated encounter, popped-out tracker, sf2e's viewed combat).
 * Always resolve a live document from the world collection; create an encounter for the current scene if none exists.
 */
export async function resolveTrackerCombat(id) {
  const live = (c) => (c && game.combats.has(c.id) ? game.combats.get(c.id) : null);
  let c = (id && game.combats.get(id)) ?? live(ui.combat?.viewed) ?? live(game.combat) ?? null;
  if (!c) {
    const Cls = CONFIG.Combat.documentClass;
    c = await Cls.create({ scene: canvas.scene?.id ?? null, active: true });
  }
  return c;
}
