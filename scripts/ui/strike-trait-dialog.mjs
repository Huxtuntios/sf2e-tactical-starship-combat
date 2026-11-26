import { MODULE_ID } from "../constants.mjs";
import { T } from "../utils/foundry.mjs";
import { filterStrikeTraits, readStrikeTraits, strikeTraitCatalog, uniqueStrikeTraits } from "./sheet-edit.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const traitKey = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export class StrikeTraitDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["sf2e-tsc", "tsc-strike-traits"],
    tag: "form",
    position: { width: 520, height: 620 },
    window: { icon: "fa-solid fa-tags" },
    form: {
      closeOnSubmit: false,
      submitOnChange: false,
      handler: async function (_event, form) {
        await this.submitSelection(form);
      }
    },
    actions: {
      cancel: function () {
        return this.close();
      }
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/strike-traits.hbs`, scrollable: [".tsc-strike-trait-options"] }
  };

  constructor(onClose, selected = []) {
    super();
    this.onClose = onClose;
    this.selected = uniqueStrikeTraits(selected);
  }

  get title() {
    return T("SF2eTSC.edit.addStrike");
  }

  async _prepareContext() {
    const selected = new Set(this.selected.map(traitKey));
    this.choices = strikeTraitCatalog().map((entry, index) => ({
      ...entry,
      id: `${this.id}-trait-${index}`,
      selected: selected.has(traitKey(entry.value))
    }));
    return { uid: this.id, choices: this.choices };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const search = this.element.querySelector("[data-strike-trait-search]");
    const rows = [...this.element.querySelectorAll("[data-strike-trait-option]")];
    const empty = this.element.querySelector("[data-strike-trait-empty]");
    const filter = () => {
      const visible = new Set(filterStrikeTraits(this.choices, search.value).map((entry) => entry.value));
      for (const row of rows) row.hidden = !visible.has(row.dataset.strikeTraitOption);
      empty.hidden = visible.size > 0;
    };
    search.addEventListener("input", filter);
    filter();
    search.focus();
  }

  async submitSelection(form) {
    await this.close({ result: readStrikeTraits(form) });
  }

  _onClose(options) {
    super._onClose?.(options);
    this.onClose?.(options?.result ?? null);
  }
}

export function chooseStrikeTraits(selected = []) {
  return new Promise((resolve) => {
    const dialog = new StrikeTraitDialog(resolve, selected);
    dialog.render(true);
  });
}
