import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "../helpers/foundry-mock.mjs";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { renderStoredCard } from "../../scripts/chat/card.mjs";

const messageWith = (cardData) => ({ flags: { [MODULE_ID]: { cardData } } });

test("stored simple-card HTML is sanitized at the render boundary", () => {
  installFoundryMock();
  const payload = '<p>Safe <strong>text</strong></p><img src="x" onerror="alert(1)"><script>alert(2)</script>';
  const calls = [];
  foundry.utils.cleanHTML = (value) => {
    calls.push(value);
    return '<p>Safe <strong>text</strong></p><img src="x">';
  };

  const html = renderStoredCard(messageWith({ kind: "simple", initiator: "Ship", title: "Report", bodyHtml: payload }));

  assert.deepEqual(calls, [payload]);
  assert.match(html, /<p>Safe <strong>text<\/strong><\/p>/);
  assert.doesNotMatch(html, /onerror|script|alert\(/);
});

test("stored simple-card HTML is escaped when Foundry sanitization is unavailable", () => {
  installFoundryMock();
  delete foundry.utils.cleanHTML;
  const html = renderStoredCard(
    messageWith({ kind: "simple", initiator: "Ship", title: "Report", bodyHtml: '<img src="x" onerror="alert(1)">' })
  );

  assert.doesNotMatch(html, /<img| onerror="/);
  assert.match(html, /&lt;img/);
});

test("stored integrity cards escape DC and compromised-state values", () => {
  installFoundryMock();
  const html = renderStoredCard(
    messageWith({
      kind: "integrity",
      initiator: "Ship",
      dc: '<img src="x" onerror="alert(1)">',
      degreeLabel: "Success",
      delta: '<svg onload="alert(2)">',
      newValue: "<script>alert(3)</script>"
    })
  );
  assert.doesNotMatch(html, /<(?:img|svg|script)\b/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;svg/);
  assert.match(html, /&lt;script&gt;/);
});

test("action cards render inline damage and checks as usable controls", () => {
  installFoundryMock();
  const html = renderStoredCard(
    messageWith({
      kind: "action",
      initiator: "Ship",
      action: { id: "inline:barrage", name: "Barrage", outcomes: null },
      stationName: "Gunnery",
      manual: ["All ships take @Damage[8d6[fire]]{8d6 fire} and @Check[reflex|dc:35|basic]{basic Reflex}."]
    })
  );

  assert.match(html, /class="tsc-check tsc-damage"/);
  assert.match(html, /data-inline="@Damage\[8d6\[fire\]\]"/);
  assert.match(html, /data-check="reflex\|dc:35\|basic"/);
  assert.doesNotMatch(html, />@Damage\[|>@Check\[/);
});
