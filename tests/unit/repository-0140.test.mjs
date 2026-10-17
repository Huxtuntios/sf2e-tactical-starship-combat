import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { PROJECT_ROOT, releaseManifest, buildRelease } from "../../tools/build-release.mjs";
import { hazardAbilityHTML } from "../../scripts/content/ship-docs.mjs";

const read = (name) => fs.readFileSync(path.join(PROJECT_ROOT, name), "utf8");
const source = JSON.parse(read("module.json"));
const repo = "Huxtuntios/sf2e-tactical-starship-combat";

test("release manifest has a stable update channel and a pinned versioned download without mutating its source", () => {
  const before = structuredClone(source);
  const manifest = releaseManifest(source, repo);
  assert.equal(manifest.manifest, `https://github.com/${repo}/releases/latest/download/module.json`);
  assert.equal(manifest.download, `https://github.com/${repo}/releases/download/v${source.version}/module.zip`);
  assert.equal(manifest.bugs, `https://github.com/${repo}/issues`);
  assert.deepEqual(source, before);
  assert.equal(manifest.compatibility.verified, undefined);
});

test("release builder rejects invalid repository and version inputs", () => {
  assert.throws(() => releaseManifest(source, "https://github.com/some/repo"), /OWNER\/REPOSITORY/);
  assert.throws(() => releaseManifest({ ...source, version: "next" }, repo), /semantic version/);
});

test("release builder refuses mismatching package versions before collecting files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-version-"));
  try {
    for (const [name, data] of Object.entries({
      "module.json": source,
      "package.json": { version: "0.0.0" },
      "package-lock.json": { version: source.version, packages: { "": { version: source.version } } }
    }))
      fs.writeFileSync(path.join(root, name), JSON.stringify(data));
    assert.throws(() => buildRelease({ root }), /versions must match/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release ZIP contains matching root manifest and complete packs, but no developer files", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-release-"));
  try {
    buildRelease({ out });
    const zip = fs.readFileSync(path.join(out, "module.zip"));
    const files = unzipSync(zip);
    const names = Object.keys(files);
    assert.ok(files["module.json"]);
    assert.equal(strFromU8(files["module.json"]), fs.readFileSync(path.join(out, "module.json"), "utf8"));
    assert.ok(files["README.ru.md"] && files["LICENSE"] && files["scripts/main.mjs"]);
    assert.ok(!names.some((name) => /^(node_modules|tools|tests|packs-src|dist|\.git|\.github)\//.test(name)));
    assert.ok(!names.some((name) => /\/(LOCK|LOG|LOG\.old)$/.test(name)));
    assert.equal(source.packs.length, 11);
    for (const pack of source.packs) {
      const current = `${pack.path}/CURRENT`;
      assert.ok(files[current], current);
      const manifestName = strFromU8(files[current]).trim();
      assert.ok(files[`${pack.path}/${manifestName}`], manifestName);
      assert.ok(
        names.some((name) => name.startsWith(`${pack.path}/`) && /\.(ldb|log)$/.test(name)),
        pack.path
      );
    }
    const sums = fs.readFileSync(path.join(out, "SHA256SUMS.txt"), "utf8");
    for (const name of ["module.json", "module.zip"]) {
      const hash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(out, name)))
        .digest("hex");
      assert.ok(sums.includes(`${hash}  ${name}`));
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("Russian Success headings survive hazard ability enrichment", () => {
  const html = hazardAbilityHTML("Успех: Корабль избегает повреждений. Провал: Корабль получает урон.");
  assert.match(html, /<strong>Success<\/strong> Корабль избегает повреждений/);
  assert.match(html, /<strong>Failure<\/strong> Корабль получает урон/);
  assert.ok(!html.includes("\uFFFD"));
});

test("repository uses portable build commands and excludes generated data from Git", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, source.version);
  assert.match(pkg.scripts["build:release"], /node tools\/build-release\.mjs/);
  assert.ok(!pkg.scripts["build:release"].includes("bash"));
  const ignored = read(".gitignore").split(/\r?\n/);
  for (const name of ["node_modules/", "packs/", "packs-src/", "dist/", ".work/"]) assert.ok(ignored.includes(name));
  assert.ok(read(".github/workflows/release.yml").includes("github.event.release.tag_name"));
  assert.ok(!read("tools/content-pipeline/paths.py").includes("/data/"));
});
