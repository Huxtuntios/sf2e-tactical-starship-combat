import test from "node:test";
import assert from "node:assert/strict";
import * as migration from "../../scripts/engine/migration.mjs";
const { MIGRATIONS, migrate } = migration;
import { normalizeStarship, sanitizeShipField } from "../../scripts/engine/validation.mjs";
import { starshipFlagFromContent, buildPlayerShipData } from "../../scripts/content/ship-docs.mjs";
import { computeShipStats } from "../../scripts/starship/stats.mjs";
import { installFoundryMock, loadContentFromDisk, makeShip } from "../helpers/foundry-mock.mjs";

const MODULE_ID = "sf2e-tactical-starship-combat";
const SIZE_RANGES = { tiny: 3, small: 4, medium: 4, large: 5, huge: 6, gargantuan: 7 };
const NPC_ROLES = ["npc", "ally", "neutral", "autonomous", "living"];

async function rangeResolver() {
  try {
    return await import("../../scripts/engine/sensor-range.mjs");
  } catch (error) {
    assert.fail(`sensor-range resolver is missing: ${error.message}`);
  }
}

function migrationContext(frame = null) {
  return { frame, audit: [] };
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts.at(-1)] = structuredClone(value);
}

function migrationActor(id, dataVersion, extra = {}) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    flags: { [MODULE_ID]: { starship: { isStarship: true, dataVersion, role: "npc", size: "large", custom: { keep: true }, ...extra } } },
    writes: [],
    async update(changes) {
      this.writes.push(structuredClone(changes));
      for (const [path, value] of Object.entries(changes)) setPath(this, path, value);
      return this;
    }
  };
  return actor;
}

test("explicit valid sensor range wins over frame and size, including zero", async () => {
  const { resolveBaseSensorRange } = await rangeResolver();
  for (const value of [0, 9]) {
    assert.deepEqual(resolveBaseSensorRange({ role: "npc", size: "tiny", sensorRange: value }, { sensorRange: 5 }), {
      value,
      source: "explicit",
      warning: null
    });
  }
});

test("invalid explicit sensor range is not silently replaced", async () => {
  const { resolveBaseSensorRange } = await rangeResolver();
  const result = resolveBaseSensorRange({ role: "npc", size: "tiny", sensorRange: "9" });
  assert.equal(result.value, null);
  assert.equal(result.source, "invalid");
  assert.ok(result.warning);
});

test("missing player range uses only the verified frame", async () => {
  const { resolveBaseSensorRange } = await rangeResolver();
  assert.deepEqual(resolveBaseSensorRange({ role: "player", frame: "explorer", sensorRange: null }, { sensorRange: 5 }), {
    value: 5,
    source: "frame",
    warning: null
  });
  assert.equal(resolveBaseSensorRange({ role: "player", size: "huge", sensorRange: null }).value, null);
  assert.ok(resolveBaseSensorRange({ role: "player", size: "huge", sensorRange: null }).warning);
});

for (const role of NPC_ROLES) {
  for (const [size, expected] of Object.entries(SIZE_RANGES)) {
    test(`${role} ${size} missing range uses the official ${expected}-zone baseline`, async () => {
      const { resolveBaseSensorRange } = await rangeResolver();
      assert.deepEqual(resolveBaseSensorRange({ role, size, sensorRange: null }), {
        value: expected,
        source: `size:${size}`,
        warning: null
      });
    });
  }
}

test("missing or unique NPC size stays unresolved and warns", async () => {
  const { resolveBaseSensorRange } = await rangeResolver();
  for (const size of [undefined, null, "unique", "colossal"]) {
    const result = resolveBaseSensorRange({ role: "npc", size });
    assert.equal(result.value, null);
    assert.equal(result.source, "unresolved");
    assert.ok(result.warning);
  }
});

