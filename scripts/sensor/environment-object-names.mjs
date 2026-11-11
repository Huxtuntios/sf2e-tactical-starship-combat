import { T } from "../utils/foundry.mjs";

export const LEGACY_ENVIRONMENT_TYPES = Object.freeze(["asteroid", "station", "debris", "beacon", "planet", "custom"]);

/** Prepare the legacy public-map object while retaining the private custom-contact path. */
export function prepareLegacyEnvironmentObject(data, existingObjects = [], localize = T) {
  const { name, type } = data ?? {};
  if (!LEGACY_ENVIRONMENT_TYPES.includes(type)) throw new Error(localize("SF2eTSC.contactEditor.invalidSource"));

  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (type === "custom") {
    if (!trimmedName) throw new Error(localize("SF2eTSC.ui.customObjectNameRequired"));
    return { name: trimmedName, type, zone: Number(data.zone) || 1 };
  }
  if (trimmedName) return { name: trimmedName, type, zone: Number(data.zone) || 1 };

  const usedNames = new Set(
    existingObjects
      .map((object) =>
        String(object?.name ?? "")
          .trim()
          .toLocaleLowerCase()
      )
      .filter(Boolean)
  );
  const localizedType = localize(`SF2eTSC.objectTypes.${type}`);
  for (let number = 1; ; number++) {
    const generatedName = localize("SF2eTSC.ui.environmentObjectFallback", { type: localizedType, number });
    if (!usedNames.has(generatedName.trim().toLocaleLowerCase())) return { name: generatedName, type, zone: Number(data.zone) || 1 };
  }
}
