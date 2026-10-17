/** Build GitHub release assets using only Node and development dependencies; no Bash or system zip required. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_PATHS = [
  "module.json",
  "README.md",
  "README.ru.md",
  "CHANGELOG.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "assets",
  "data",
  "lang",
  "packs",
  "scripts",
  "styles",
  "templates",
  "docs"
];
const SOURCE_ONLY_DOCS = new Set([
  "docs/audit-0.5.0.md",
  "docs/source-audit.md",
  "docs/data-audit.md",
  "docs/RELEASING.md",
  "docs/REPOSITORY-AUDIT.md",
  "docs/CONTRIBUTING.md"
]);
const ZIP_DATE = new Date("2025-01-01T00:00:00Z");
const posix = (p) => p.split(path.sep).join("/");
const readJSON = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));

export function releaseManifest(source, repo) {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Expected --repo OWNER/REPOSITORY.");
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(source.version)) throw new Error("module.json must have a semantic version.");
  const url = `https://github.com/${repo}`;
  return {
    ...source,
    url,
    manifest: `${url}/releases/latest/download/module.json`,
    download: `${url}/releases/download/v${source.version}/module.zip`,
    bugs: `${url}/issues`,
    changelog: `${url}/blob/main/CHANGELOG.md`
  };
}

/** Validate explicit release declarations; this does not run Foundry or certify compatibility. */
export function validateReleaseCompatibility(manifest) {
  const check = (compatibility, label) => {
    for (const field of ["minimum", "verified"]) {
      if (typeof compatibility?.[field] !== "string" || !/^\d+(?:\.\d+)*$/.test(compatibility[field]))
        throw new Error(`${label}.${field} must be an explicit version before packaging.`);
    }
  };
  check(manifest.compatibility, "compatibility");
  const system = manifest.relationships?.systems?.find((entry) => entry.id === "sf2e" && entry.type === "system");
  if (!system) throw new Error("An explicit sf2e system relationship is required.");
  check(system.compatibility, "relationships.systems.sf2e.compatibility");
}

function collect(root, relative, entries) {
  const file = path.join(root, relative);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error(`Release paths must not be symbolic links: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(file).sort()) collect(root, path.join(relative, name), entries);
  } else {
    const name = posix(relative);
    if (SOURCE_ONLY_DOCS.has(name) || /(?:^|\/)(?:__pycache__|\.DS_Store|LOCK|LOG|LOG\.old)(?:\/|$)/.test(name) || name.endsWith(".pyc"))
      return;
    entries[name] = [new Uint8Array(fs.readFileSync(file)), { mtime: ZIP_DATE }];
  }
}

export function buildRelease({
  root = PROJECT_ROOT,
  out = path.join(root, "dist"),
  repo = "Huxtuntios/sf2e-tactical-starship-combat"
} = {}) {
  const source = readJSON(root, "module.json");
  const pkg = readJSON(root, "package.json");
  const lock = readJSON(root, "package-lock.json");
  if (pkg.version !== source.version || lock.version !== source.version || lock.packages[""].version !== source.version)
    throw new Error("Manifest, package and lockfile versions must match.");
  const manifest = releaseManifest(source, repo);
  validateReleaseCompatibility(manifest);
  for (const pack of manifest.packs) {
    const packPath = path.join(root, pack.path);
    const current = path.join(packPath, "CURRENT");
    if (!fs.existsSync(current) || !fs.existsSync(path.join(packPath, fs.readFileSync(current, "utf8").trim())))
      throw new Error(`Missing compiled pack ${pack.path}; run npm run build:packs first.`);
  }
  const entries = {};
  for (const relative of RUNTIME_PATHS) collect(root, relative, entries);
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  entries["module.json"] = [strToU8(json), { mtime: ZIP_DATE }];
  // Foundry's installer expects module.json at the ZIP root, not inside an extra module directory.
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "module.json"), json);
  fs.writeFileSync(path.join(out, "module.zip"), zipSync(entries, { level: 9, mtime: ZIP_DATE }));
  const sums = ["module.json", "module.zip"]
    .map(
      (name) =>
        `${crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(out, name)))
          .digest("hex")}  ${name}`
    )
    .join("\n");
  fs.writeFileSync(path.join(out, "SHA256SUMS.txt"), `${sums}\n`);
  const notes = path.join(root, "docs", "releases", `${source.version}.md`);
  if (fs.existsSync(notes)) fs.copyFileSync(notes, path.join(out, "RELEASE-NOTES.md"));
  return { manifest, out, files: ["module.json", "module.zip", "SHA256SUMS.txt"] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { "--repo": "repo", "--out": "out" }[args[i]];
    if (!key || !args[i + 1]) throw new Error("Usage: node tools/build-release.mjs [--repo OWNER/REPOSITORY] [--out DIRECTORY]");
    options[key] = key === "out" ? path.resolve(args[i + 1]) : args[i + 1];
  }
  const result = buildRelease(options);
  console.log(`Built ${result.manifest.version}: ${result.files.map((name) => path.join(result.out, name)).join(", ")}`);
}