for (const version of [0, 1, 2, 3]) {
  test(`migration version ${version} preserves unknown fields and resolves only missing base range`, () => {
    const input = {
      dataVersion: version,
      role: "npc",
      size: "large",
      ...(version === 3 ? { sensorRange: 5 } : {}),
      unknown: { keep: [1, 2] },
      stations: version === 0 ? [{ id: "gen", type: "generator", upgrades: ["tractor-beam"] }] : []
    };
    const context = migrationContext();
    const first = migrate(input, 3, MIGRATIONS, context);
    assert.equal(first.data.dataVersion, 3);
    assert.equal(first.data.sensorRange, 5);
    assert.deepEqual(first.data.unknown, { keep: [1, 2] });
    assert.deepEqual(first.log, version < 3 ? ["0->1", "1->2", "2->3"].slice(version) : []);
    if (version < 3) {
      assert.deepEqual(context.audit, [{ from: 2, to: 3, field: "sensorRange", source: "size:large", value: 5 }]);
    }
    const second = migrate(first.data, 3, MIGRATIONS, migrationContext());
    assert.deepEqual(second.data, first.data);
    assert.deepEqual(second.log, []);
  });
}

test("migration preserves explicit base range and never stores the scanner increase", () => {
  const explicit = migrate({ dataVersion: 2, role: "npc", size: "tiny", sensorRange: 11 }, 3, MIGRATIONS, migrationContext());
  assert.equal(explicit.data.sensorRange, 11);
  assert.deepEqual(explicit.log, ["2->3"]);
  assert.equal(explicit.data.sensorIncrease, undefined);
});

test("migration uses a player frame and leaves invalid size unresolved", () => {
  const context = migrationContext({ sensorRange: 5 });
  const player = migrate({ dataVersion: 2, role: "player", frame: "explorer" }, 3, MIGRATIONS, context);
  assert.equal(player.data.sensorRange, 5);
  assert.equal(context.audit[0].source, "frame");

  const invalidContext = migrationContext();
  const invalid = migrate({ dataVersion: 2, role: "npc", size: "unique" }, 3, MIGRATIONS, invalidContext);
  assert.equal(invalid.data.sensorRange ?? null, null);
  assert.equal(invalid.data.dataVersion, 3);
  assert.equal(invalidContext.audit[0].source, "unresolved");
});

for (const [size, expected] of Object.entries(SIZE_RANGES)) {
  test(`migration stores the official ${size} base range ${expected} once`, () => {
    const context = migrationContext();
    const first = migrate({ dataVersion: 2, role: "npc", size }, 3, MIGRATIONS, context);
    assert.equal(first.data.sensorRange, expected);
    assert.equal(context.audit[0].source, `size:${size}`);
    const second = migrate(first.data, 3, MIGRATIONS, migrationContext());
    assert.equal(second.data.sensorRange, expected);
    assert.deepEqual(second.log, []);
  });
}

test("normalization derives missing base range without inventing one for unknown size", () => {
  const tiny = normalizeStarship({ role: "npc", size: "tiny", sensorRange: null });
  assert.equal(tiny.data.sensorRange, 3);
  assert.deepEqual(tiny.errors, []);

  const unique = normalizeStarship({ role: "npc", size: "unique", sensorRange: null });
  assert.equal(unique.data.sensorRange, null);
  assert.ok(unique.warnings.some((warning) => /sensorRange/.test(warning)));
  assert.deepEqual(unique.errors, []);
  assert.equal(sanitizeShipField("sensorRange", null), null);
});

test("normalization preserves missing NPC size but honors explicit medium and zero range", () => {
  const missing = normalizeStarship({ role: "npc", sensorRange: null });
  assert.equal(missing.data.size, null);
  assert.equal(missing.data.sensorRange, null);

  const medium = normalizeStarship({ role: "npc", size: "medium", sensorRange: null });
  assert.equal(medium.data.size, "medium");
  assert.equal(medium.data.sensorRange, 4);

  const zero = normalizeStarship({ role: "npc", size: "medium", sensorRange: 0 });
  assert.equal(zero.data.sensorRange, 0);
});

