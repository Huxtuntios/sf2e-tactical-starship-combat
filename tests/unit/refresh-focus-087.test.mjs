import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../scripts/ui/base-app.mjs", import.meta.url), "utf8");
const body = src.slice(src.indexOf("export function isEditingElement")).split("\n}\n")[0].replace("export ", "") + "\n}";
const isEditingElement = new Function(`${body}; return isEditingElement;`)();
const root = (kids) => ({ contains: (el) => kids.includes(el) });

test("window refresh waits while a dropdown or text field is focused", () => {
  const sel = { tagName: "SELECT" },
    num = { tagName: "INPUT", type: "number" },
    box = { tagName: "INPUT", type: "checkbox" },
    btn = { tagName: "BUTTON" };
  const r = root([sel, num, box, btn]);
  assert.equal(isEditingElement(r, sel), true);
  assert.equal(isEditingElement(r, num), true);
  assert.equal(isEditingElement(r, box), false);
  assert.equal(isEditingElement(r, btn), false);
  assert.equal(isEditingElement(r, { tagName: "SELECT" }), false);
  assert.equal(isEditingElement(null, sel), false);
});
