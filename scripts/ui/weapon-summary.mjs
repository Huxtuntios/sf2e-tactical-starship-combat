import { ct } from "../content/content-i18n.mjs";
import { T } from "../utils/foundry.mjs";
import { damageTypeLabel, zonesText } from "../utils/labels.mjs";

/** Только явно заданный ранг: категория оружия не является требуемым рангом. */
export function weaponSummary(w) {
  const missing = T("SF2eTSC.weaponInfo.notSpecified");
  const type = Array.isArray(w.damageType)
    ? w.damageType.filter((v) => typeof v === "string" && v)
    : [w.damageType].filter((v) => typeof v === "string" && v);
  const rank = ["untrained", "trained", "expert", "master", "legendary"].includes(w.requiredProficiency)
    ? T(`SF2eTSC.weaponInfo.ranks.${w.requiredProficiency}`)
    : missing;
  const damage = typeof w.die === "string" && w.die.trim() ? w.die : missing;
  const damageTypes = type.length ? type.map(damageTypeLabel).join(" / ") : missing;
  const range = Number.isFinite(w.range) ? zonesText(`${w.range} zones`) : missing;
  const level = Number.isInteger(w.itemLevel) ? String(w.itemLevel) : missing;
  return {
    id: w.id,
    name: ct(w.name),
    damage,
    damageTypes,
    rank,
    range,
    level,
    option: `${ct(w.name)} — ${T("SF2eTSC.weaponInfo.damage")}: ${damage}; ${T("SF2eTSC.weaponInfo.damageType")}: ${damageTypes}; ${T("SF2eTSC.weaponInfo.requiredProficiency")}: ${rank}; ${T("SF2eTSC.ui.range")}: ${range}; ${T("SF2eTSC.weaponInfo.level")}: ${level}`
  };
}
