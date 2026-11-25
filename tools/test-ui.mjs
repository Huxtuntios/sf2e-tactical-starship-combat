/** Render production templates in local Chromium. These checks do not replace a live Foundry world. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "ui-tests");
fs.mkdirSync(out, { recursive: true });
const allFixtures = [
  ["smoke-sheet-theme.mjs", "sheets"],
  ["smoke-mine-modification.mjs", "mine-modification"],
  ["smoke-mine-targets.mjs", "mine-targets"],
  ["smoke-drone-soft.mjs", "drone-soft"],
  ["smoke-qol.mjs", "interaction"],
  ["smoke-window-themes.mjs", "windows"],
  ["smoke-map-appearance.mjs", "map"],
  ["smoke-environment-object.mjs", "environment-object"],
  ["smoke-sensor-drop.mjs", "sensor-drop"],
  ["smoke-sensor-performance.mjs", "sensor-performance"],
  ["smoke-contact-editor.mjs", "contact-editor"],
  ["smoke-start-wizard.mjs", "start-wizard"],
  ["smoke-crew-stations.mjs", "crew-stations"],
  ["smoke-builder-history.mjs", "builder-history"],
  ["smoke-toolbelt-damage.mjs", "toolbelt"],
  ["smoke-native-attack.mjs", "native-attack"],
  ["smoke-plasma-attack.mjs", "plasma-attack"],
  ["smoke-chat-card-layout.mjs", "chat-card-layout"],
  ["smoke-action-controls.mjs", "action-controls"],
  ["smoke-description-links.mjs", "description-links"],
  ["smoke-compact-ui.mjs", "compact-ui"],
  ["smoke-starship-defense-editor.mjs", "defense-editor"]
];
const fixtures = process.env.TSC_UI_FOLDER
  ? allFixtures.filter(([, folder]) => fixturesMatch(folder, process.env.TSC_UI_FOLDER))
  : allFixtures;
function fixturesMatch(folder, filter) {
  return filter.split(",").includes(folder);
}
for (const [tool, folder] of fixtures) {
  const result = spawnSync(process.execPath, [path.join(root, "tools", tool), path.join(out, folder)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Fixture generation failed: ${tool}`);
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--allow-file-access-from-files", "--no-sandbox"]
});
const results = [];
try {
  for (const [, folder] of fixtures)
    for (const name of fs.readdirSync(path.join(out, folder)).filter((f) => f.endsWith(".html"))) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(out, folder, name)).href);
      if (folder === "compact-ui") {
        await page.waitForFunction(() => typeof globalThis.measureCompact === "function");
        const measurements = [];
        for (const width of [1100, 600, 380]) {
          await page.setViewportSize({ width, height: 950 });
          const measurement = await page.evaluate(() => globalThis.measureCompact());
          measurements.push({ width, ...measurement });
          await page.screenshot({ path: path.join(out, folder, name.replace(/\.html$/, `-${width}.png`)) });
        }
        const checks = measurements.flatMap((measurement) => measurement.checks);
        results.push({ file: `${folder}/${name}`, passed: checks.every((check) => check.pass), errors, measurements });
        await page.close();
        continue;
      }
      // The appearance forms are static previews; every other fixture exposes explicit assertions.
      if (name.startsWith("form-")) {
        const formCount = await page.locator("form").count();
        let passed = formCount === 1;
        if (folder === "map" && name.startsWith("form-object")) {
          const arrowAppearanceOptions = await page
            .locator('select[name="arrowAppearanceMode"] option')
            .evaluateAll((options) => options.map((option) => option.value));
          const mirrorOptions = await page
            .locator('select[name="autoMirrorOverride"] option')
            .evaluateAll((options) => options.map((option) => option.value));
          const arrowFields = await page
            .locator('input[name="arrowImage"], input[name="arrowSize"], input[name="arrowGap"], input[name="arrowOpacity"]')
            .count();
          const resetEnabled = !(await page.locator('[data-action="resetArrowAppearance"]').isDisabled());
          const isOverride = name.includes("form-object-override");
          const values = await page
            .locator('input[name="arrowImage"], input[name="arrowSize"], input[name="arrowGap"], input[name="arrowOpacity"]')
            .evaluateAll((inputs) => inputs.map((input) => input.value));
          const selectedMode = await page.locator('select[name="arrowAppearanceMode"]').inputValue();
          passed =
            passed &&
            mirrorOptions.includes("inherit") &&
            mirrorOptions.includes("on") &&
            mirrorOptions.includes("off") &&
            arrowAppearanceOptions.includes("inherit") &&
            arrowAppearanceOptions.includes("override") &&
            arrowFields === 4 &&
            resetEnabled &&
            selectedMode === (isOverride ? "override" : "inherit") &&
            values.join("|") === (isOverride ? "object-arrow.webp|31|8|0.4" : "global-arrow.webp|22|5|0.75");
        }
        results.push({ file: `${folder}/${name}`, passed, errors });
      } else {
        await page.waitForFunction(
          () => {
            const result = globalThis.document.querySelector("#result");
            return result && result.textContent !== "waiting";
          },
          null,
          { timeout: 10000 }
        );
        const result = JSON.parse(await page.locator("#result").innerText());
        if (folder === "plasma-attack") {
          for (const lang of ["en", "ru"]) {
            await page.evaluate((language) => globalThis.showPlasmaLanguage(language), lang);
            await page.locator("#chat").screenshot({ path: path.join(out, folder, `plasma-attack-${lang}.png`) });
          }
        }
        if (folder === "start-wizard") {
          const before = await page.evaluate(() => {
            globalThis.fixture.root.querySelector(".tsc-wizard-browse").open = true;
            return {
              opened: globalThis.fixture.originalsOpened.length,
              writes: globalThis.__writes.length,
              draft: JSON.stringify(globalThis.wizard.getDraft())
            };
          });
          const preview = page.locator('[data-action="previewOriginal"][data-uuid="Actor.enemy"]');
          await preview.focus();
          await preview.press("Enter");
          await page.waitForFunction((n) => globalThis.fixture.originalsOpened.length === n + 1, before.opened);
          await preview.press("Space");
          await page.waitForFunction((n) => globalThis.fixture.originalsOpened.length === n + 2, before.opened);
          const unchanged = await page.evaluate(
            (before) =>
              globalThis.__writes.length === before.writes &&
              JSON.stringify(globalThis.wizard.getDraft()) === before.draft &&
              globalThis.fixture.root.querySelector("[data-selected-count]").textContent === "0",
            before
          );
          result.checks.push({ name: "keyboard-preview-without-selection-or-submit", pass: unchanged });
          result.checks.push({
            name: "preview-focus-visible",
            pass: await preview.evaluate((el) => globalThis.getComputedStyle(el).outlineStyle !== "none")
          });
          await page.evaluate(async () => {
            globalThis.fixture.enemy.name = "Очень длинное имя корабля / A very long starship name ".repeat(8);
            await globalThis.wizard.render();
            await globalThis.fixture.set('[name="filter"]', "Очень длинное");
          });
          for (const width of [1100, 600]) {
            await page.setViewportSize({ width, height: 950 });
            for (const theme of ["dark", "light"]) {
              const contained = await page.evaluate((theme) => {
                globalThis.document.querySelector("main.application").setAttribute("data-sheet-theme", theme);
                const row = globalThis.fixture.root.querySelector('[data-candidate-row][data-uuid="Actor.enemy"]');
                const button = row.querySelector("button");
                const filters = globalThis.fixture.root.querySelector(".tsc-wizard-filters");
                return (
                  !row.hidden &&
                  row.scrollWidth <= row.clientWidth + 1 &&
                  filters.scrollWidth <= filters.clientWidth + 1 &&
                  button.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1
                );
              }, theme);
              result.checks.push({ name: `long-candidate-contained-${width}-${theme}`, pass: contained });
            }
          }
          result.passed = result.checks.every((check) => check.pass);
        }
        if (folder === "defense-editor") {
          const addSelect = page.locator('[data-defense-add="resistances"]');
          const initial = await addSelect.inputValue();
          await addSelect.focus();
          await addSelect.press("ArrowDown");
          const changed = (await addSelect.inputValue()) !== initial;
          await addSelect.press("Tab");
          const advanced = await addSelect.evaluate((element) => globalThis.document.activeElement !== element);
          const remove = page.locator("[data-defense-tag] button").first();
          await remove.focus();
          const focusVisible = await remove.evaluate((element) => globalThis.getComputedStyle(element).outlineStyle !== "none");
          result.checks.push({ name: "native-select-keyboard", pass: changed && advanced });
          result.checks.push({ name: "keyboard-focus-visible", pass: focusVisible });
          result.passed = result.checks.every((check) => check.pass);
          await page.evaluate(() => {
            globalThis.document.querySelector("#app").style.width = "100%";
          });
          for (const width of [1100, 600, 380]) {
            await page.setViewportSize({ width, height: 950 });
            await page.screenshot({ path: path.join(out, folder, name.replace(/\.html$/, `-${width}.png`)) });
          }
        }
        if (folder === "action-controls") {
          const descriptionButton = page.locator('[data-kind="HUD"] .tsc-action-name').first();
          const before = await page.evaluate(() => globalThis.actionControlExecutions.length);
          await descriptionButton.focus();
          await descriptionButton.press("Enter");
          await page.locator("dialog[open]").waitFor();
          const noExecution = await page.evaluate((n) => globalThis.actionControlExecutions.length === n, before);
          result.checks.push({ name: "keyboard-description-only", pass: noExecution });
          await page.locator("dialog[open] [data-close]").click();
          await page.waitForFunction(() => !globalThis.document.querySelector("dialog"));
          const warning = page.locator('[data-kind="HUD"] .tsc-action-warning').first();
          await warning.focus();
          await warning.press("Enter");
          const tooltip = await page.evaluate(() => globalThis.actionTooltip.includes("Warning text"));
          result.checks.push({ name: "keyboard-warning-tooltip", pass: tooltip });
          const cost = page.locator('[data-kind="HUD"] .tsc-action-cost').first();
          await cost.focus();
          await cost.press("Space");
          const oneExecution = await page.evaluate((n) => globalThis.actionControlExecutions.length === n + 1, before);
          result.checks.push({ name: "keyboard-cost-executes-once", pass: oneExecution });
          const focusVisible = await cost.evaluate((el) => globalThis.getComputedStyle(el).outlineStyle !== "none");
          result.checks.push({ name: "cost-keyboard-focus-visible", pass: focusVisible });
          result.passed = result.checks.every((check) => check.pass);
          await page.locator('[data-kind="HUD"]').screenshot({ path: path.join(out, folder, name.replace(/\.html$/, ".png")) });
        }
        if (folder === "builder-history" && name.startsWith("builder-")) {
          const select = page.locator('select[name="size"]');
          await select.focus();
          await select.press("ArrowDown");
          const changed = (await select.inputValue()) === "large";
          await select.press("Escape");
          await select.press("Tab");
          const advanced = await select.evaluate((el) => globalThis.document.activeElement !== el);
          result.checks.push({ name: "native-select-keyboard", pass: changed && advanced });
          result.passed = result.passed && changed && advanced;
        }
        results.push({ file: `${folder}/${name}`, ...result, errors });
      }
      await page.close();
    }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
const failures = results.filter((r) => !r.passed || r.errors.length);
const failureDetails = failures.map((result) =>
  result.measurements
    ? {
        file: result.file,
        errors: result.errors,
        failedChecks: result.measurements.flatMap((measurement) =>
          measurement.checks.filter((check) => !check.pass).map((check) => `${measurement.width}: ${check.name}`)
        )
      }
    : result
);
console.log(JSON.stringify({ total: results.length, passed: results.length - failures.length, failures: failureDetails }, null, 2));
if (failures.length) process.exitCode = 1;
