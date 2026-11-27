import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFoundryMock, MockUser } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const sectionIds = ["intro", "quickStart", "wizard", "sensorMap", "actionSelection", "actions", "effects", "faq"];
let activeGuide = null;

afterEach(() => {
  activeGuide?._onClose?.({});
  activeGuide = null;
});

async function loadGuide() {
  const { OnboardingGuide } = await import("../../scripts/ui/onboarding.mjs");
  return OnboardingGuide;
}

async function stubRender(Class, wait = null) {
  const original = Class.prototype.render;
  let calls = 0;
  Class.prototype.render = async function () {
    calls++;
    if (wait) await wait;
    this.rendered = true;
    return this;
  };
  return {
    calls: () => calls,
    restore: () => {
      Class.prototype.render = original;
    }
  };
}

async function openGuide() {
  const { openOnboarding } = await import("../../scripts/ui/launchers.mjs");
  activeGuide = await openOnboarding();
  return activeGuide;
}

test("onboarding auto-open preference is a user Boolean setting enabled by default", async () => {
  installFoundryMock();
  const registrations = [];
  game.settings.register = (module, key, config) => registrations.push({ module, key, config });
  const { registerSettings } = await import("../../scripts/settings.mjs");
  registerSettings();
  const registration = registrations.find((entry) => entry.module === MODULE_ID && entry.key === "showOnboarding");
  assert.ok(registration);
  assert.equal(registration.config.scope, "user");
  assert.equal(registration.config.type, Boolean);
  assert.equal(registration.config.default, true);
});

test("onboarding locale maps Russian variants to RU and everything else to EN", async () => {
  installFoundryMock();
  const { onboardingLocale } = await import("../../scripts/ui/onboarding.mjs");
  for (const lang of ["ru", "ru-RU", "ru_RU", "RU-ru"]) assert.equal(onboardingLocale(lang), "ru");
  for (const lang of ["en", "en-US", "en-GB", "de", "fr", "", null]) assert.equal(onboardingLocale(lang), "en");
});

test("EN and RU provide the same eight named onboarding sections", () => {
  for (const lang of ["en", "ru"]) {
    const json = JSON.parse(read(`lang/${lang}.json`));
    for (const id of sectionIds) {
      assert.ok(json.SF2eTSC?.onboarding?.sections?.[id]?.title, `${lang}: missing title for ${id}`);
      assert.ok(Object.keys(json.SF2eTSC.onboarding.sections[id].content ?? {}).length > 0, `${lang}: missing content for ${id}`);
    }
  }
});

test("guide context exposes eight sections, current progress and the session locale", async () => {
  installFoundryMock({ lang: "ru" });
  game.i18n.lang = "ru-RU";
  const OnboardingGuide = await loadGuide();
  const app = new OnboardingGuide();
  const context = await app._prepareContext();
  assert.deepEqual(
    context.sections.map((section) => section.id),
    sectionIds
  );
  assert.equal(context.locale, "ru");
  assert.equal(context.currentIndex, 0);
  assert.equal(context.currentNumber, 1);
  assert.equal(context.total, 8);
  assert.equal(context.progress, 1);
  assert.equal(context.disableAutoOpen, false);
  assert.ok(context.current.blocks.length > 0);
});

test("next, previous and quick jump preserve bounded section progress", async () => {
  installFoundryMock();
  const OnboardingGuide = await loadGuide();
  const app = new OnboardingGuide();
  app.render = async () => app;
  await app.goToSection(2);
  assert.equal((await app._prepareContext()).currentIndex, 2);
  await OnboardingGuide.DEFAULT_OPTIONS.actions.next.call(app, {}, {});
  assert.equal((await app._prepareContext()).currentIndex, 3);
  await OnboardingGuide.DEFAULT_OPTIONS.actions.previous.call(app, {}, {});
  assert.equal((await app._prepareContext()).currentIndex, 2);
  await app.goToSection(-10);
  assert.equal((await app._prepareContext()).currentIndex, 0);
  await app.goToSection(100);
  const last = await app._prepareContext();
  assert.equal(last.currentIndex, 7);
  assert.equal(last.canNext, false);
  assert.equal(last.canPrevious, true);
});

