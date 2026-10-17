import { TscApp, tpl } from "./base-app.mjs";
import { Content } from "../content/loader.mjs";
import { buildPlayerShipData, buildShipActorData } from "../content/ship-docs.mjs";
import { frameStatsAtLevel, stationGradeForLevel } from "../engine/advancement.mjs";
import { normalizeStarship } from "../engine/validation.mjs";
import { STATION_TYPES } from "../constants.mjs";
import { Crew } from "../crew/crew-service.mjs";
import { T } from "../utils/foundry.mjs";
import { notifyError, notifyInfo } from "../utils/logging.mjs";
import { randomId } from "../utils/ids.mjs";
import { docI18nOptions } from "../content/importer.mjs";
import { ct } from "../content/content-i18n.mjs";
import { stationTypeLabel, zonesText } from "../utils/labels.mjs";

/** Starship Builder: Name > Player/NPC > Level > Frame > Size > Stats > Stations > Weapons > Bays > Crew > Map. Frame is only a template. */
export class StarshipBuilder extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-builder",
    tag: "form",
    window: { title: "SF2eTSC.ui.starshipBuilder", icon: "fa-solid fa-screwdriver-wrench" },
    position: { width: 620, height: 720 },
    form: { handler: StarshipBuilder.#submit, closeOnSubmit: false, submitOnChange: false },
    actions: { recalc: StarshipBuilder.#recalc }
  };
  static PARTS = { main: { template: tpl("starship-builder") } };
  draft = { name: "", kind: "player", level: 1, frameId: "explorer", size: "medium" };
  async _prepareContext() {
    const d = this.draft;
    const frame = Content.frames.get(d.frameId);
    const row = frameStatsAtLevel(frame, d.level) ?? {};
    return {
      d,
      frames: [...Content.frames.values()].map((f) => ({ id: f.id, name: ct(f.name), sel: f.id === d.frameId })),
      stats: {
        hp: d.hp ?? row.hp,
        sp: d.sp ?? row.sp,
        ac: d.ac ?? row.ac,
        fort: d.fort ?? row.fort,
        ref: d.ref ?? row.ref,
        will: d.will ?? row.will,
        speed: d.speed ?? row.speed,
        sensor: d.sensor ?? frame?.sensorRange
      },
      sizes: ["tiny", "small", "medium", "large", "huge", "gargantuan"].map((s) => ({ id: s, sel: s === (d.size ?? frame?.size) })),
      stations: STATION_TYPES.filter((s) => s !== "custom").map((s) => ({
        id: s,
        name: stationTypeLabel(s),
        checked: d.stations ? d.stations.includes(s) : ["pilot", "generator", "gunnery", "scanners"].includes(s)
      })),
      weapons: [...Content.weapons.values()].map((w) => ({ id: w.id, name: `${ct(w.name)} (${w.die}, ${zonesText(`${w.range} zones`)})` })),
      characters: game.actors
        .filter((a) => a.type === "character" && a.hasPlayerOwner)
        .map((a) => ({ uuid: a.uuid.replace(/\./g, "__DOT__"), name: a.name })),
      npc: d.kind === "npc"
    };
  }
  static #recalc(event, target) {
    const f = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    this.draft = {
      ...this.draft,
      name: f.name,
      kind: f.kind,
      level: Number(f.level) || 1,
      frameId: f.frame,
      size: f.size,
      hp: undefined,
      sp: undefined,
      ac: undefined,
      fort: undefined,
      ref: undefined,
      will: undefined,
      speed: undefined,
      sensor: undefined
    };
    this.render();
  }
  static async #submit(event, form, formData) {
    try {
      const f = foundry.utils.expandObject(formData.object);
      const name = (f.name ?? "").trim();
      const level = Number(f.level);
      const frame = Content.frames.get(f.frame);
      const stats = {
        hp: Number(f.hp),
        sp: Number(f.sp),
        ac: Number(f.ac),
        fort: Number(f.fort),
        ref: Number(f.ref),
        will: Number(f.will),
        speed: Number(f.speed),
        sensor: Number(f.sensor)
      };
      const problems = [];
      if (!name) problems.push(T("SF2eTSC.builder.needName"));
      if (!Number.isInteger(level) || level < 1 || level > 20) problems.push(T("SF2eTSC.builder.badLevel"));
      if (!Number.isInteger(stats.hp) || stats.hp < 1) problems.push(T("SF2eTSC.builder.badHp"));
      if (!Number.isInteger(stats.speed) || stats.speed < 0) problems.push(T("SF2eTSC.builder.badSpeed"));
      if (!Number.isInteger(stats.sensor) || stats.sensor < 0) problems.push(T("SF2eTSC.builder.badSensor"));
      if (problems.length) return ui.notifications.error(problems.join(" · "));
      const picked = Object.entries(f.station ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      const stations = picked.map((type) => ({ type, grade: stationGradeForLevel(type, level) }));
      let data;
      if (f.kind === "player") {
        data = buildPlayerShipData({ name, frame, level, stations, i18n: docI18nOptions() });
        const fl = data.flags["sf2e-tactical-starship-combat"].starship;
        Object.assign(fl, {
          size: f.size,
          sensorRange: stats.sensor,
          speed: stats.speed,
          ac: stats.ac,
          fort: stats.fort,
          reflex: stats.ref,
          will: stats.will,
          sp: { value: stats.sp, max: stats.sp }
        });
        data.system.attributes.hp = { value: stats.hp, max: stats.hp };
      } else {
        data = buildShipActorData(
          {
            id: `custom-${randomId()}`,
            name,
            level,
            size: f.size,
            traits: ["tech"],
            hp: stats.hp,
            sp: stats.sp,
            ac: stats.ac,
            fort: stats.fort,
            ref: stats.ref,
            will: stats.will,
            perception: Number(f.perception) || level + 8,
            speed: stats.speed,
            sensorRange: stats.sensor,
            stations: picked.map((type) => ({ type, actions: [] })),
            strikes: [],
            actions: [],
            skills: {}
          },
          { i18n: docI18nOptions() }
        );
      }
      const check = normalizeStarship(data.flags["sf2e-tactical-starship-combat"].starship);
      if (check.errors.length) return ui.notifications.error(check.errors.join(" · "));
      if (f.weapon && f.kind === "player") {
        const w = Content.weapons.get(f.weapon);
        if (w)
          data.flags["sf2e-tactical-starship-combat"].starship.weapons.push({
            id: randomId("wpn"),
            weaponRef: w.id,
            name: w.name,
            die: w.die,
            damageType: w.damageType,
            range: w.range,
            traits: w.traits,
            category: w.category,
            stationId: `gunnery-${picked.indexOf("gunnery") + 1}`
          });
      }
      const bays = (f.bays ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (bays.length && f.kind === "player")
        data.flags["sf2e-tactical-starship-combat"].starship.expansionBays = bays.map((n, i) => ({ id: `bay-${i + 1}`, name: n }));
      const actor = await Actor.create(data);
      const crew = Object.entries(f.crew ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k.replace(/__DOT__/g, "."));
      for (const uuid of crew) await Crew.add(actor.uuid, uuid, "crew");
      notifyInfo("SF2eTSC.builder.created", { name: actor.name });
      actor.sheet.render(true);
    } catch (err) {
      notifyError("SF2eTSC.errors.generic", { message: err.message });
    }
  }
}
