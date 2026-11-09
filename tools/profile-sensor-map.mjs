/* global window, document, Image, requestAnimationFrame */
/** Offline approximation: production template, CSS and paint function; not a Foundry runtime. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import Handlebars from "handlebars";
import { chromium } from "playwright";

const root = process.cwd();
const out = path.join(root, "dist", "sensor-profile");
fs.mkdirSync(out, { recursive: true });
// Generated noise images: no external assets or real user data.
const py = `from PIL import Image\nfor size in (512,4096):\n im=Image.effect_noise((size,size),72).convert('RGB')\n im.save('${out}/map-'+str(size)+'.png')\n`;
if (spawnSync("python3", ["-c", py]).status !== 0) throw new Error("Python Pillow required to create sample images");
Handlebars.registerHelper("localize", (s) => s);
const template = Handlebars.compile(fs.readFileSync(path.join(root, "templates/sensor-map-zones.hbs"), "utf8"));
const zones = Array.from({ length: 12 }, (_, z) => ({
  zone: z + 1,
  label: `${z + 1}`,
  objects: Array.from({ length: 4 }, (_, i) => ({
    key: `ship-${z}-${i}`,
    type: "starship",
    status: "operational",
    label: `Ship ${z}-${i}`,
    statusLabel: "Operational",
    icon: "◆",
    hp: "50/50",
    hpPct: 100
  }))
}));
const scene = template({ zones, isGM: true });
const moved = structuredClone(zones);
moved[0].objects.push(moved[1].objects.pop());
const scene2 = template({ zones: moved, isGM: true });
const html = `<!doctype html><link rel="stylesheet" href="/styles/main.css"><style>body{margin:0}.tsc-sensor-map{width:920px;height:520px}.tsc-map-viewport{width:920px;height:500px}</style><div class="sf2e-tsc tsc-sensor-map"><div id="part">${scene}</div></div><script>window.scenes=${JSON.stringify([scene, scene2])};window.game={settings:{get:()=>"dark"}}</script><script type="module">import {paintMapAppearance} from '/scripts/ui/map-appearance-render.mjs';window.paintMapAppearance=paintMapAppearance;window.ready=true</script>`;
fs.writeFileSync(path.join(out, "index.html"), html);
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = url === "/" ? "/dist/sensor-profile/index.html" : url;
  const file = path.resolve(root, `.${relative}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader(
    "Content-Type",
    file.endsWith(".mjs") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html"
  );
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/local/bin/chromium",
  args: ["--no-sandbox", "--disable-gpu"]
});
const results = [];
try {
  for (const image of ["none", "512", "4096"])
    for (const mode of ["replace", "retain"]) {
      const page = await browser.newPage({ viewport: { width: 920, height: 520 } });
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => window.ready);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      const metrics = (await cdp.send("Performance.getMetrics")).metrics;
      const before = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
      const timing = await page.evaluate(
        async ({ image, mode }) => {
          const root = document.querySelector(".tsc-sensor-map"),
            part = document.querySelector("#part");
          const src = image === "none" ? "" : `/dist/sensor-profile/map-${image}.png`;
          if (src) {
            const im = new Image();
            im.src = src;
            await im.decode();
          }
          const context = { appearance: { background: src, opacity: 0.8, blur: 4, fade: 0.25 } };
          window.paintMapAppearance(root, context);
          const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
          const updates = [],
            frames = [];
          for (let i = 0; i < 70; i++) {
            const start = performance.now();
            if (mode === "replace") part.innerHTML = window.scenes[i % 2];
            else {
              const temp = document.createElement("div");
              temp.innerHTML = window.scenes[i % 2];
              part.querySelector(".tsc-zones").replaceWith(temp.querySelector(".tsc-zones"));
            }
            window.paintMapAppearance(root, context);
            const elapsed = performance.now() - start;
            await raf();
            await raf();
            if (i >= 10) {
              updates.push(elapsed);
              frames.push(performance.now() - start);
            }
          }
          updates.sort((a, b) => a - b);
          frames.sort((a, b) => a - b);
          return {
            updateMedian: updates[30],
            updateP95: updates[57],
            frameMedian: frames[30],
            frameP95: frames[57],
            over50ms: frames.filter((n) => n > 50).length
          };
        },
        { image, mode }
      );
      const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      results.push({
        image,
        mode,
        ...timing,
        layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
        styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000
      });
      await page.close();
    }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  JSON.stringify({ note: "production template, CSS and paintMapAppearance; mock page, headless Chromium, no Foundry", results }, null, 2)
);