test("minimize and maximize keep the current section and progress", async () => {
  installFoundryMock();
  const OnboardingGuide = await loadGuide();
  const app = new OnboardingGuide();
  app.render = async () => app;
  app.minimize = async () => {
    app.minimized = true;
    return app;
  };
  app.maximize = async () => {
    app.minimized = false;
    return app;
  };
  await app.goToSection(4);
  await OnboardingGuide.DEFAULT_OPTIONS.actions.toggleMinimize.call(app, {}, {});
  assert.equal(app.minimized, true);
  assert.equal((await app._prepareContext()).currentIndex, 4);
  await OnboardingGuide.DEFAULT_OPTIONS.actions.toggleMinimize.call(app, {}, {});
  assert.equal(app.minimized, false);
  assert.equal((await app._prepareContext()).progress, 5);
});

test("close and skip never enable permanent suppression", async () => {
  installFoundryMock();
  const OnboardingGuide = await loadGuide();
  for (const action of ["close", "skip"]) {
    const app = new OnboardingGuide();
    let closed = 0;
    app.close = async () => {
      closed++;
      return app;
    };
    await OnboardingGuide.DEFAULT_OPTIONS.actions[action].call(app, {}, {});
    assert.equal(closed, 1);
    assert.equal(game.settings.get(MODULE_ID, "showOnboarding"), true);
  }
});

test("the don't-show-again toggle changes only the current user's preference", async () => {
  const gm = new MockUser({ id: "gm", name: "GM", isGM: true });
  const player = new MockUser({ id: "p1", name: "Player" });
  const mock = installFoundryMock({ users: [gm, player] });
  const registrations = [];
  game.settings.register = (module, key, config) => registrations.push({ module, key, config });
  const { registerSettings } = await import("../../scripts/settings.mjs");
  registerSettings();
  const registration = registrations.find((entry) => entry.module === MODULE_ID && entry.key === "showOnboarding");
  const clientStore = new Map();
  const userStores = new Map();
  const settingId = `${MODULE_ID}.showOnboarding`;
  game.settings.get = () => {
    const store = registration.config.scope === "user" ? userStores.get(game.user.id) : clientStore;
    return store?.has(settingId) ? store.get(settingId) : registration.config.default;
  };
  game.settings.set = async (_module, _key, value) => {
    if (registration.config.scope === "user" && !userStores.has(game.user.id)) userStores.set(game.user.id, new Map());
    const store = registration.config.scope === "user" ? userStores.get(game.user.id) : clientStore;
    store.set(settingId, value);
  };
  const OnboardingGuide = await loadGuide();
  const app = new OnboardingGuide();
  app.render = async () => app;
  await OnboardingGuide.DEFAULT_OPTIONS.actions.toggleAutoOpen.call(app, {}, { checked: true });
  assert.equal(game.settings.get(), false);
  mock.setUser("p1");
  assert.equal((await app._prepareContext()).disableAutoOpen, false);
  await OnboardingGuide.DEFAULT_OPTIONS.actions.toggleAutoOpen.call(app, {}, { checked: false });
  assert.equal(game.settings.get(), true);
  mock.setUser("gm");
  assert.equal(game.settings.get(), false);
});

test("suppressed auto-open stays closed until the preference is re-enabled", async () => {
  installFoundryMock();
  game.settings.set(MODULE_ID, "showOnboarding", false);
  const OnboardingGuide = await loadGuide();
  const render = await stubRender(OnboardingGuide);
  const { autoOpenOnboarding } = await import("../../scripts/ui/launchers.mjs");
  try {
    assert.equal(autoOpenOnboarding(), undefined);
    await new Promise(setImmediate);
    assert.equal(render.calls(), 0);
    game.settings.set(MODULE_ID, "showOnboarding", true);
    assert.equal(autoOpenOnboarding(), undefined);
    activeGuide = await openGuide();
    assert.equal(render.calls(), 1);
  } finally {
    render.restore();
  }
});

test("manual reopen works even while auto-open is suppressed", async () => {
  installFoundryMock();
  game.settings.set(MODULE_ID, "showOnboarding", false);
  const OnboardingGuide = await loadGuide();
  const render = await stubRender(OnboardingGuide);
  try {
    const app = await openGuide();
    assert.equal(app.rendered, true);
    assert.equal(render.calls(), 1);
  } finally {
    render.restore();
  }
});

