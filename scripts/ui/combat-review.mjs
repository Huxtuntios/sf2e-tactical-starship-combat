import { TscApp, tpl, openApps } from "./base-app.mjs";

/** Pre-combat review/validation as a separate window so the creation wizard stays short. */
export class CombatReviewApp extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-combat-review",
    classes: ["sf2e-tsc", "tsc-combat-review-window"],
    window: { title: "SF2eTSC.wizard.review", icon: "fa-solid fa-clipboard-check", resizable: true },
    position: { width: 640, height: 680 },
    actions: {
      confirm: CombatReviewApp.#confirm,
      back: CombatReviewApp.#back
    }
  };
  static PARTS = { main: { template: tpl("combat-review") } };
  channels = [];
  #wizard = null;
  setWizard(wizard) {
    this.#wizard = wizard;
    return this;
  }
  async _prepareContext() {
    return { review: this.#wizard?.reviewContext() ?? null, busy: this.#wizard?.isBusy() ?? false };
  }
  static async #confirm() {
    const wizard = this.#wizard;
    await this.close();
    if (wizard) await wizard.confirmFromReview();
  }
  static #back() {
    return this.close();
  }
}

export async function openCombatReview(wizard) {
  const app = openApps(CombatReviewApp)[0] ?? new CombatReviewApp();
  app.setWizard(wizard);
  await app.render(true);
  return app;
}
