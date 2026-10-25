import { MODULE_ID } from "../constants.mjs";

export const ANACHRONISM_ID = "sf2e-anachronism";
export const PF2E_MINIMUM = "8.6.0";
export const ANACHRONISM_MINIMUM = "2.4.0";

/** Системный namespace выбирается при вызове, а не при загрузке ES-модуля. */
export const nativeSystemId = () => (globalThis.game?.system?.id === "pf2e" ? "pf2e" : "sf2e");

/** Имена исходных SF2e-паков и UUID существующих миров не меняются. */
export function modulePackId(name, systemId = nativeSystemId()) {
  return `${MODULE_ID}.${name}${systemId === "pf2e" ? "-pf2e" : ""}`;
}

function versionAtLeast(actual, minimum) {
  if (!/^\d+\.\d+\.\d+$/.test(actual ?? "")) return false;
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return true;
}

/** Anachronism обязателен только в PF2e; чужие настройки и API не изменяются. */
export function systemSupport(system = globalThis.game?.system, anachronism = globalThis.game?.modules?.get(ANACHRONISM_ID)) {
  if (system?.id === "sf2e") return { supported: true };
  if (system?.id !== "pf2e") return { supported: false, key: "unsupported" };
  if (!versionAtLeast(system.version, PF2E_MINIMUM)) return { supported: false, key: "pf2eVersion" };
  if (!anachronism?.active) return { supported: false, key: "anachronismRequired" };
  if (!versionAtLeast(anachronism.version, ANACHRONISM_MINIMUM)) return { supported: false, key: "anachronismVersion" };
  return { supported: true };
}

/** Проверяется после init-хуков системы: дополнительные навыки регистрирует Anachronism. */
export function missingStarfinderSkills(config = globalThis.CONFIG?.PF2E) {
  return nativeSystemId() === "pf2e" ? ["computers", "piloting"].filter((slug) => !config?.skills?.[slug]) : [];
}
