import { stationDCRows, linkContextDCs } from "../../rolls/context-dc.mjs";
import { checkLinksHTML } from "../../content/inline-checks.mjs";
import { effectCaption } from "../effect-editor.mjs";
/** Starship sheet: render context (one object for all parts). */
import { sheetThemeOptions } from "./sheet-theme.mjs";
import { occupantView } from "../../crew/occupant.mjs";
import { crewShipView } from "../../crew/crew-view.mjs";
import { GRADES, STATION_TYPES } from "../../constants.mjs";
import { Content, actionsForStation } from "../../content/loader.mjs";
import { readStarship, statusOf, activeCrew } from "../../starship/starship-state.mjs";
import { computeShipStats } from "../../starship/stats.mjs";
import { activeStarshipCombat, getTsc } from "../../combat/tsc-state.mjs";
import { findObject } from "../../engine/sensor-ops.mjs";
import { gradeIndex } from "../../engine/advancement.mjs";
import { permissionsFor, roleOf } from "../../crew/permissions.mjs";
import { COST_ICON } from "../action-runner.mjs";
import { actionLabel } from "../../actions/action-engine.mjs";
import { T } from "../../utils/foundry.mjs";
import { ct, ctPlain } from "../../content/content-i18n.mjs";
import { traitsText, damageTypeLabel, stationTypeLabel, zonesText } from "../../utils/labels.mjs";
import { formatKv, NPC_COSTS } from "../sheet-edit.mjs";
import { shipCheckRows, sheetAttackRows, statCells, skillCheckRows, pilotingSaveButtons } from "../../rolls/ship-rolls.mjs";
import { strikeListRows, canRoll, safeRows, mine, npcActionRows } from "./sheet-rows.mjs";
import { stationUpgradeView, shipUpgradeView } from "./sheet-upgrades.mjs";