test("content and creation paths derive sensor range from explicit data, frame or size", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const { creationData } = await import("../../scripts/ui/actor-create.mjs");
  assert.equal(starshipFlagFromContent({ id: "npc", size: "huge", level: 1 }).sensorRange, 6);
  assert.equal(starshipFlagFromContent({ id: "npc", size: "tiny", sensorRange: 8, level: 1 }).sensorRange, 8);
  assert.equal(starshipFlagFromContent({ id: "npc", level: 1 }).sensorRange, null);
  assert.equal(creationData("tsc-npc", { size: "tiny" }).flags[MODULE_ID].starship.sensorRange, 3);
  assert.equal(creationData("tsc-npc", { size: "unique" }).flags[MODULE_ID].starship.sensorRange, null);

  const frame = {
    id: "test-frame",
    size: "medium",
    sensorRange: 5,
    table: [{ level: 1, hp: 20, sp: 10, ac: 15, fort: 8, ref: 8, will: 8, speed: 3 }]
  };
  assert.equal(buildPlayerShipData({ name: "Test", frame, level: 1 }).flags[MODULE_ID].starship.sensorRange, 5);
  assert.equal(
    buildPlayerShipData({ name: "Test", frame: { ...frame, sensorRange: undefined }, level: 1 }).flags[MODULE_ID].starship.sensorRange,
    null
  );
});

test("scanner advancement is added once to the resolved base and never creates a missing base", async () => {
  installFoundryMock();
  await loadContentFromDisk();
  const ship = makeShip({
    id: "range-ship",
    role: "npc",
    stations: [{ id: "scanner", type: "scanners", grade: "advanced" }],
    extra: { dataVersion: 2, size: "large", sensorRange: null }
  });
  assert.equal(computeShipStats(ship).sensorRange, 7);
  assert.equal(computeShipStats(ship).sensorRange, 7);
  assert.equal(ship.flags[MODULE_ID].starship.sensorRange, null);

  ship.flags[MODULE_ID].starship.sensorRange = null;
  ship.flags[MODULE_ID].starship.size = "unique";
  assert.equal(computeShipStats(ship).sensorRange, null);
});

test("world migration uses narrow paths, retries partial failure and skips completed actors", async () => {
  assert.equal(typeof migration.migrateStarships, "function");
  let worldVersion = 2;
  const first = migrationActor("first", 2);
  const second = migrationActor("second", 2);
  const options = {
    getVersion: () => worldVersion,
    setVersion: async (version) => {
      worldVersion = version;
    },
    frameFor: () => null
  };
  const originalUpdate = second.update;
  second.update = async function (changes) {
    if (this.flags[MODULE_ID].starship.dataVersion === 2) throw new Error("simulated actor failure");
    return originalUpdate.call(this, changes);
  };
  await assert.rejects(migration.migrateStarships([first, second], options), /simulated actor failure/);
  assert.equal(first.flags[MODULE_ID].starship.dataVersion, 3);
  assert.equal(first.flags[MODULE_ID].starship.sensorRange, 5);
  assert.deepEqual(first.flags[MODULE_ID].starship.custom, { keep: true });
  assert.deepEqual(Object.keys(first.writes[0]).sort(), [
    `flags.${MODULE_ID}.starship.dataVersion`,
    `flags.${MODULE_ID}.starship.sensorRange`
  ]);
  assert.equal(second.flags[MODULE_ID].starship.dataVersion, 2);
  assert.equal(worldVersion, 2);

  second.update = originalUpdate;
  const report = await migration.migrateStarships([first, second], options);
  assert.equal(report.migrated, 1);
  assert.equal(report.unchanged, 1);
  assert.equal(report.entries[0].source, "size:large");
  assert.equal(first.writes.length, 1);
  assert.equal(second.flags[MODULE_ID].starship.sensorRange, 5);
  assert.equal(worldVersion, 3);

  const writes = second.writes.length;
  const repeat = await migration.migrateStarships([first, second], options);
  assert.equal(repeat.migrated, 0);
  assert.equal(repeat.unchanged, 2);
  assert.equal(second.writes.length, writes);
});

test("a version-three world still repairs a newly added older actor without rewriting current actors", async () => {
  assert.equal(typeof migration.migrateStarships, "function");
  let worldVersion = 3;
  let settingWrites = 0;
  const current = migrationActor("current", 3, { sensorRange: 12 });
  const added = migrationActor("added", 2, { size: "tiny" });
  const report = await migration.migrateStarships([current, added], {
    getVersion: () => worldVersion,
    setVersion: async () => {
      settingWrites++;
    },
    frameFor: () => null
  });
  assert.equal(report.migrated, 1);
  assert.equal(report.unchanged, 1);
  assert.equal(current.writes.length, 0);
  assert.equal(added.flags[MODULE_ID].starship.sensorRange, 3);
  assert.equal(settingWrites, 0);
});
