/** Check the built or re-downloaded release assets, not just the Git source manifest. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { validateReleaseCompatibility } from "./build-release.mjs";

export function verifyRelease(directory, expectedTag = null) {
  const manifestText = fs.readFileSync(path.join(directory, "module.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  validateReleaseCompatibility(manifest);
  if (expectedTag && expectedTag !== `v${manifest.version}`) throw new Error("Published manifest version does not match the release tag.");
  const files = unzipSync(fs.readFileSync(path.join(directory, "module.zip")));
  if (!files["module.json"] || strFromU8(files["module.json"]) !== manifestText)
    throw new Error("External and ZIP-root module.json must be identical.");
  const sums = fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8").split(/\r?\n/);
  for (const name of ["module.json", "module.zip"]) {
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(directory, name)))
      .digest("hex");
    if (!sums.includes(`${hash}  ${name}`)) throw new Error(`Checksum mismatch: ${name}`);
  }
  for (const pack of manifest.packs) if (!files[`${pack.path}/CURRENT`]) throw new Error(`Missing compiled pack: ${pack.path}`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = verifyRelease(path.resolve(process.argv[2] ?? "dist"), process.argv[3] ?? null);
  console.log(`Verified release assets: ${manifest.id} ${manifest.version}; core/system declarations, ZIP manifest and hashes match.`);
}