export async function buildSheetContext(sheet) {
  const actor = sheet.document;
  const data = readStarship(actor);
  const stats = computeShipStats(actor);
  const perms = permissionsFor(game.user, actor);
  const isGM = game.user.isGM;
  const combat = activeStarshipCombat();
  const tsc = combat ? getTsc(combat) : null;
  const obj = tsc ? findObject(tsc, actor.uuid) : null;
  const frame = Content.frames.get(data.frame);
  const upgradeOpts = { isGM, canEdit: isGM || perms.has("editEquipment") };
  const stations = data.stations.map((st) => {
    const crew = st.helmedBy ? fromUuidSync(st.helmedBy) : null;
    const def = Content.stations.get(st.type);
    const acts = (sheet.isNpc ? [] : actionsForStation(st.type, st.grade, gradeIndex)).map((a) => ({
      id: a.id,
      enabled: true,
      name: actionLabel(a),
      icon: COST_ICON(a.cost),
      text: ctPlain(a.text),
      html: checkLinksHTML(linkContextDCs(ct(a.text), { crew, ship: actor }))
    }));
    const occupant = occupantView(st.helmedBy, { fallbackName: data.crew.find((c) => c.actorUuid === st.helmedBy)?.name ?? null });
    return {
      ...st,
      dcRows: stationDCRows(crew),
      name: ct(st.name),
      occupant,
      typeLabel: def ? ct(def.name) : stationTypeLabel(st.type),
      icon: def?.icon,
      grade: st.grade,
      gradeLabel: T(`SF2eTSC.grades.${st.grade}`),
      helmName: crew?.name ?? occupant.name ?? null,
      occupied: !!st.helmedBy,
      upgradeSection: stationUpgradeView(sheet, data, st, upgradeOpts),
      actionList: acts,
      canConfig: perms.has("configureShip"),
      isGunnery: st.type === "gunnery",
      weaponId: st.weaponId,
      claimedByMe: mine(st)
    };
  });
  const crewRows = data.crew.map((c) => {
    const a = fromUuidSync(c.actorUuid);
    const st = data.stations.find((s) => s.helmedBy === c.actorUuid);
    const user = game.users.find((u) => a?.testUserPermission?.(u, "OWNER") && !u.isGM);
    const occupant = occupantView(c.actorUuid, { fallbackName: c.name });
    return {
      ...c,
      occupant,
      name: occupant.name,
      img: occupant.img,
      missing: occupant.missing,
      player: user?.name ?? "—",
      roleLabel: T(`SF2eTSC.roles.${c.role}`),
      station: st ? ct(st.name) : "—",
      stationId: st?.id ?? "",
      canManage: isGM || perms.has("assignCrew")
    };
  });
  const npcWarnings = [];
  const npcActions = sheet.isNpc ? npcActionRows(data, actor, stations, npcWarnings) : [];
  if (sheet.isNpc) for (const station of stations) station.actionList = npcActions.filter((row) => row.stationId === station.id);
  return {
    sheetThemeOptions: sheetThemeOptions(),
    actor,
    isGM,
    isNpc: sheet.isNpc,
    tab: sheet.tab,
    tabs: sheet.tabs.map((t) => ({
      id: t,
      label: T(`SF2eTSC.tabs.${t}`),
      active: t === sheet.tab,
      visible: t !== "config" || perms.has("configureShip")
    })),
    ship: {
      ...data,
      hullDC: 10 + data.compromised,
      status: statusOf(data),
      statusLabel: T(`SF2eTSC.status.${statusOf(data)}`),
      role: data.role,
      roleLabel: T(`SF2eTSC.roleTypes.${data.role}`),
      frameName: frame ? ct(frame.name) : "—",
      sizeLabel: data.size,
      hpPct: Math.round((data.hp.value / Math.max(1, data.hp.max)) * 100),
      spPct: Math.round((data.sp.value / Math.max(1, data.sp.max)) * 100),
      zone: obj?.zone ?? null,
      headingNow: obj?.heading ?? data.heading,
      headingLabel: T(`SF2eTSC.heading.${obj?.heading ?? data.heading}`),
      headingArrow: (obj?.heading ?? data.heading) === "left" ? "←" : "→"
    },
    stats,
    perms: Object.fromEntries([...perms].map((p) => [p, true])),
    role: roleOf(game.user, actor),
    stations,
    crew: crewRows,
    weapons: data.weapons.map((w) => ({
      ...w,
      name: ct(w.name),
      damageLabel: damageTypeLabel(w.damageType),
      traitsLabel: traitsText(w.traits)
    })),
    shipUpgrades: shipUpgradeView(sheet, data, upgradeOpts),
    bays: data.expansionBays,
    crewShip: sheet.isNpc ? null : crewShipView(actor, { combat: activeStarshipCombat(), isGM }),
    smallCrew: activeCrew(data).length < 4 && !sheet.isNpc,
    effects: data.effects.map((e) => ({
      id: e.id,
      label: ct(e.label),
      timingText: effectCaption(e),
      sustain: e.timing?.sustain,
      condition: e.timing?.mode === "condition",
      text: e.modifiers.map((m) => `${m.selector} ${m.value > 0 ? "+" : ""}${m.value}`).join(", ") || (e.conditions ?? []).join(", ")
    })),
    log: tsc
      ? tsc.log
          .filter((l) => l.data?.shipUuid === actor.uuid || l.text.startsWith(actor.name))
          .slice(-15)
          .reverse()
          .map((l) => l.text)
      : [],
    catalog: {
      weapons: [...Content.weapons.values()].map((w) => ({ id: w.id, name: `${ct(w.name)} (${w.die}, ${zonesText(`${w.range} zones`)})` })),
      frames: [...Content.frames.values()].map((f) => ({ id: f.id, name: ct(f.name), sel: f.id === data.frame })),
      stationTypes: STATION_TYPES.map((t) => ({ id: t, name: stationTypeLabel(t) })),
      grades: GRADES.map((g) => ({ id: g, name: T(`SF2eTSC.grades.${g}`) })),
      roles: ["captain", "crew", "observer"].map((r) => ({ id: r, name: T(`SF2eTSC.roles.${r}`) })),
      shipRoles: ["player", "npc", "ally", "neutral", "autonomous", "living"].map((r) => ({
        id: r,
        name: T(`SF2eTSC.roleTypes.${r}`),
        sel: r === data.role
      }))
    },
    edit: {
      traits: (data.traits ?? []).join(", "),
      immunities: (data.immunities ?? []).join(", "),
      resistances: formatKv(data.resistances),
      weaknesses: formatKv(data.weaknesses),
      skills: formatKv(data.skills),
      sizes: ["tiny", "small", "medium", "large", "huge", "gargantuan"].map((id) => ({ id, sel: id === data.size })),
      stations: data.stations.map((st) => ({ ...st, actionsText: (st.actions ?? []).join(", ") })),
      weapons: data.weapons.map((w) => ({ ...w, traitsText: (w.traits ?? []).join(", ") })),
      strikes: (data.strikes ?? []).map((x) => ({ ...x, traitsText: (x.traits ?? []).join(", ") })),
      npcActions: (data.npcActions ?? []).map((x) => ({ ...x, traitsText: (x.traits ?? []).join(", ") })),
      costs: NPC_COSTS.map((id) => ({ id, name: T(`SF2eTSC.edit.cost.${id}`) }))
    },
    npcActions,
    strikes: strikeListRows(data.strikes),
    hullCheckable: data.compromised > 0,
    holodock: !!game.modules.get("holodock")?.active,
    warnings: [...new Set([...(data._errors ?? []), ...(data._warnings ?? []), ...npcWarnings])],
    inCombat: !!combat,
    mapPlaced: !!obj,
    canRoll: canRoll(sheet.document),
    ...checkContext(sheet.document),
    sheetAttacks: canRoll(sheet.document) ? safeRows(sheet.document, sheetAttackRows) : []
  };
}

/** Overview rolls: the stat grid cells (Perception + saves) and the skill-only checks list. */
function checkContext(actor) {
  const rollable = canRoll(actor);
  const rows = rollable ? safeRows(actor, shipCheckRows) : [];
  return { shipChecks: skillCheckRows(rows), statCells: statCells(rows, { canRoll: rollable }), pilotingSaves: pilotingSaveButtons(actor) };
}
