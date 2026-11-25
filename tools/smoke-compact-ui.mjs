import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Handlebars from "handlebars";
import { installFoundryMock, loadContentFromDisk, makeCharacter, makeShip } from "../tests/helpers/foundry-mock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "ui-tests", "compact-ui");
fs.mkdirSync(out, { recursive: true });
const h = Handlebars.create();
h.registerHelper("localize", (key) => game.i18n.localize(key));
h.registerHelper("eq", (a, b) => a === b);
installFoundryMock();
for (const file of fs.readdirSync(path.join(root, "templates")).filter((name) => name.endsWith(".hbs")))
  h.registerPartial(`modules/sf2e-tactical-starship-combat/templates/${file}`, fs.readFileSync(path.join(root, "templates", file), "utf8"));
const { OCCUPANT_PARTIAL } = await import("../scripts/crew/occupant.mjs");
const { STATION_UPGRADES_PARTIAL, SHIP_UPGRADES_PARTIAL, UPGRADE_ITEM_PARTIAL } = await import("../scripts/ui/sheet/sheet-upgrades.mjs");
h.registerPartial("tscOccupant", OCCUPANT_PARTIAL);
h.registerPartial("tscStationUpgrades", STATION_UPGRADES_PARTIAL);
h.registerPartial("tscShipUpgrades", SHIP_UPGRADES_PARTIAL);
h.registerPartial("tscUpgradeItem", UPGRADE_ITEM_PARTIAL);
const { buildSheetContext } = await import("../scripts/ui/sheet/sheet-context.mjs");
const render = (name, context) => h.compile(fs.readFileSync(path.join(root, "templates", `${name}.hbs`), "utf8"))(context);

const controlCounts = {
  "sensor-gm": 93,
  "sensor-player": 62,
  "npc-actions": 36,
  "npc-config": 85,
  "npc-equipment": 23,
  "npc-notes": 17,
  "npc-overview": 36,
  "npc-stations": 40,
  "player-config": 89,
  "player-equipment": 21,
  "player-notes": 15,
  "player-overview": 34,
  "player-stations": 99
};
const commonSheetActions = ["openMap", "openHistory", "gmDamage", "gmRepair"];
const tabActions = {
  overview: ["rollShipCheck", "sheetAttack", "sheetDamage"],
  actions: ["runAction", "describeAction", "sendActionDescription", "manualResolve"],
  stations: ["forceClaim", "unhelm", "toggleMalf", "removeStation", "runAction", "describeAction", "sendActionDescription", "addStation"],
  equipment: ["removeWeapon", "addWeapon", "addStationUpgrade", "removeStationUpgrade", "openUpgrade"],
  notes: ["saveNotes"],
  config: ["editImage", "removeStation", "addStation", "addWeapon", "removeListItem", "addListItem", "exportJson", "importJson", "editJson"]
};
const sensorActions = [
  "selectObject",
  "pickZone",
  "openSheet",
  "moveLeft",
  "moveRight",
  "dockPick",
  "dockAct",
  "describeAction",
  "sendActionDescription",
  "toggleRanges"
];

function expectationFor(kind, role, tab, isGM) {
  if (kind === "tsc-sensor-map")
    return {
      controlCount: controlCounts[isGM ? "sensor-gm" : "sensor-player"],
      requiredActions: isGM
        ? [
            ...sensorActions,
            "recoverReveals",
            "addAllNpcInitiative",
            "mapAppearance",
            "addObject",
            "addPublicObject",
            "resizeZones",
            "openCrew",
            "addInitiative",
            "objectArt",
            "flipHeading",
            "toggleHidden",
            "setDetect",
            "removeObj"
          ]
        : sensorActions
    };
  return {
    controlCount: controlCounts[`${role}-${tab}`],
    requiredActions: [
      ...commonSheetActions,
      ...tabActions[tab],
      ...(role === "npc" ? ["updateFromContent"] : []),
      ...(tab === "stations" && role === "player" ? ["openStationHud", "openCrewManager", "ready", "remove"] : []),
      ...(tab === "config" && role === "player" ? ["applyFrame"] : [])
    ]
  };
}

