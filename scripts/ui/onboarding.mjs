import { MODULE_ID } from "../constants.mjs";
import { T, moduleSetting } from "../utils/foundry.mjs";
import { TscApp, tpl } from "./base-app.mjs";

const prefix = ["SF2eTSC", "onboarding", "sections"].join(".");
const paragraph = (key, audience) => ({ kind: "paragraph", key, audience });
const list = (items, audience) => ({ kind: "list", items, audience });
const steps = (items, audience) => ({ kind: "steps", items, audience });
const note = (key, audience) => ({ kind: "note", key, audience });
const qa = (pairs) => ({ kind: "qa", pairs });

const SECTIONS = [
  {
    id: "intro",
    blocks: [
      paragraph(`${prefix}.intro.content.summary`),
      list([
        `${prefix}.intro.content.features.ships`,
        `${prefix}.intro.content.features.stations`,
        `${prefix}.intro.content.features.sensorMap`,
        `${prefix}.intro.content.features.effects`
      ]),
      note(`${prefix}.intro.content.native`),
      paragraph(`${prefix}.intro.content.player`, "player"),
      paragraph(`${prefix}.intro.content.gm`, "gm")
    ]
  },
  {
    id: "quickStart",
    blocks: [
      steps([
        `${prefix}.quickStart.content.prepare`,
        `${prefix}.quickStart.content.crew`,
        `${prefix}.quickStart.content.wizard`,
        `${prefix}.quickStart.content.roster`,
        `${prefix}.quickStart.content.start`,
        `${prefix}.quickStart.content.initiative`
      ]),
      note(`${prefix}.quickStart.content.gmNote`, "gm"),
      paragraph(`${prefix}.quickStart.content.playerNote`, "player")
    ]
  },
  {
    id: "wizard",
    blocks: [
      paragraph(`${prefix}.wizard.content.open`),
      list([`${prefix}.wizard.content.add`, `${prefix}.wizard.content.edit`, `${prefix}.wizard.content.remove`]),
      paragraph(`${prefix}.wizard.content.sorting`),
      paragraph(`${prefix}.wizard.content.copies`),
      note(`${prefix}.wizard.content.gmNote`, "gm")
    ]
  },
  {
    id: "sensorMap",
    blocks: [
      paragraph(`${prefix}.sensorMap.content.summary`),
      list([
        `${prefix}.sensorMap.content.zones`,
        `${prefix}.sensorMap.content.move`,
        `${prefix}.sensorMap.content.sheets`,
        `${prefix}.sensorMap.content.appearance`
      ]),
      paragraph(`${prefix}.sensorMap.content.identity`),
      note(`${prefix}.sensorMap.content.privacy`),
      paragraph(`${prefix}.sensorMap.content.gmNote`, "gm")
    ]
  },
  {
    id: "actionSelection",
    blocks: [
      paragraph(`${prefix}.actionSelection.content.gmSummary`, "gm"),
      list(
        [
          `${prefix}.actionSelection.content.auto`,
          `${prefix}.actionSelection.content.manual`,
          `${prefix}.actionSelection.content.rmb`,
          `${prefix}.actionSelection.content.resume`
        ],
        "gm"
      ),
      paragraph(`${prefix}.actionSelection.content.targeting`),
      paragraph(`${prefix}.actionSelection.content.initiative`),
      paragraph(`${prefix}.actionSelection.content.playerNote`, "player")
    ]
  },
  {
    id: "actions",
    blocks: [
      paragraph(`${prefix}.actions.content.stations`),
      list([
        `${prefix}.actions.content.claim`,
        `${prefix}.actions.content.dock`,
        `${prefix}.actions.content.execute`,
        `${prefix}.actions.content.describe`
      ]),
      paragraph(`${prefix}.actions.content.attacks`),
      note(`${prefix}.actions.content.economy`),
      paragraph(`${prefix}.actions.content.playerNote`, "player")
    ]
  },
  {
    id: "effects",
    blocks: [
      paragraph(`${prefix}.effects.content.gmSummary`, "gm"),
      list(
        [
          `${prefix}.effects.content.conditions`,
          `${prefix}.effects.content.modifiers`,
          `${prefix}.effects.content.targets`,
          `${prefix}.effects.content.timing`
        ],
        "gm"
      ),
      paragraph(`${prefix}.effects.content.damage`),
      paragraph(`${prefix}.effects.content.persistent`),
      note(`${prefix}.effects.content.nativeDamage`),
      paragraph(`${prefix}.effects.content.playerNote`, "player")
    ]
  },
  {
    id: "faq",
    blocks: [
      qa([
        [`${prefix}.faq.content.missing.question`, `${prefix}.faq.content.missing.answer`],
        [`${prefix}.faq.content.switch.question`, `${prefix}.faq.content.switch.answer`],
        [`${prefix}.faq.content.placements.question`, `${prefix}.faq.content.placements.answer`],
        [`${prefix}.faq.content.world.question`, `${prefix}.faq.content.world.answer`],
        [`${prefix}.faq.content.manual.question`, `${prefix}.faq.content.manual.answer`],
        [`${prefix}.faq.content.initiative.question`, `${prefix}.faq.content.initiative.answer`],
        [`${prefix}.faq.content.reopen.question`, `${prefix}.faq.content.reopen.answer`]
      ])
    ]
  }
];

