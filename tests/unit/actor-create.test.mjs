import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, loadContentFromDisk } from "../helpers/foundry-mock.mjs";

async function createFromDialog(kind, level) {
  installFoundryMock();
  const content = await loadContentFromDisk();
  foundry.applications.ux = { FormDataExtended: class {} };
  foundry.applications.api.DialogV2.wait = async () => ({ kind, level, name: "Custom actor", frame: [...content.frames.keys()][0] });
  const { createStarshipDialog } = await import("../../scripts/ui/actor-create.mjs");
  return createStarshipDialog();
}

for (const kind of ["tsc-npc", "tsc-hazard"]) {
  for (const level of ["0", "-1", "1"]) {
    test(`${kind} creation preserves level ${level} from the dialog`, async () => {
      const actor = await createFromDialog(kind, level);
      assert.ok(actor);
      assert.equal(actor.system.details.level.value, Number(level));
      assert.equal(game.actors.size, 1);
    });
  }
}

test("player creation clamps level zero to the supported frame minimum", async () => {
  const actor = await createFromDialog("tsc-player", "0");
  assert.ok(actor);
  assert.equal(actor.system.details.level.value, 1);
});

for (const level of ["", undefined, "invalid"]) {
  test(`creation uses the default level for ${String(level) || "empty input"}`, async () => {
    const actor = await createFromDialog("tsc-hazard", level);
    assert.ok(actor);
    assert.equal(actor.system.details.level.value, 1);
  });
}

test("canceling creation leaves the world unchanged", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  foundry.applications.ux = { FormDataExtended: class {} };
  foundry.applications.api.DialogV2.wait = async () => null;
  const { createStarshipDialog } = await import("../../scripts/ui/actor-create.mjs");
  assert.equal(await createStarshipDialog(), null);
  assert.equal(game.actors.size, 0);
  assert.equal(globalThis.__writes.length, 0);
});