function sheetBudgets(role, tab) {
  const widths = {
    1100: { "header.height": role === "npc" ? 114 : 116, "tabs.height": 58 },
    600: { "header.height": role === "npc" ? 150 : 174, "tabs.height": 58 },
    380: { "header.height": 230, "tabs.height": 82 }
  };
  const body = {
    overview: { 1100: role === "npc" ? 350 : 335, 600: role === "npc" ? 380 : 405, 380: role === "npc" ? 445 : 480 },
    actions: { 1100: 320, 600: 320, 380: 350 },
    stations: { 1100: role === "npc" ? 335 : 980, 600: role === "npc" ? 425 : 1120, 380: role === "npc" ? 565 : 1730 },
    equipment: { 1100: role === "npc" ? 290 : 280, 600: 305, 380: 340 },
    notes: { 1100: 267, 600: 267, 380: 267 },
    config: { 1100: role === "npc" ? 1310 : 1435, 600: role === "npc" ? 1340 : 1535, 380: role === "npc" ? 1670 : 1865 }
  }[tab];
  for (const width of [1100, 600, 380]) widths[width].bodyContentHeight = body[width];
  if (tab === "overview")
    for (const width of [1100, 600, 380]) widths[width]["statGrid.height"] = width === 380 ? 196 : width === 600 ? 148 : 140;
  return widths;
}

function sensorBudgets() {
  return {
    1100: { "mapTop.height": 24, "dock.height": 150, "dockActions.height": 100, actionRowMaxHeight: 28, contentScrollHeight: 490 },
    600: { "mapTop.height": 24, "dock.height": 210, "dockActions.height": 140, actionRowMaxHeight: 28, contentScrollHeight: 490 },
    380: { "mapTop.height": 46, "dock.height": 145, "dockActions.height": 40, actionRowMaxHeight: 28, contentScrollHeight: 490 }
  };
}
const sensorMinimums = {
  1100: { "zones.height": 199 },
  600: { "zones.height": 100 },
  380: { "zones.height": 160, "detail.height": 80 }
};

