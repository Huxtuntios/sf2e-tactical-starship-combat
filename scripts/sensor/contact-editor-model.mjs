import { DETECTION_LEVELS } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { CONTACT_SOURCES } from "./contact-service.mjs";

/** Чистая модель представления окна добавления контакта (без Foundry UI; покрыта тестами). */
export function contactEditorContext(state, { zones, world, compendium, loading = false }) {
  const source = CONTACT_SOURCES.includes(state.source) ? state.source : "world";
  const list = source === "compendium" ? compendium : world;
  const needle = String(state.filter ?? "")
    .trim()
    .toLocaleLowerCase();
  const choices = needle ? list.filter((c) => c.name.toLocaleLowerCase().includes(needle)) : list;
  return {
    sources: CONTACT_SOURCES.map((id) => ({ id, label: T(`SF2eTSC.contactEditor.sources.${id}`), checked: id === source })),
    isCustom: source === "custom",
    isCompendium: source === "compendium",
    loading,
    filter: state.filter ?? "",
    listHeight: Number.isFinite(state.listHeight) ? state.listHeight : null,
    name: state.name ?? "",
    choices: choices.map((c) => ({
      ...c,
      kindLabel: T(`SF2eTSC.contactEditor.kinds.${c.kind ?? "hazard"}`),
      roleLabel: c.role ? T(`SF2eTSC.roles.${c.role}`) : "",
      selected: c.uuid === state.uuid
    })),
    zones: Array.from({ length: zones }, (_, i) => ({ id: i + 1, selected: i + 1 === (state.zone ?? 1) })),
    detections: DETECTION_LEVELS.map((id) => ({
      id,
      label: T(`SF2eTSC.detection.${id}`),
      selected: id === (state.detection ?? "undetected")
    }))
  };
}
