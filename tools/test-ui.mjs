/** Render production templates in local Chromium. These checks do not replace a live Foundry world. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "ui-tests");
fs.mkdirSync(out, { recursive: true });
const fixtures = [
  ["smoke-sheet-theme.mjs", "sheets"],
  ["smoke-qol.mjs", "interaction"],
  ["smoke-window-themes.mjs", "windows"],
  ["smoke-map-appearance.mjs", "map"],
  ["smoke-toolbelt-damage.mjs", "toolbelt"]
];
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
      // The appearance forms are static previews; every other fixture exposes explicit assertions.
      if (name.startsWith("form-")) {
        results.push({ file: `${folder}/${name}`, passed: (await page.locator("form").count()) === 1, errors });
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
        results.push({ file: `${folder}/${name}`, ...result, errors });
      }
      await page.close();
    }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
const failures = results.filter((r) => !r.passed || r.errors.length);
console.log(JSON.stringify({ total: results.length, passed: results.length - failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
