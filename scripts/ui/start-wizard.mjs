import { clampCount, MAX_COPIES, parseZoneList } from "../combat/copies.mjs";
import { TscApp, tpl } from "./base-app.mjs";
import { isStarship, readStarship } from "../starship/starship-state.mjs";
import { startStarshipCombat } from "../combat/starship-combat.mjs";
import { worldHazardChoices, compendiumHazardChoices } from "../sensor/contact-service.mjs";
import { fromUuidSafe, fromUuidSync_, moduleSetting, T } from "../utils/foundry.mjs";
import { notifyError } from "../utils/logging.mjs";
import { openDashboard } from "./launchers.mjs";
import { combatantForActor } from "../combat/tsc-state.mjs";
import { occupantView } from "../crew/occupant.mjs";
import { ZONE_LIMITS, DETECTION_LEVELS } from "../constants.mjs";
import { listPresets, savePreset, deletePreset, normalizeDetection, clampZones, DEFAULT_ZONES } from "../combat/presets.mjs";
import { safeImagePath } from "../sensor/appearance.mjs";
import { OBJECT_TYPES, objectType } from "../sensor/object-types.mjs";
export { OBJECT_TYPES } from "../sensor/object-types.mjs";

const clone = (value) => structuredClone(value);
const keyOf = (uuid, kind) => JSON.stringify([uuid, kind]);
const optionsFor = (ids, value, label) => ids.map((id) => ({ id, label: label(id), selected: id === value }));