export function onboardingLocale(lang = game.i18n.lang) {
  return String(lang ?? "en")
    .toLowerCase()
    .split(/[-_]/)[0] === "ru"
    ? "ru"
    : "en";
}

export class OnboardingGuide extends TscApp {
  static DEFAULT_OPTIONS = {
    id: "sf2e-tsc-onboarding",
    tag: "div",
    classes: ["sf2e-tsc", "tsc-onboarding-window"],
    window: {
      title: "SF2eTSC.onboarding.title",
      icon: "fa-solid fa-circle-question",
      resizable: true,
      minimizable: true
    },
    position: { width: 900, height: 720 },
    actions: {
      close: OnboardingGuide.#close,
      skip: OnboardingGuide.#close,
      toggleMinimize: OnboardingGuide.#toggleMinimize,
      toggleAutoOpen: OnboardingGuide.#toggleAutoOpen,
      goToSection: OnboardingGuide.#goToSection,
      previous: OnboardingGuide.#previous,
      next: OnboardingGuide.#next
    }
  };

  static PARTS = {
    main: { template: tpl("onboarding"), scrollable: ["[data-onboarding-content]"] }
  };

  channels = [];
  #index = 0;
  #visited = new Set([0]);

  get currentIndex() {
    return this.#index;
  }

  async _prepareContext() {
    const locale = onboardingLocale();
    const isGM = !!game.user.isGM;
    const section = SECTIONS[this.#index];
    const blocks = section.blocks
      .filter((block) => !block.audience || (block.audience === "gm" ? isGM : !isGM))
      .map((block) => ({
        ...block,
        text: block.key ? T(block.key) : null,
        items: block.items?.map((key) => T(key)) ?? null,
        pairs: block.pairs?.map(([question, answer]) => ({ question: T(question), answer: T(answer) })) ?? null,
        isParagraph: block.kind === "paragraph",
        isList: block.kind === "list",
        isSteps: block.kind === "steps",
        isNote: block.kind === "note",
        isQa: block.kind === "qa"
      }));
    return {
      locale,
      isGM,
      sections: SECTIONS.map((entry, index) => ({
        id: entry.id,
        index,
        number: index + 1,
        title: T(`${prefix}.${entry.id}.title`),
        current: index === this.#index,
        visited: this.#visited.has(index)
      })),
      currentIndex: this.#index,
      currentNumber: this.#index + 1,
      total: SECTIONS.length,
      progress: this.#index + 1,
      canPrevious: this.#index > 0,
      canNext: this.#index < SECTIONS.length - 1,
      disableAutoOpen: moduleSetting("showOnboarding") === false,
      current: { title: T(`${prefix}.${section.id}.title`), blocks }
    };
  }

  async goToSection(index) {
    const numeric = Number(index);
    this.#index = Number.isFinite(numeric) ? Math.max(0, Math.min(SECTIONS.length - 1, Math.trunc(numeric))) : this.#index;
    this.#visited.add(this.#index);
    await this.render();
    const content = this.element?.querySelector("[data-onboarding-content]");
    if (content) content.scrollTop = 0;
    this.element?.querySelector("[data-onboarding-title]")?.focus();
    return this;
  }

  async _onClose(options) {
    super._onClose?.(options);
    this.onClosed?.();
  }

  static #close() {
    return this.close();
  }

  static async #toggleMinimize() {
    if (this.minimized) await this.maximize();
    else await this.minimize();
  }

  static async #toggleAutoOpen(_event, target) {
    await game.settings.set(MODULE_ID, "showOnboarding", !target.checked);
    await this.render();
    this.element?.querySelector("[data-auto-open]")?.focus();
  }

  static #goToSection(_event, target) {
    return this.goToSection(target.dataset.index);
  }

  static #previous() {
    return this.goToSection(this.#index - 1);
  }

  static #next() {
    return this.goToSection(this.#index + 1);
  }
}