const measure = `
const round = value => Math.round(value * 10) / 10;
const size = element => element ? { width: round(element.getBoundingClientRect().width), height: round(element.getBoundingClientRect().height) } : null;
globalThis.measureCompact = () => {
  const app = document.querySelector('#app');
  if (globalThis.fixtureConfig.rangeMode) app.dataset.rangeMode = globalThis.fixtureConfig.rangeMode;
  const content = app.querySelector('.window-content');
  const body = app.querySelector('.tsc-tab-body');
  const rect = content.getBoundingClientRect();
  const bodyContentHeight = body
    ? Math.max(0, ...[...body.children].map(element => {
        const box = element.getBoundingClientRect();
        return box.bottom - body.getBoundingClientRect().top + parseFloat(getComputedStyle(element).marginBottom);
      }))
    : null;
  const controls = [...app.querySelectorAll('button,input,select,textarea,[data-action]')];
  const actions = {};
  for (const element of app.querySelectorAll('[data-action]')) {
    const action = element.dataset.action;
    actions[action] = (actions[action] ?? 0) + 1;
  }
  const metrics = {
    window: size(app),
    content: size(content),
    contentScrollWidth: content.scrollWidth,
    contentScrollHeight: content.scrollHeight,
    header: size(app.querySelector('.tsc-sheet-head, .tsc-map-bar')),
    tabs: size(app.querySelector('.tsc-sheet-tabs')),
    bodyScrollHeight: body?.scrollHeight ?? null,
    bodyContentHeight: bodyContentHeight == null ? null : round(bodyContentHeight),
    statGrid: size(app.querySelector('.tsc-stat-grid')),
    stationList: size(app.querySelector('.tsc-station-list')),
    editor: size(app.querySelector('.tsc-editor')),
    mapTop: size(app.querySelector('.tsc-map-top')),
    zones: size(app.querySelector('.tsc-zones')),
    detail: size(app.querySelector('.tsc-detail')),
    dock: size(app.querySelector('.tsc-dock')),
    dockActions: size(app.querySelector('.tsc-dock-actions')),
    actionRowMaxHeight: Math.max(0, ...[...app.querySelectorAll('.tsc-dock-actions .tsc-action-row')].map(element => element.getBoundingClientRect().height)),
    controlCount: controls.length,
    actions,
    rangeMode: app.dataset.rangeMode ?? null,
    rangeOutlines: app.querySelectorAll('.tsc-range-outline').length,
    blurredZones: app.querySelectorAll('.tsc-zone.tsc-outside-range').length,
    rangeTogglePressed: app.querySelector('[data-action="toggleRanges"]')?.getAttribute('aria-pressed') ?? null,
    rangeObjectCount: app.querySelectorAll('.tsc-zone .tsc-obj').length,
    fonts: {
      root: getComputedStyle(app).fontSize,
      button: getComputedStyle(app.querySelector('button:not(.tsc-chip):not(.tsc-obj)') ?? app).fontSize,
      statLabel: app.querySelector('.tsc-stat-grid label') ? getComputedStyle(app.querySelector('.tsc-stat-grid label')).fontSize : null,
      statValue: app.querySelector('.tsc-stat-grid strong') ? getComputedStyle(app.querySelector('.tsc-stat-grid strong')).fontSize : null,
      objectName: app.querySelector('.tsc-obj-name') ? getComputedStyle(app.querySelector('.tsc-obj-name')).fontSize : null,
      zoneHead: app.querySelector('.tsc-zone-head') ? getComputedStyle(app.querySelector('.tsc-zone-head')).fontSize : null
    }
  };
  const horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1 || content.scrollWidth > content.clientWidth + 1;
  const escaped = controls.filter(element => {
    if (element.closest('.tsc-zones,.tsc-table-scroll,.tsc-sheet-crew .tsc-station')) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && (box.left < rect.left - 1 || box.right > rect.right + 1);
  }).map(element => element.dataset.action ?? element.dataset.field ?? element.name ?? element.tagName.toLowerCase());
  const text = [...app.querySelectorAll('.tsc-sheet-title h2,.tsc-stat-grid label,.tsc-stat-grid strong,.tsc-action-name,.tsc-obj-name,.tsc-dock-title')];
  const clipped = text.filter(element => {
    const style = getComputedStyle(element);
    return element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1 && style.overflowY === 'hidden';
  }).map(element => element.className || element.tagName.toLowerCase());
  const checks = [
    { name: 'no-unintended-horizontal-overflow', pass: !horizontalOverflow },
    { name: 'controls-contained-horizontally', pass: escaped.length === 0 },
    { name: 'key-text-not-clipped', pass: clipped.length === 0 },
    { name: 'readable-font-sizes-retained', pass: metrics.fonts.root === '13px' && parseFloat(metrics.fonts.button) >= 13 && (!metrics.fonts.statLabel || metrics.fonts.statLabel === '11px') && (!metrics.fonts.statValue || metrics.fonts.statValue === '16px') && (!metrics.fonts.objectName || metrics.fonts.objectName === '11px') && (!metrics.fonts.zoneHead || metrics.fonts.zoneHead === '11px') }
  ];
  const expected = globalThis.fixtureExpectation ?? {};
  if (expected.controlCount != null) checks.push({ name: 'control-count-preserved', pass: metrics.controlCount === expected.controlCount });
  for (const action of expected.requiredActions ?? []) checks.push({ name: 'control-retained-' + action, pass: (metrics.actions[action] ?? 0) > 0 });
  if (globalThis.fixtureConfig.rangeMode) {
    const outside = app.querySelector('.tsc-zone.tsc-outside-range');
    const outsideName = outside?.querySelector('.tsc-obj-name');
    const backdrop = outside ? getComputedStyle(outside, '::after').backdropFilter : 'none';
    const nameFilter = outsideName ? getComputedStyle(outsideName).filter : 'none';
    const outlines = [...app.querySelectorAll('.tsc-range-outline')].map(element => element.outerHTML).join('');
    const zoneBoxes = [...app.querySelectorAll('.tsc-zone')].map(element => element.getBoundingClientRect());
    const rangeElements = [...app.querySelectorAll('.tsc-range-outline')];
    const rangeBoxes = rangeElements.map(element => element.getBoundingClientRect());
    const regularGrid = zoneBoxes.every((box, index) => index === 0 || Math.abs(box.left - zoneBoxes[index - 1].right - 2) <= 1);
    const aligned = rangeBoxes.length === globalThis.fixtureConfig.expectedRanges && rangeElements.every((element, index) => {
      const start = Number(element.dataset.startZone) - 1;
      const end = Number(element.dataset.endZone) - 1;
      return Math.abs(rangeBoxes[index].left - zoneBoxes[start].left) <= 1 && Math.abs(rangeBoxes[index].right - zoneBoxes[end].right) <= 1;
    });
    checks.push(
      { name: 'range-zone-grid-regular', pass: regularGrid },
      { name: 'range-outlines-aligned', pass: aligned },
      { name: 'range-outlines-separate', pass: metrics.rangeOutlines === globalThis.fixtureConfig.expectedRanges },
      { name: 'range-toggle-preserved', pass: metrics.rangeTogglePressed === 'true' },
      { name: 'range-objects-not-omitted', pass: metrics.rangeObjectCount === 24 },
      { name: 'range-data-no-identity', pass: !/Actor\\.|Private identity|secret\\.webp/.test(outlines) },
      { name: 'range-player-blur-only', pass: globalThis.fixtureConfig.rangeMode === 'gm' ? metrics.blurredZones === 0 : metrics.blurredZones > 0 && backdrop.includes('blur') && nameFilter === 'none' }
    );
  }
  const budgets = globalThis.fixtureBudgets?.[innerWidth] ?? {};
  for (const [key, maximum] of Object.entries(budgets)) {
    const value = key.split('.').reduce((object, part) => object?.[part], metrics);
    checks.push({ name: 'compact-' + key + '-' + innerWidth, pass: value != null && value <= maximum });
  }
  for (const [key, minimum] of Object.entries(globalThis.fixtureMinimums?.[innerWidth] ?? {})) {
    const value = key.split('.').reduce((object, part) => object?.[part], metrics);
    checks.push({ name: 'content-space-' + key + '-' + innerWidth, pass: value != null && value >= minimum });
  }
  return { metrics, checks, escaped, clipped, passed: checks.every(check => check.pass) };
};
globalThis.measureCompact();
`;

