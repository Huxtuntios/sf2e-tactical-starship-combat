#!/usr/bin/env node
/**
 * Builds lang/content/<lang>.json from tools/i18n/<lang>/*.json (masked English → translation).
 *   node tools/i18n/build-content-i18n.mjs [lang] [--report]
 * Prints coverage of the shipped data; strings whose translation keeps a stray ⟦n⟧ or loses one are rejected.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, collectStrings, maskChecks, unmask } from "./content-strings.mjs";

const lang = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "ru";
const dir = path.join(ROOT, "tools", "i18n", lang);
const src = {};
for (const f of fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort())
  Object.assign(src, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

const strings = collectStrings();
const out = {};
const missing = [];
const errors = [];
for (const [en, kinds] of strings) {
  const { masked, checks } = maskChecks(en);
  const tr = src[masked] ?? src[en];
  if (!tr) {
    missing.push({ en, kinds: [...kinds] });
    continue;
  }
  const want = (masked.match(/⟦\d+⟧/g) ?? []).sort().join();
  const got = (tr.match(/⟦\d+⟧/g) ?? []).sort().join();
  if (want !== got) {
    errors.push(`check placeholders differ: ${masked.slice(0, 80)}`);
    continue;
  }
  out[en] = unmask(tr, checks);
}
// extra entries (labels written by code, e.g. default station names) are kept as they are
for (const [k, v] of Object.entries(src)) if (!(k in out) && !/⟦\d+⟧/.test(k) && !strings.has(k)) out[k] = v;
fs.mkdirSync(path.join(ROOT, "lang", "content"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "lang", "content", `${lang}.json`),
  JSON.stringify({ lang, generated: "tools/i18n/build-content-i18n.mjs", strings: out }, null, 1) + "\n"
);
const byKind = {};
for (const m of missing) for (const k of m.kinds) byKind[k] = (byKind[k] ?? 0) + 1;
console.log(
  `content i18n ${lang}: ${Object.keys(out).length}/${strings.size} strings translated; missing by kind ${JSON.stringify(byKind)}; errors ${errors.length}`
);
for (const e of errors) console.log("  ", e);
if (process.argv.includes("--report")) for (const m of missing) console.log(`  [${m.kinds.join(",")}] ${m.en.slice(0, 120)}`);