export class StartCombatWizard extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-start",
    tag: "form",
    classes: ["sf2e-tsc", "tsc-start-wizard-window"],
    window: { title: "SF2eTSC.ui.startCombat", icon: "fa-solid fa-jet-fighter" },
    position: { width: 840, height: 720 },
    form: { handler: StartCombatWizard.#submit, closeOnSubmit: false },
    actions: {
      addSelected: StartCombatWizard.#addSelected,
      removeRoster: StartCombatWizard.#removeRoster,
      removeAssignment: StartCombatWizard.#removeAssignment,
      refreshSources: StartCombatWizard.#refreshSources,
      editDraft: StartCombatWizard.#editDraft,
      cancel: StartCombatWizard.#cancel,
      pickObjectArt: StartCombatWizard.#pickObjectArt,
      addObjRow: StartCombatWizard.#addObjRow,
      removeObjRow: StartCombatWizard.#removeObjRow,
      loadPreset: StartCombatWizard.#loadPreset,
      deletePreset: StartCombatWizard.#deletePreset,
      savePreset: StartCombatWizard.#savePreset
    }
  };
  static PARTS = { main: { template: tpl("start-wizard") } };
  #zones = null;
  #roster = [];
  #objects = [];
  #crew = new Set();
  #excluded = new Set();
  #selected = new Map();
  #actors = new Map();
  #choices = new Map();
  #compendium = null;
  #browse = { source: "world", filter: "", kind: "all", pack: "" };
  #presetPick = "";
  #presetName = "";
  #nextId = 0;
  #review = null;
  #busy = false;
  #completed = false;
  #closed = false;
  #error = "";

  #zone(value, fallback = 1) {
    return Math.min(clampZones(this.#zones), Math.max(1, Math.round(Number(value)) || fallback));
  }
  #shipData(row) {
    const actor = this.#actors.get(row.uuid);
    return actor && isStarship(actor) ? readStarship(actor) : null;
  }
  #worldCharacters() {
    return (game.actors?.contents ?? []).filter((a) => a.type === "character" && !a.pack && !a.isToken && !isStarship(a));
  }
  #playerRows() {
    return this.#roster.filter((row) => row.kind === "starship" && row.role === "player");
  }
  #existingCrew() {
    return this.#playerRows().flatMap((row) => this.#shipData(row)?.crew ?? []);
  }
  #observers() {
    return new Set(
      this.#existingCrew()
        .filter((c) => c.role === "observer")
        .map((c) => c.actorUuid)
    );
  }
  #canReuse(row) {
    const actor = this.#actors.get(row.uuid);
    return !!(
      actor &&
      !actor.pack &&
      !actor.isToken &&
      !row.missing &&
      clampCount(row.count) === 1 &&
      normalizeDetection(row.detection) === "identified" &&
      (row.kind === "hazard" || (row.role === "npc" && this.#shipData(row)?.role === "npc"))
    );
  }

  getDraft() {
    return clone(this.#readConfig());
  }
  selectCandidate(uuid, selected = true, kind = null) {
    if (this.#busy || this.#completed) return;
    const choice = [...this.#choices.values()].find((c) => c.uuid === uuid && (!kind || c.kind === kind));
    if (!choice) return;
    const key = keyOf(choice.uuid, choice.kind);
    if (selected) this.#selected.set(key, choice);
    else this.#selected.delete(key);
    this.#invalidateReview();
    this.#syncSelection();
  }
  async addSelected() {
    if (this.#busy || this.#completed) return;
    const choices = [...this.#selected.values()].filter((c) => !this.#roster.some((r) => keyOf(r.uuid, r.kind) === keyOf(c.uuid, c.kind)));
    if (!choices.length) return;
    this.#invalidateReview();
    this.#setBusy(true);
    try {
      const actors = await Promise.all(choices.map((c) => fromUuidSafe(c.uuid)));
      if (this.#closed) return;
      choices.forEach((choice, i) => {
        this.#appendRoster(choice, actors[i]);
        this.#selected.delete(keyOf(choice.uuid, choice.kind));
      });
    } catch (err) {
      this.#showError(err);
    } finally {
      this.#setBusy(false);
      if (!this.#closed) await this.render();
    }
  }
  #appendRoster(choice, actor, spec = {}) {
    if (this.#roster.some((r) => keyOf(r.uuid, r.kind) === keyOf(choice.uuid, choice.kind))) return;
    const valid = actor?.uuid === choice.uuid && (choice.kind === "starship" ? isStarship(actor) : actor?.type === "hazard");
    if (valid) this.#actors.set(choice.uuid, actor);
    const data = valid && choice.kind === "starship" ? readStarship(actor) : null;
    const role = spec.role ?? (data?.role === "player" ? "player" : "npc");
    const eligible = new Set(this.#worldCharacters().map((a) => a.uuid));
    const observers = new Set((data?.crew ?? []).filter((c) => c.role === "observer").map((c) => c.actorUuid));
    const assignments = (data?.stations ?? []).map((s) => ({
      stationId: s.id,
      actorUuid: eligible.has(s.helmedBy) && !observers.has(s.helmedBy) && !this.#excluded.has(s.helmedBy) ? s.helmedBy : null
    }));
    for (const assignment of spec.stationAssignments ?? []) {
      const current = assignments.find((s) => s.stationId === assignment.stationId);
      if (current) current.actorUuid = assignment.actorUuid ?? null;
      else assignments.push({ stationId: assignment.stationId, actorUuid: assignment.actorUuid ?? null });
    }
    const row = {
      id: String(++this.#nextId),
      uuid: choice.uuid,
      kind: choice.kind,
      name: actor?.name ?? choice.name ?? choice.uuid,
      pack: choice.pack ?? actor?.pack ?? "",
      missing: !valid,
      role,
      zone: spec.zone ?? (role === "player" && choice.kind === "starship" ? 2 : Math.ceil(clampZones(this.#zones) / 2)),
      detection: choice.kind === "starship" && role === "player" ? "identified" : normalizeDetection(spec.detection),
      heading: spec.heading === "left" || spec.heading === "right" ? spec.heading : role === "player" ? (data?.heading ?? "right") : "left",
      count: clampCount(spec.count ?? 1),
      zones: Array.isArray(spec.zones) ? spec.zones.join(", ") : String(spec.zones ?? ""),
      reuse: spec.reuse === true,
      stationAssignments: clone(assignments)
    };
    this.#roster.push(row);
    if (!this.#canReuse(row)) row.reuse = false;
  }
  updateRoster(uuid, kind, patch) {
    if (this.#busy || this.#completed) return;
    const row = this.#roster.find((r) => r.uuid === uuid && r.kind === kind);
    if (!row) return;
    for (const field of ["zone", "detection", "heading", "count", "zones", "reuse"])
      if (Object.hasOwn(patch, field)) row[field] = patch[field];
    row.count = clampCount(row.count);
    if (row.kind === "starship" && ["player", "npc"].includes(patch.role)) row.role = patch.role;
    if (row.kind === "starship" && row.role === "player") row.detection = "identified";
    if (!this.#canReuse(row)) row.reuse = false;
    this.#invalidateReview();
  }
  removeRoster(uuid, kind) {
    if (this.#busy || this.#completed) return;
    this.#roster = this.#roster.filter((r) => !(r.uuid === uuid && r.kind === kind));
    this.#invalidateReview();
  }
  async loadDraft(config = {}) {
    if (this.#busy || this.#completed) return;
    this.#invalidateReview();
    this.#setBusy(true);
    try {
      const specs = [
        ...(config.playerShips ?? []).map((s) => ({ ...(typeof s === "string" ? { uuid: s } : s), kind: "starship", role: "player" })),
        ...(config.enemies ?? []).map((s) => ({ ...s, kind: "starship", role: "npc" })),
        ...(config.hazards ?? []).map((s) => ({ ...s, kind: "hazard" }))
      ].filter((s) => typeof s.uuid === "string" && s.uuid);
      const actors = await Promise.all(specs.map((s) => fromUuidSafe(s.uuid)));
      if (this.#closed) return;
      this.#zones = clampZones(config.zones ?? DEFAULT_ZONES);
      this.#roster = [];
      this.#actors.clear();
      this.#crew = new Set(config.crew ?? []);
      this.#excluded = new Set(config.excludeCrew ?? []);
      specs.forEach((spec, i) => this.#appendRoster(this.#choices.get(keyOf(spec.uuid, spec.kind)) ?? spec, actors[i], spec));
      this.#objects = (config.objects ?? []).map((o) => ({
        ...clone(o),
        id: String(++this.#nextId),
        detection: normalizeDetection(o.detection)
      }));
      this.#presetName = config.name ?? "";
      this.#error = "";
    } catch (err) {
      this.#showError(err);
    } finally {
      this.#setBusy(false);
      if (!this.#closed) await this.render();
    }
  }

  async _prepareContext() {
    this.#zones ??= clampZones(moduleSetting("sensorMapSize") ?? DEFAULT_ZONES);
    const world = worldHazardChoices();
    if (this.#browse.source !== "world" && !this.#compendium) {
      this.#compendium = compendiumHazardChoices().catch((err) => {
        this.#compendium = null;
        throw err;
      });
    }
    const compendium = this.#compendium ? await this.#compendium : [];
    this.#choices = new Map([...world, ...compendium].map((c) => [keyOf(c.uuid, c.kind), c]));
    const worldKeys = new Set(world.map((c) => keyOf(c.uuid, c.kind)));
    for (const row of this.#roster) {
      const actor = this.#actors.get(row.uuid);
      row.missing = !actor || (!actor.pack && !worldKeys.has(keyOf(row.uuid, row.kind)));
      if (!this.#canReuse(row)) row.reuse = false;
    }
    const roster = this.#roster.map((row) => this.#rosterContext(row));
    const existing = new Set(this.#existingCrew().map((c) => c.actorUuid));
    const observers = this.#observers();
    const assigned = new Set(
      this.#playerRows()
        .flatMap((r) => r.stationAssignments.map((s) => s.actorUuid))
        .filter(Boolean)
    );
    const characters = this.#worldCharacters()
      .filter((a) => !existing.has(a.uuid) && !observers.has(a.uuid))
      .map((a) => ({
        uuid: a.uuid,
        name: a.name,
        checked: this.#crew.has(a.uuid) || assigned.has(a.uuid)
      }));
    const missingCrew = [...this.#crew]
      .filter((uuid) => !this.#worldCharacters().some((a) => a.uuid === uuid))
      .map((uuid) => ({ uuid, name: uuid, checked: true, missing: true }));
    const candidates = (
      this.#browse.source === "world" ? world : this.#browse.source === "compendium" ? compendium : [...world, ...compendium]
    ).map((c) => ({
      ...c,
      kindLabel: T(`SF2eTSC.contactEditor.kinds.${c.kind}`),
      sourceLabel: c.pack ?? T("SF2eTSC.contactEditor.sources.world"),
      checked: this.#selected.has(keyOf(c.uuid, c.kind)),
      inRoster: this.#roster.some((r) => keyOf(r.uuid, r.kind) === keyOf(c.uuid, c.kind)),
      hidden: !this.#matches(c)
    }));
    return {
      zones: this.#zones,
      zoneMin: ZONE_LIMITS.min,
      zoneMax: ZONE_LIMITS.max,
      maxCopies: MAX_COPIES,
      presets: listPresets().map((p) => ({ ...p, selected: p.id === this.#presetPick })),
      presetName: this.#presetName,
      sources: optionsFor(["world", "compendium", "all"], this.#browse.source, (id) => T(`SF2eTSC.wizard.sources.${id}`)),
      kinds: optionsFor(["all", "starship", "hazard"], this.#browse.kind, (id) => T(`SF2eTSC.wizard.kinds.${id}`)),
      packs: [...new Set(compendium.map((c) => c.pack).filter(Boolean))].sort().map((id) => ({ id, selected: id === this.#browse.pack })),
      filter: this.#browse.filter,
      candidates,
      noCandidates: !candidates.some((c) => !c.hidden),
      selectedCount: this.#selected.size,
      canAdd: this.#pendingCount() > 0,
      roster,
      characters: this.#playerRows().length ? [...characters, ...missingCrew] : [],
      scope: T(`SF2eTSC.settings.crewInitiativeScope.${moduleSetting("crewInitiativeScope")}`),
      objects: this.#objects.map((o) => ({
        ...o,
        types: optionsFor(OBJECT_TYPES, o.type, (id) => T(`SF2eTSC.objectTypes.${id}`)),
        detections: optionsFor(DETECTION_LEVELS, o.detection, (id) => T(`SF2eTSC.detection.${id}`))
      })),
      objectTypes: optionsFor(OBJECT_TYPES, OBJECT_TYPES[0], (id) => T(`SF2eTSC.objectTypes.${id}`)),
      detectionLevels: optionsFor(DETECTION_LEVELS, "observed", (id) => T(`SF2eTSC.detection.${id}`)),
      midZone: Math.ceil(clampZones(this.#zones) / 2),
      review: this.#review ? this.#previewContext(this.#review.config) : null,
      busy: this.#busy,
      error: this.#error,
      submitLabel: T(this.#busy ? "SF2eTSC.wizard.working" : this.#review ? "SF2eTSC.wizard.confirmStart" : "SF2eTSC.wizard.preview")
    };
  }
  #rosterContext(row) {
    const actor = this.#actors.get(row.uuid);
    const data = this.#shipData(row);
    const player = row.kind === "starship" && row.role === "player";
    const observers = this.#observers();
    const characters = this.#worldCharacters().filter((a) => !observers.has(a.uuid));
    const selectedCrew = (uuid) => !this.#excluded.has(uuid) && characters.some((a) => a.uuid === uuid);
    const members = (data?.crew ?? []).map((c) => {
      const character = characters.find((a) => a.uuid === c.actorUuid);
      const station = row.stationAssignments.find((s) => s.actorUuid === c.actorUuid);
      return {
        uuid: c.actorUuid,
        name: character?.name ?? c.name ?? c.actorUuid,
        occupant: occupantView(c.actorUuid, { fallbackName: c.name }),
        missing: !fromUuidSync_(c.actorUuid),
        observer: c.role === "observer",
        locked: !character || c.role === "observer",
        checked: c.role !== "observer" && selectedCrew(c.actorUuid),
        station: data?.stations.find((s) => s.id === station?.stationId)?.name,
        inCombat: !!(character && game.combat && combatantForActor(game.combat, character))
      };
    });
    const stations = (data?.stations ?? []).map((s) => {
      const assignment = row.stationAssignments.find((a) => a.stationId === s.id);
      const value = assignment ? assignment.actorUuid : (s.helmedBy ?? null);
      const unavailable = value && !characters.some((a) => a.uuid === value);
      return {
        id: s.id,
        name: s.name,
        empty: !value,
        current: occupantView(s.helmedBy, { fallbackName: data?.crew.find((c) => c.actorUuid === s.helmedBy)?.name }),
        choices: characters.map((a) => ({ uuid: a.uuid, name: a.name, selected: value === a.uuid })),
        unavailable: unavailable ? value : null
      };
    });
    const useOriginal = player && actor && !actor.pack && data?.role === "player";
    return {
      ...row,
      player,
      ship: row.kind === "starship",
      canReuse: this.#canReuse(row),
      sourceLabel: row.pack || T("SF2eTSC.contactEditor.sources.world"),
      roles: optionsFor(["player", "npc"], row.role, (id) => T(`SF2eTSC.roleTypes.${id}`)),
      headings: optionsFor(["left", "right"], row.heading, (id) => T(`SF2eTSC.heading.${id}`)),
      detections: optionsFor(player ? ["identified"] : DETECTION_LEVELS, row.detection, (id) => T(`SF2eTSC.detection.${id}`)),
      usage: T(
        useOriginal
          ? "SF2eTSC.wizard.originalPlayer"
          : row.reuse && this.#canReuse(row)
            ? "SF2eTSC.wizard.existingActor"
            : "SF2eTSC.wizard.freshCopies"
      ),
      members,
      stations,
      orphanAssignments: row.stationAssignments.filter((a) => !(data?.stations ?? []).some((s) => s.id === a.stationId))
    };
  }
  #matches(choice) {
    const text = `${choice.name ?? ""} ${choice.uuid ?? ""} ${choice.pack ?? ""}`.toLocaleLowerCase();
    return (
      (!this.#browse.filter || text.includes(this.#browse.filter.toLocaleLowerCase())) &&
      (this.#browse.kind === "all" || this.#browse.kind === choice.kind) &&
      (!this.#browse.pack || this.#browse.pack === choice.pack)
    );
  }
  #pendingCount() {
    return [...this.#selected.values()].filter((c) => !this.#roster.some((r) => keyOf(r.uuid, r.kind) === keyOf(c.uuid, c.kind))).length;
  }
  #syncSelection() {
    this.element?.querySelectorAll?.("[data-candidate]").forEach((box) => {
      box.checked = this.#selected.has(keyOf(box.dataset.uuid, box.dataset.kind));
    });
    const count = this.element?.querySelector?.("[data-selected-count]");
    if (count) count.textContent = String(this.#selected.size);
    const button = this.element?.querySelector?.('[data-action="addSelected"]');
    if (button) button.disabled = this.#busy || !this.#pendingCount();
  }
  #filterCandidates() {
    let visible = 0;
    this.element?.querySelectorAll?.("[data-candidate-row]").forEach((row) => {
      row.hidden = !this.#matches({ name: row.dataset.name, uuid: row.dataset.uuid, kind: row.dataset.kind, pack: row.dataset.pack });
      if (!row.hidden) visible++;
    });
    const hint = this.element?.querySelector?.("[data-no-candidates]");
    if (hint) hint.hidden = visible > 0;
  }
  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element.querySelector(".tsc-wizard");
    if (!root || root.dataset.wizardWired) return;
    root.dataset.wizardWired = "true";
    root.addEventListener("input", (event) => this.#change(event, false));
    root.addEventListener("change", (event) => this.#change(event, true));
    this.#setBusy(this.#busy);
  }
  #change(event, committed) {
    if (this.#busy || this.#completed) return;
    const input = event.target;
    if (!input.matches?.("input, select")) return;
    this.#invalidateReview();
    if (input.hasAttribute("data-candidate")) {
      this.selectCandidate(input.dataset.uuid, input.checked, input.dataset.kind);
      return;
    }
    if (["source", "filter", "kind", "pack"].includes(input.name)) {
      this.#browse[input.name] = input.value;
      if (input.name === "source" && committed) {
        this.#browse.pack = "";
        this.render();
      } else this.#filterCandidates();
      return;
    }
    if (input.name === "zones") {
      this.#zones = committed ? clampZones(input.value) : input.value;
      if (committed) input.value = this.#zones;
    }
    if (input.name === "presetPick") this.#presetPick = input.value;
    if (input.name === "presetName") this.#presetName = input.value;
    const rowElement = input.closest("[data-roster-row]");
    if (rowElement && input.dataset.field) {
      const row = this.#roster.find((r) => r.id === rowElement.dataset.rowId);
      if (row) this.updateRoster(row.uuid, row.kind, { [input.dataset.field]: input.type === "checkbox" ? input.checked : input.value });
      if (committed && ["role", "count", "detection", "reuse"].includes(input.dataset.field)) this.render();
    }
    if (input.hasAttribute("data-member") || input.hasAttribute("data-extra-crew")) {
      const uuid = input.dataset.uuid;
      if (input.hasAttribute("data-extra-crew")) {
        if (input.checked) this.#crew.add(uuid);
        else this.#crew.delete(uuid);
      } else if (input.checked) this.#excluded.delete(uuid);
      else this.#excluded.add(uuid);
      if (!input.checked)
        for (const row of this.#playerRows())
          row.stationAssignments.forEach((s) => {
            if (s.actorUuid === uuid) s.actorUuid = null;
          });
      if (committed) this.render();
    }
    if (input.hasAttribute("data-station")) {
      const row = this.#roster.find((r) => r.id === rowElement?.dataset.rowId);
      const uuid = input.value || null;
      if (row && (!uuid || (!this.#observers().has(uuid) && this.#worldCharacters().some((a) => a.uuid === uuid)))) {
        row.stationAssignments = row.stationAssignments.filter((s) => s.stationId !== input.dataset.station);
        if (uuid) {
          row.stationAssignments.forEach((s) => {
            if (s.actorUuid === uuid) s.actorUuid = null;
          });
          this.#excluded.delete(uuid);
        }
        row.stationAssignments.push({ stationId: input.dataset.station, actorUuid: uuid });
        if (committed) this.render();
      }
    }
    const obj = input.closest(".tsc-obj-row");
    if (obj && input.dataset.f) {
      const draft = this.#objects.find((o) => o.id === obj.dataset.objectId);
      if (draft) draft[input.dataset.f] = input.value;
    }
  }
  #invalidateReview() {
    this.#review = null;
    this.#error = "";
    const preview = this.element?.querySelector?.("[data-wizard-review]");
    if (preview) preview.hidden = true;
    const error = this.element?.querySelector?.("[data-wizard-error]");
    if (error) error.hidden = true;
    const submit = this.element?.querySelector?.("[data-wizard-submit]");
    if (submit) submit.textContent = T("SF2eTSC.wizard.preview");
  }
  #setBusy(busy) {
    this.#busy = busy;
    this.element?.querySelectorAll?.("input, select, button").forEach((input) => {
      if (busy) {
        if (!Object.hasOwn(input.dataset, "wizardDisabled")) input.dataset.wizardDisabled = String(input.disabled);
        input.disabled = true;
      } else if (Object.hasOwn(input.dataset, "wizardDisabled")) {
        input.disabled = input.dataset.wizardDisabled === "true";
        delete input.dataset.wizardDisabled;
      }
    });
    this.element?.querySelector?.(".tsc-wizard")?.setAttribute("aria-busy", String(busy));
    const submit = this.element?.querySelector?.("[data-wizard-submit]");
    if (submit)
      submit.textContent = T(busy ? "SF2eTSC.wizard.working" : this.#review ? "SF2eTSC.wizard.confirmStart" : "SF2eTSC.wizard.preview");
  }
  #showError(err) {
    this.#error = err.message ?? String(err);
    notifyError("SF2eTSC.errors.generic", { message: this.#error });
  }

  #readConfig() {
    const playerShips = [],
      enemies = [],
      hazards = [];
    const existing = new Set(this.#existingCrew().map((c) => c.actorUuid));
    const observers = this.#observers();
    const crew = new Set([...this.#crew].filter((uuid) => !existing.has(uuid) && !observers.has(uuid)));
    const characters = new Set(this.#worldCharacters().map((a) => a.uuid));
    const excludeCrew = new Set([...this.#excluded].filter((uuid) => existing.has(uuid)));
    for (const uuid of existing) if (!characters.has(uuid) || observers.has(uuid)) excludeCrew.add(uuid);
    for (const row of this.#roster) {
      const base = { uuid: row.uuid, zone: this.#zone(row.zone), detection: normalizeDetection(row.detection) };
      if (row.kind === "starship" && row.role === "player") {
        const data = this.#shipData(row);
        const assignments = row.stationAssignments
          .map((s) => ({ stationId: s.stationId, actorUuid: s.actorUuid ?? null }))
          .sort((a, b) => a.stationId.localeCompare(b.stationId));
        for (const c of data?.crew ?? []) if (c.role === "observer") excludeCrew.add(c.actorUuid);
        for (const s of assignments)
          if (s.actorUuid) {
            if (!existing.has(s.actorUuid) && !observers.has(s.actorUuid)) crew.add(s.actorUuid);
          }
        playerShips.push({
          ...base,
          detection: "identified",
          heading: row.heading === "left" ? "left" : "right",
          stationAssignments: assignments
        });
      } else {
        const entry = {
          ...base,
          count: clampCount(row.count),
          zones: parseZoneList(row.zones).map((z) => this.#zone(z)),
          reuse: row.reuse === true && this.#canReuse(row)
        };
        if (row.kind === "hazard") hazards.push(entry);
        else enemies.push({ ...entry, heading: row.heading === "right" ? "right" : "left" });
      }
    }
    return {
      zones: clampZones(this.#zones ?? DEFAULT_ZONES),
      playerShips,
      enemies,
      hazards,
      objects: this.#objects.map((o) => ({
        name: String(o.name ?? "").trim(),
        type: objectType(o.type),
        zone: this.#zone(o.zone),
        art: safeImagePath(o.art),
        detection: normalizeDetection(o.detection)
      })),
      crew: [...crew],
      excludeCrew: [...excludeCrew]
    };
  }
  #validate(config) {
    if (!this.#roster.length && !config.objects.length) throw new Error(T("SF2eTSC.wizard.emptyRoster"));
    const world = new Set(worldHazardChoices().map((c) => keyOf(c.uuid, c.kind)));
    const missing = this.#roster.filter(
      (row) => row.missing || (!this.#actors.get(row.uuid)?.pack && !world.has(keyOf(row.uuid, row.kind)))
    );
    if (missing.length) throw new Error(T("SF2eTSC.wizard.missingSources", { names: missing.map((r) => r.name).join(", ") }));
    if (config.objects.some((o) => !o.name)) throw new Error(T("SF2eTSC.ui.customObjectNameRequired"));
    if (this.#objects.some((o) => o.art && !safeImagePath(o.art))) throw new Error(T("SF2eTSC.mapAppearance.invalidPath"));
    const characters = new Set(this.#worldCharacters().map((a) => a.uuid));
    const observers = this.#observers();
    if (config.crew.some((uuid) => !characters.has(uuid) || observers.has(uuid))) throw new Error(T("SF2eTSC.wizard.invalidCrew"));
    for (const row of this.#playerRows()) {
      const stations = new Set((this.#shipData(row)?.stations ?? []).map((s) => s.id));
      if (
        row.stationAssignments.some(
          (s) =>
            !stations.has(s.stationId) ||
            (s.actorUuid && (!characters.has(s.actorUuid) || observers.has(s.actorUuid) || this.#excluded.has(s.actorUuid)))
        )
      )
        throw new Error(T("SF2eTSC.wizard.invalidAssignment", { name: row.name }));
    }
  }
  #previewContext(config) {
    const npc = config.enemies.reduce((sum, s) => sum + s.count, 0);
    const hazards = config.hazards.reduce((sum, s) => sum + s.count, 0);
    const originalPlayers = this.#playerRows().filter((r) => {
      const actor = this.#actors.get(r.uuid);
      return actor && !actor.pack && this.#shipData(r)?.role === "player";
    }).length;
    const reused = originalPlayers + [...config.enemies, ...config.hazards].filter((s) => s.reuse).length;
    const selectedCrew = new Set([
      ...this.#existingCrew()
        .filter((c) => c.role !== "observer" && !config.excludeCrew.includes(c.actorUuid))
        .map((c) => c.actorUuid),
      ...config.crew
    ]);
    const entries = [
      ...config.playerShips.map((s) => ({ ...s, kind: "starship", count: 1, zones: [s.zone] })),
      ...config.enemies.map((s) => ({ ...s, kind: "starship" })),
      ...config.hazards.map((s) => ({ ...s, kind: "hazard" }))
    ].map((s) => {
      const row = this.#roster.find((r) => r.uuid === s.uuid && r.kind === s.kind);
      return {
        name: row?.name ?? s.uuid,
        count: s.count,
        zones: Array.from({ length: s.count }, (_, i) => s.zones[i] ?? s.zone).join(", "),
        detection: T(`SF2eTSC.detection.${s.detection}`),
        heading: s.heading ? T(`SF2eTSC.heading.${s.heading}`) : "",
        usage: this.#rosterContext(row).usage,
        assignments: (s.stationAssignments ?? []).map((a) => ({
          station: this.#shipData(row)?.stations.find((st) => st.id === a.stationId)?.name ?? a.stationId,
          name: this.#worldCharacters().find((c) => c.uuid === a.actorUuid)?.name ?? T("SF2eTSC.crew.unoccupied")
        }))
      };
    });
    const unidentified =
      [...config.enemies, ...config.hazards].reduce((sum, s) => sum + (s.detection === "identified" ? 0 : s.count), 0) +
      config.objects.filter((o) => o.detection !== "identified").length;
    return {
      player: config.playerShips.length,
      npc,
      hazards,
      objects: config.objects.length,
      total: config.playerShips.length + npc + hazards + config.objects.length,
      copies: config.playerShips.length + npc + hazards - reused,
      reused,
      crew: selectedCrew.size,
      unidentified,
      entries,
      custom: config.objects.map((o) => ({ ...o, detectionLabel: T(`SF2eTSC.detection.${o.detection}`) }))
    };
  }

  static #addSelected() {
    return this.addSelected();
  }
  static async #removeRoster(event, target) {
    if (this.#busy) return;
    const row = this.#roster.find((r) => r.id === target.closest("[data-roster-row]")?.dataset.rowId);
    if (row) this.removeRoster(row.uuid, row.kind);
    await this.render();
  }
  static async #removeAssignment(event, target) {
    if (this.#busy) return;
    const row = this.#roster.find((r) => r.id === target.closest("[data-roster-row]")?.dataset.rowId);
    if (row) row.stationAssignments = row.stationAssignments.filter((s) => s.stationId !== target.dataset.stationId);
    this.#invalidateReview();
    await this.render();
  }
  static async #refreshSources() {
    if (this.#busy) return;
    this.#invalidateReview();
    this.#compendium = null;
    await this.render();
  }
  static async #editDraft() {
    if (this.#busy) return;
    this.#invalidateReview();
    await this.render();
  }
  static #cancel() {
    return this.close();
  }
  async close(options) {
    if (this.#busy) return this;
    this.#closed = true;
    return super.close(options);
  }
  static #pickObjectArt(event, target) {
    if (this.#busy) return;
    const id = target.closest(".tsc-obj-row")?.dataset.objectId;
    const object = this.#objects.find((o) => o.id === id);
    if (!object) return;
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (!FP) return this.#showError(new Error(T("SF2eTSC.mapVisual.noFilePicker")));
    new FP({
      type: "image",
      current: object.art,
      callback: (path) => {
        if (this.#closed || this.#busy || !this.#objects.includes(object)) return;
        object.art = path;
        this.#invalidateReview();
        this.render();
      }
    }).render(true);
  }
  static async #addObjRow() {
    if (this.#busy) return;
    const object = {
      id: String(++this.#nextId),
      name: "",
      type: OBJECT_TYPES[0],
      zone: Math.ceil(clampZones(this.#zones) / 2),
      art: "",
      detection: "observed"
    };
    this.#objects.push(object);
    this.#invalidateReview();
    const row = this.element?.querySelector?.("[data-obj-template]")?.content.firstElementChild.cloneNode(true);
    const rows = this.element?.querySelector?.("[data-obj-rows]");
    if (row && rows) {
      row.dataset.objectId = object.id;
      row.querySelector('[data-f="zone"]').value = object.zone;
      rows.append(row);
      row.querySelector('[data-f="name"]').focus();
    } else await this.render();
  }
  static async #removeObjRow(event, target) {
    if (this.#busy) return;
    const id = target.closest(".tsc-obj-row")?.dataset.objectId;
    this.#objects = this.#objects.filter((o) => o.id !== id);
    this.#invalidateReview();
    await this.render();
  }
  static async #savePreset() {
    if (this.#busy) return;
    const name = this.#presetName.trim();
    if (!name) return ui.notifications.warn(T("SF2eTSC.wizard.presetNameRequired"));
    this.#invalidateReview();
    this.#setBusy(true);
    try {
      const p = await savePreset({ ...this.#readConfig(), name });
      if (p) {
        this.#presetPick = p.id;
        ui.notifications.info(T("SF2eTSC.wizard.presetSaved", { name: p.name }));
      }
    } catch (err) {
      this.#showError(err);
    } finally {
      this.#setBusy(false);
      if (!this.#closed) await this.render();
    }
  }
  static async #deletePreset() {
    if (this.#busy || !this.#presetPick) return;
    this.#invalidateReview();
    this.#setBusy(true);
    try {
      await deletePreset(this.#presetPick);
      this.#presetPick = "";
    } catch (err) {
      this.#showError(err);
    } finally {
      this.#setBusy(false);
      if (!this.#closed) await this.render();
    }
  }
  static async #loadPreset() {
    const id = this.#presetPick || this.element?.querySelector?.('[name="presetPick"]')?.value;
    const p = listPresets().find((x) => x.id === id);
    if (!p || this.#busy) return;
    this.#presetPick = id;
    await this.loadDraft(p);
    const missing = this.#roster.filter((r) => r.missing).length;
    ui.notifications.info(
      T(missing ? "SF2eTSC.wizard.presetLoadedMissing" : "SF2eTSC.wizard.presetLoaded", { name: p.name, count: missing })
    );
  }
  static async #submit() {
    if (this.#busy || this.#completed || this.#closed) return;
    this.#setBusy(true);
    try {
      const cfg = this.#readConfig();
      this.#validate(cfg);
      if (!this.#review || JSON.stringify(cfg) !== JSON.stringify(this.#review.config)) {
        this.#review = { config: clone(cfg) };
        this.#error = "";
        await this.render();
        return;
      }
      await startStarshipCombat(clone(this.#review.config));
      this.#completed = true;
    } catch (err) {
      this.#review = null;
      this.#showError(err);
    } finally {
      this.#setBusy(false);
    }
    if (this.#completed) {
      await this.close().catch(() => null);
      try {
        await openDashboard();
      } catch (err) {
        this.#showError(err);
      }
    } else if (!this.#closed) await this.render();
  }
}