test("concurrent opens share one rendering guide instance", async () => {
  installFoundryMock();
  const OnboardingGuide = await loadGuide();
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const render = await stubRender(OnboardingGuide, wait);
  const { openOnboarding } = await import("../../scripts/ui/launchers.mjs");
  try {
    const first = openOnboarding();
    const second = openOnboarding();
    release();
    const [a, b] = await Promise.all([first, second]);
    activeGuide = a;
    assert.equal(a, b);
    assert.equal(render.calls(), 1);
  } finally {
    render.restore();
  }
});

test("closing and manually reopening creates a fresh guide instead of reusing a closed window", async () => {
  installFoundryMock();
  const OnboardingGuide = await loadGuide();
  const render = await stubRender(OnboardingGuide);
  try {
    const first = await openGuide();
    first._onClose({});
    activeGuide = null;
    const second = await openGuide();
    assert.notEqual(second, first);
    assert.equal(render.calls(), 2);
  } finally {
    render.restore();
  }
});

test("scene-control toggle closes the guide and a later press reopens it", async () => {
  installFoundryMock();
  const OnboardingGuide = await loadGuide();
  const render = await stubRender(OnboardingGuide);
  const originalClose = OnboardingGuide.prototype.close;
  OnboardingGuide.prototype.close = async function () {
    this.rendered = false;
    this._onClose({});
    return this;
  };
  const { toggleOnboarding } = await import("../../scripts/ui/launchers.mjs");
  try {
    const first = await toggleOnboarding();
    activeGuide = first;
    await toggleOnboarding();
    activeGuide = null;
    const second = await toggleOnboarding();
    activeGuide = second;
    assert.notEqual(first, second);
    assert.equal(render.calls(), 2);
  } finally {
    OnboardingGuide.prototype.close = originalClose;
    render.restore();
  }
});

test("auto-open is fire-and-forget and does not wait for guide rendering", async () => {
  installFoundryMock();
  const OnboardingGuide = await loadGuide();
  let release;
  let started;
  const renderStarted = new Promise((resolve) => {
    started = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const render = await stubRender(OnboardingGuide, wait);
  const originalRender = OnboardingGuide.prototype.render;
  OnboardingGuide.prototype.render = async function () {
    started();
    return originalRender.call(this);
  };
  const { autoOpenOnboarding } = await import("../../scripts/ui/launchers.mjs");
  try {
    assert.equal(autoOpenOnboarding(), undefined);
    await renderStarted;
    assert.equal(render.calls(), 1);
    release();
    activeGuide = await openGuide();
  } finally {
    OnboardingGuide.prototype.render = originalRender;
    render.restore();
  }
});

test("main wires non-blocking auto-open after module ready work and combat render", () => {
  const main = read("scripts/main.mjs");
  const render = main.indexOf("ui.combat?.render();");
  const autoOpen = main.indexOf("autoOpenOnboarding();");
  assert.ok(render >= 0);
  assert.ok(autoOpen > render);
  assert.doesNotMatch(main, /await\s+autoOpenOnboarding\(/);
  assert.match(main, /Hooks\.once\("ready"/);
});

test("the onboarding scene control is visible to players as well as the GM", async () => {
  const gm = new MockUser({ id: "gm", name: "GM", isGM: true });
  const player = new MockUser({ id: "p1", name: "Player" });
  const mock = installFoundryMock({ users: [gm, player] });
  const { registerControls } = await import("../../scripts/ui/controls.mjs");
  registerControls();
  const hook = Hooks._hooks.get("getSceneControlButtons")?.[0];
  assert.equal(typeof hook, "function");
  for (const userId of ["gm", "p1"]) {
    mock.setUser(userId);
    const controls = { tokens: { tools: [] } };
    hook(controls);
    const tool = controls.tokens.tools.find((entry) => entry.name === "tscOnboarding");
    assert.ok(tool, `${userId}: missing onboarding scene control`);
    assert.equal(tool.visible, true);
    assert.equal(tool.button, true);
    assert.equal(typeof tool.onChange, "function");
    assert.equal(tool.title, game.i18n.localize("SF2eTSC.ui.onboarding"));
  }
});
