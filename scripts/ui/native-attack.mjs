import { request } from "../socket.mjs";
import { Targeting } from "./targeting.mjs";
import { openSensorMap } from "./launchers.mjs";
import { notifyError } from "../utils/logging.mjs";
import { T, escapeHtml, moduleSetting } from "../utils/foundry.mjs";
import { rollEventOptions } from "../starship/stats.mjs";

/** Per-attack modifiers are proposed by the player and explicitly approved by the GM before rolling. */
export async function promptManualModifiers(knownModifiers) {
  const esc = escapeHtml;
  const known = (knownModifiers ?? [])
    .map((m) => `<li>${esc(m.label)}: ${m.value > 0 ? "+" : ""}${m.value} (${esc(m.type)})</li>`)
    .join("");
  const types = ["status", "circumstance", "item", "untyped"]
    .map((t) => `<option value="${t}">${esc(T(`SF2eTSC.modifiers.type.${t}`))}</option>`)
    .join("");
  const scopes = ["attack", "damage", "both"]
    .map((t) => `<option value="${t}">${esc(T(`SF2eTSC.modifiers.scope.${t}`))}</option>`)
    .join("");
  const rows = Array.from(
    { length: 6 },
    (_, i) =>
      `<fieldset><legend>${i + 1}</legend><input name="name${i}" maxlength="80" placeholder="${esc(T("SF2eTSC.modifiers.name"))}"><input name="source${i}" maxlength="80" placeholder="${esc(T("SF2eTSC.modifiers.source"))}"><input type="number" name="value${i}" min="-100" max="100" step="1" placeholder="±"><select name="type${i}">${types}</select><select name="scope${i}">${scopes}</select></fieldset>`
  ).join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    classes: ["sf2e-tsc"],
    window: { title: T("SF2eTSC.modifiers.title") },
    content: `<p>${esc(T("SF2eTSC.modifiers.hint"))}</p>${known ? `<p>${esc(T("SF2eTSC.modifiers.known"))}</p><ul>${known}</ul>` : ""}${rows}`,
    ok: { label: T("SF2eTSC.ui.execute"), callback: (e, b) => new foundry.applications.ux.FormDataExtended(b.form).object },
    rejectClose: false
  }).catch(() => null);
  if (!result) return null;
  const modifiers = [];
  for (let i = 0; i < 6; i++) {
    const name = String(result[`name${i}`] ?? "").trim(),
      source = String(result[`source${i}`] ?? "").trim(),
      raw = String(result[`value${i}`] ?? "").trim();
    if (!name && !source && !raw) continue;
    if (!name || !raw || !/^[+-]?\d+$/.test(raw)) throw new Error(T("SF2eTSC.modifiers.invalid"));
    modifiers.push({ name, source, value: Number(raw), type: result[`type${i}`], scope: result[`scope${i}`] });
  }
  return modifiers;
}

/** Preview is a GM-validated, message-free operation; the chosen map target is revalidated at execution. */
export async function beginNativeWeaponAttack(payload, event = null) {
  let current = payload;
  const rollOptions = rollEventOptions(event);
  const preview = async (candidate) => {
    try {
      return { candidate, result: await request("previewNativeAttack", candidate) };
    } catch (err) {
      if (!game.user.isGM || candidate.options?.gmOverride) throw err;
      const go = await foundry.applications.api.DialogV2.confirm({
        classes: ["sf2e-tsc"],
        window: { title: T("SF2eTSC.ui.gmOverride") },
        content: `<p>${escapeHtml(err.message)}</p><p>${T("SF2eTSC.ui.overrideAsk")}</p>`,
        rejectClose: false
      }).catch(() => false);
      if (!go) throw err;
      const overridden = { ...candidate, options: { ...candidate.options, gmOverride: true } };
      return { candidate: overridden, result: await request("previewNativeAttack", overridden) };
    }
  };
  try {
    const initial = await preview(current);
    current = initial.candidate;
    const info = initial.result,
      eventId = foundry.utils.randomID(20);
    Targeting.begin({
      shipUuid: info.shipUuid,
      label: info.label,
      range: info.range ?? 99,
      rangeIncrement: info.rangeIncrement,
      enforceDetection: info.enforceDetection,
      allowSelf: false,
      gm: false,
      onPick: async (targetKey) => {
        try {
          const selected = await preview({ ...current, options: { ...current.options, targetKey } });
          for (const warning of selected.result.warnings ?? []) ui.notifications.warn(warning);
          const manualModifiers = moduleSetting("nativeModifierDialog") ? await promptManualModifiers(selected.result.knownModifiers) : [];
          if (manualModifiers === null) return;
          const result = await request("executeNativeAttack", {
            ...selected.candidate,
            eventId,
            combatId: info.combatId,
            manualModifiers,
            options: { ...selected.candidate.options, ...rollOptions }
          });
          for (const warning of result?.warnings ?? []) ui.notifications.warn(warning);
        } catch (err) {
          notifyError("SF2eTSC.errors.generic", { message: err.message });
        }
      }
    });
    await openSensorMap();
  } catch (err) {
    notifyError("SF2eTSC.errors.generic", { message: err.message });
  }
}
