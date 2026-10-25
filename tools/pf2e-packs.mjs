import { MODULE_ID } from "../scripts/constants.mjs";

/** Производные PF2e-паки используют общую схему v14, но собственные namespace и метаданные. */
export function pf2ePackDocument(source, packNames) {
  const names = new Set(packNames);
  const prefix = `Compendium.${MODULE_ID}.`;
  const convert = (value) => {
    if (typeof value === "string") {
      const text = value.replaceAll("systems/sf2e/", "systems/pf2e/").replaceAll("flags.sf2e.", "flags.pf2e.");
      // Любая новая внешняя ссылка требует проверки реального редиректа Anachronism.
      if (text.includes("Compendium.sf2e.")) throw new Error("Unmapped external SF2e UUID in PF2e pack");
      return text.replaceAll(new RegExp(`${prefix.replaceAll(".", "\\.")}([A-Za-z0-9-]+)\\.`, "g"), (match, name) => {
        if (!names.has(name)) throw new Error(`Unknown module pack reference: ${name}`);
        return `${prefix}${name}-pf2e.`;
      });
    }
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, convert(entry)]));
    if (result._stats?.systemId === "sf2e") {
      result._stats.systemId = "pf2e";
      result._stats.systemVersion = "8.6.1";
    }
    if (result.flags?.sf2e) {
      if (result.flags.pf2e) throw new Error("Conflicting PF2e/SF2e flags in pack source");
      result.flags.pf2e = result.flags.sf2e;
      delete result.flags.sf2e;
    }
    return result;
  };
  return convert(source);
}
