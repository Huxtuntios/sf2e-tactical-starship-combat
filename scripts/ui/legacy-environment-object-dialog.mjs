import { prepareLegacyEnvironmentObject } from "../sensor/environment-object-names.mjs";
import { T } from "../utils/foundry.mjs";

export function legacyEnvironmentObjectDialogContent({ nameLabel, typeLabel, zoneLabel, errorLabel, typeOptions }) {
  const escape = (value) => foundry.utils.escapeHTML(String(value ?? ""));
  const options = typeOptions.map(({ id, label }) => `<option value="${escape(id)}">${escape(label)}</option>`).join("");
  return `<div class="form-group"><label>${escape(nameLabel)}</label><input name="name" type="text"></div>
    <div class="form-group"><label>${escape(typeLabel)}</label><select name="type">${options}</select></div>
    <div class="form-group"><label>${escape(zoneLabel)}</label><input name="zone" type="number" min="1" value="1"></div>
    <p class="tsc-object-form-error" role="alert" aria-live="assertive" hidden>${escape(errorLabel)}</p>`;
}

export async function submitLegacyEnvironmentObject(data, { dialog, app, combat, existingObjects, addCustom, addPublic, localize = T }) {
  const errorElement = dialog.element.querySelector(".tsc-object-form-error");
  errorElement.hidden = true;
  errorElement.textContent = "";
  try {
    const object = prepareLegacyEnvironmentObject(data, existingObjects(), localize);
    if (object.type === "custom") await addCustom(combat, object.name, object.zone);
    else await addPublic(combat, object);
  } catch (error) {
    errorElement.textContent = String(error?.message ?? localize("SF2eTSC.errors.generic"));
    errorElement.hidden = false;
    return false;
  }
  await dialog.close();
  app.render();
  return true;
}