function page(title, kind, content, expectation, budgets, windowWidth, windowHeight, minimums = {}, rangeMode = null, expectedRanges = 0) {
  const config = { expectation, budgets, minimums, windowWidth, windowHeight, kind, title, rangeMode, expectedRanges };
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${rootUrl}/styles/main.css"><style>
body{margin:0;background:#777;font:13px Arial}.application{width:min(${windowWidth}px,calc(100vw - 16px));height:${windowHeight}px;box-sizing:border-box}.window-header{height:30px;box-sizing:border-box;padding:8px}.window-content{height:calc(100% - 30px);box-sizing:border-box}#result{position:fixed;inset:auto auto 0 0;max-width:calc(100vw - 8px);max-height:80px;overflow:auto;opacity:0;pointer-events:none;font:10px monospace;background:#111;color:#fff}
</style><main id="app" class="sf2e-tsc ${kind} application" data-sheet-theme="dark"><header class="window-header">${title}</header><section class="window-content">${content}</section></main><pre id="result">waiting</pre><script>globalThis.fixtureConfig=${JSON.stringify(config)};globalThis.fixtureExpectation=globalThis.fixtureConfig.expectation;globalThis.fixtureBudgets=globalThis.fixtureConfig.budgets;globalThis.fixtureMinimums=globalThis.fixtureConfig.minimums;</script><script type="module">${measure}document.querySelector('#result').textContent=JSON.stringify(globalThis.measureCompact());</script>`;
}

async function sheetFixture(role, tab, lang) {
  installFoundryMock({ lang });
  await loadContentFromDisk();
  const ci = await import("../scripts/content/content-i18n.mjs");
  ci.setContentTranslations(
    lang,
    lang === "ru" ? JSON.parse(fs.readFileSync(path.join(root, "lang/content/ru.json"), "utf8")).strings : {}
  );
  const operator = makeCharacter({
    id: `operator-${role}-${lang}`,
    name: lang === "ru" ? "Инженер Очень Длинное Имя" : "Engineer Very Long Name",
    owners: ["gm"]
  });
  const actor = makeShip({
    id: `compact-${role}-${lang}`,
    name: lang === "ru" ? "Звездолёт «Северное сияние» с очень длинным названием" : "Aurora Borealis with a very long starship name",
    role,
    owners: ["gm"],
    level: 5,
    hp: 80,
    sp: 24,
    stations: [
      { id: "pilot", name: lang === "ru" ? "Пульт пилота" : "Pilot console", type: "pilot", grade: "tactical", helmedBy: operator.uuid },
      {
        id: "gunnery",
        name: lang === "ru" ? "Орудийная станция" : "Gunnery station",
        type: "gunnery",
        grade: "tactical",
        helmedBy: operator.uuid,
        weaponId: "coilgun"
      }
    ],
    weapons: [{ id: "coilgun", weaponRef: "coilgun", name: lang === "ru" ? "Катушечная пушка" : "Coilgun" }],
    crew: [{ actorUuid: operator.uuid, name: operator.name, role: "crew", stationId: "pilot", userId: "gm" }],
    extra: {
      fort: 11,
      fortify: 6,
      notes:
        lang === "ru"
          ? "Длинная заметка корабля, которая должна оставаться читаемой и доступной."
          : "A long ship note that must remain readable and available.",
      gmNotes: lang === "ru" ? "Секретная заметка ведущего с длинным текстом." : "A long GM-only note.",
      expansionBays: [{ id: "bay-1", name: lang === "ru" ? "Медицинский отсек" : "Medical bay" }],
      upgrades: [
        { id: "upgrade-1", ref: "tractor-beam", variant: null, stationId: "gunnery" },
        { id: "upgrade-ship", ref: "telepod", variant: null, stationId: null }
      ],
      strikes: [
        { name: lang === "ru" ? "Тяжёлый таран" : "Heavy ram", kind: "melee", attack: 8, damage: "2d8 bludgeoning", traits: ["tech"] }
      ],
      npcActions: [
        {
          id: "custom-ability",
          name: lang === "ru" ? "Очень длинное название способности" : "A very long ability name",
          cost: "two-actions",
          traits: ["tech"],
          text: lang === "ru" ? "Описание способности." : "Ability description."
        }
      ],
      sourceId: "compact-source",
      unknownField: { keep: true }
    }
  });
  actor.img = `${rootUrl}/assets/icons/starship.svg`;
  const tabs =
    role === "npc"
      ? ["overview", "actions", "stations", "equipment", "notes", "config"]
      : ["overview", "stations", "equipment", "notes", "config"];
  const sheet = { document: actor, isNpc: role === "npc", tab, tabs };
  const context = await buildSheetContext(sheet);
  context.warnings = [lang === "ru" ? "Длинное предупреждение о состоянии корабля" : "A long starship status warning"];
  const content = ["starship-sheet-header", "starship-sheet-tabs", "starship-sheet"].map((name) => render(name, context)).join("\n");
  const name = `sheet-${role}-${tab}-${lang}.html`;
  fs.writeFileSync(
    path.join(out, name),
    page(
      `${role} ${tab} ${lang}`,
      `tsc-sheet${role === "npc" ? " tsc-npc" : ""}`,
      content,
      expectationFor("tsc-sheet", role, tab, true),
      sheetBudgets(role, tab),
      role === "npc" ? 700 : 780,
      role === "npc" ? 620 : 640
    )
  );
}

function sensorFixture(isGM, lang) {
  const label = (en, ru) => (lang === "ru" ? ru : en);
  const zones = Array.from({ length: 12 }, (_, index) => ({
    zone: index + 1,
    label: String(index + 1).padStart(2, "0"),
    cover: index === 1,
    concealment: index === 2,
    outsideRange: !isGM && index >= 6,
    crowded: true,
    special: index === 3 ? label("Special zone effect", "Особый эффект зоны") : "",
    publicNotes: index === 4 ? label("Public zone note", "Публичная заметка зоны") : "",
    hasNotes: index === 4,
    objects: Array.from({ length: 2 }, (_, objectIndex) => ({
      key: `ship-${index}-${objectIndex}`,
      type: "starship",
      status: "operational",
      statusLabel: label("Operational", "В строю"),
      label: label(
        `Starship ${index + 1}-${objectIndex + 1} with a long name`,
        `Звездолёт ${index + 1}-${objectIndex + 1} с длинным названием`
      ),
      icon: "◆",
      heading: "right",
      arrow: "→",
      arrowPosition: "right",
      arrowSize: 18,
      arrowGap: 4,
      arrowOpacity: 1,
      transform: { rotation: 0, scaleX: 1, scaleY: 1 },
      hp: "50/80",
      hpPct: 63,
      sp: "12/24",
      spPct: 50,
      selected: index === 0 && objectIndex === 0,
      current: index === 0 && objectIndex === 0,
      target: null,
      targetLabel: null,
      hiddenObj: false
    }))
  }));
  const detection = ["undetected", "hidden", "observed", "identified"].map((id, index) => ({
    id,
    label: label(id, ["Не обнаружен", "Скрыт", "Наблюдается", "Опознан"][index]),
    active: index === 2
  }));
  const context = {
    isGM,
    rangeMode: isGM ? "gm" : "player",
    showRanges: true,
    sensorRanges: isGM
      ? [
          { index: 0, zone: 2, range: 3, startZone: 1, endZone: 5, endColumn: 6, color: "#38bdf8" },
          { index: 1, zone: 9, range: 2, startZone: 7, endZone: 12, endColumn: 13, color: "#a78bfa" }
        ]
      : [{ index: 0, zone: 3, range: 3, startZone: 1, endZone: 6, endColumn: 7, color: "#38bdf8" }],
    noCombat: false,
    combat: { round: 3, turn: label("Aurora Borealis", "Северное сияние") },
    zoneCount: 12,
    zones,
    targeting: null,
    pendingRevealCount: isGM ? 1 : 0,
    log: [
      label("A long sensor map log entry", "Длинная запись журнала карты сенсоров"),
      label("Another log entry", "Ещё одна запись журнала")
    ],
    gmToolsOpen: true,
    detail: {
      key: "ship-0-0",
      label: label("Aurora Borealis with a long name", "Северное сияние с очень длинным названием"),
      rows: [
        { k: label("Zone", "Зона"), v: "01" },
        { k: label("Type", "Тип"), v: label("Starship", "Звездолёт") },
        { k: label("Heading", "Курс"), v: label("Right", "Вправо") },
        { k: label("Level", "Уровень"), v: "5" },
        { k: label("Hull Points", "Корпус"), v: "50/80" },
        { k: label("Shield Points", "Щиты"), v: "12/24" },
        { k: label("AC", "КД"), v: "20" },
        { k: label("Status", "Статус"), v: label("Operational", "В строю") }
      ],
      vitals: { shipUuid: "Actor.ship", hp: 50, hpMax: 80, sp: 12, spMax: 24 },
      canOpen: true,
      canAddToInitiative: isGM,
      canMove: true,
      typeOptions: [{ id: "starship", label: label("Starship", "Звездолёт"), selected: true }],
      gm: isGM
        ? {
            shipUuid: "Actor.ship",
            heading: "right",
            headings: [
              { id: "left", label: label("Left", "Влево") },
              { id: "right", label: label("Right", "Вправо"), active: true }
            ],
            statuses: [{ id: "operational", label: label("Operational", "В строю"), active: true }]
          }
        : null,
      detection: isGM ? detection : null,
      isHazard: false,
      isMine: false,
      hidden: false,
      mine: null
    },
    dock: {
      none: false,
      stationIcon: "fa-solid fa-gamepad",
      station: label("Gunnery station", "Орудийная станция"),
      crew: label("Engineer Very Long Name", "Инженер Очень Длинное Имя"),
      ship: label("Aurora Borealis", "Северное сияние"),
      selectors: [
        { i: 0, active: true, label: label("First weapon", "Первое оружие"), short: "1" },
        { i: 1, label: label("Second weapon", "Второе оружие"), short: "2" }
      ],
      boosted: true,
      boostCaption: label("Battle station boost", "Усиление боевой станции"),
      malfunctioning: false,
      noCombatant: false,
      dcRows: [
        { label: label("Gunnery", "Орудия"), value: 18 },
        { label: label("Engineering", "Инженерия"), value: 16 }
      ],
      crewUuid: "Actor.operator",
      shipUuid: "Actor.ship",
      actions: Array.from({ length: 6 }, (_, index) => ({
        id: `action-${index}`,
        name: label(`Station action ${index + 1} with a long name`, `Действие станции ${index + 1} с длинным названием`),
        icon: index % 2 ? "◆" : "◇",
        costLabel: label("One action", "Одно действие"),
        enabled: true,
        needsTarget: index === 0,
        frequency: index === 1 ? label("Once per round", "Один раз за раунд") : "",
        warnings: "",
        reasons: "",
        desc: `<p>${label("Action description", "Описание действия")}</p>`
      }))
    }
  };
  const content = ["bar", "zones", "detail", "dock"].map((name) => render(`sensor-map-${name}`, context)).join("\n");
  const name = `sensor-${isGM ? "gm" : "player"}-${lang}.html`;
  fs.writeFileSync(
    path.join(out, name),
    page(
      `sensor ${isGM ? "GM" : "player"} ${lang}`,
      "tsc-sensor-map",
      content,
      expectationFor("tsc-sensor-map", null, null, isGM),
      sensorBudgets(),
      920,
      520,
      sensorMinimums,
      isGM ? "gm" : "player",
      isGM ? 2 : 1
    )
  );
}

for (const lang of ["en", "ru"])
  for (const role of ["player", "npc"])
    for (const tab of role === "npc"
      ? ["overview", "actions", "stations", "equipment", "notes", "config"]
      : ["overview", "stations", "equipment", "notes", "config"])
      await sheetFixture(role, tab, lang);
for (const lang of ["en", "ru"]) {
  await sensorFixture(true, lang);
  await sensorFixture(false, lang);
}
console.log(`Wrote compact UI fixtures to ${out}`);
