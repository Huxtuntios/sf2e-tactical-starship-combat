import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRelease, PROJECT_ROOT, validateReleaseCompatibility } from "../../tools/build-release.mjs";
import { verifyRelease } from "../../tools/verify-release.mjs";
const source = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "module.json"), "utf8"));

test("release declarations cover Foundry v14 and the actual sf2e system, not PF2e or Foundry v13", () => {
  validateReleaseCompatibility(source);
  assert.equal(source.compatibility.minimum, "14.361");
  assert.equal(source.compatibility.maximum, "14");
  assert.ok(source.compatibility.verified);
  assert.deepEqual(
    source.relationships.systems.map((system) => system.id),
    ["sf2e"]
  );
  assert.equal(source.relationships.systems[0].compatibility.minimum, "1.6.0");
  assert.ok(source.relationships.systems[0].compatibility.verified);
});

test("packaging rejects missing core or system compatibility declarations", () => {
  for (const target of ["core", "system"]) {
    const manifest = structuredClone(source);
    delete (target === "core" ? manifest.compatibility : manifest.relationships.systems[0].compatibility).verified;
    assert.throws(() => validateReleaseCompatibility(manifest), /verified must be an explicit version/);
  }
  const wrongSystem = structuredClone(source);
  wrongSystem.relationships.systems[0].id = "pf2e";
  assert.throws(() => validateReleaseCompatibility(wrongSystem), /sf2e system relationship/);
});

test("release-asset verification checks both real manifests and refuses stale published metadata", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-integrity-"));
  try {
    buildRelease({ out });
    assert.equal(verifyRelease(out, `v${source.version}`).version, source.version);
    assert.throws(() => verifyRelease(out, "v0.0.0"), /release tag/);
    const changed = JSON.parse(fs.readFileSync(path.join(out, "module.json"), "utf8"));
    changed.compatibility.verified = "14.367";
    fs.writeFileSync(path.join(out, "module.json"), JSON.stringify(changed));
    assert.throws(() => verifyRelease(out), /must be identical/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("release workflow verifies the uploaded assets instead of assuming a source edit updates the release", () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, ".github/workflows/release.yml"), "utf8");
  assert.ok(workflow.includes("gh release download"));
  assert.ok(workflow.includes("tools/verify-release.mjs dist/published"));
});
