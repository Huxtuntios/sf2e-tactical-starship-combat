/**
 * Склад мин внутри Pyrotechnics Drone (dev.12). Чистая логика без Foundry.
 *
 * Источник правил — Tech Core, Mine Deployment Shell (с. 184): «Install Mine: вы Модифицируете до четырёх
 * звёздных мин в пиротехническом дроне так, будто это мины вашего минного экзокортекса. Требование: консоль
 * управляет пиротехническим дроном, который ещё не развёрнут». Deploy Starship Mine (с. 192–193) — отдельное
 * действие, которое выполняется развёрнутым дроном.
 *
 * Сознательные решения (см. docs/rules-decisions.md):
 * - В складе учитываются только подготовленные (модифицированные при Install Mine) мины. Число обычных мин
 *   в дроне в имеющемся тексте правил не задано, поэтому оно не выдумывается: обычное развёртывание без выбора
 *   подготовленной мины работает как в dev.11.
 * - Личные модификации минного экзокортекса — непрозрачные подтверждённые ведущим записи. Они не приравниваются
 *   к Smart/Targeting (с. 193) и не создают эффектов; записи хранятся вместе с конкретной миной.
 * - Все поля необязательные, старые данные не мигрируются и не перезаписываются.
 */
export const MAX_INSTALL_PER_ACTION = 4;
/** Технический предел размера складa, а не правило игры: защита от неограниченного роста флагов. */
export const MAX_STORED_MINES = 32;
export const MAX_KNOWN_MODS = 24;
export const MAX_RECEIPTS = 512;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const OP_RE = /^install-[a-zA-Z0-9]{8,40}$/;

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clean = (v, max) => (typeof v === "string" ? v.trim() : "").slice(0, max + 1);
/** Идентификатор хранимой мины; без глобалов Foundry. */
const newId = () => globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 8);
const same = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Единственная консоль, единственная Mine Deployment Shell на ней, один неразвёрнутый пиротехнический дрон. */
export function installContext(data, { stationId, droneId, operatorUuid }) {
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  const drones = (Array.isArray(data.drones) ? data.drones : []).filter((d) => d?.id === droneId);
  if (
    stations.length !== 1 ||
    stations[0].type !== "drone-console" ||
    !operatorUuid ||
    stations[0].helmedBy !== operatorUuid ||
    stations[0].malfunctioning ||
    data.destroyed ||
    drones.length !== 1 ||
    drones[0].tscVersion !== 1 ||
    drones[0].stationId !== stationId ||
    drones[0].ref !== "pyrotechnics-drone" ||
    drones[0].deployed !== false ||
    (data.upgrades ?? []).filter((u) => u?.ref === "mine-deployment-shell" && u.stationId === stationId).length !== 1
  )
    throw new Error("invalid");
  return { station: stations[0], drone: drones[0] };
}

/** Склад дрона; повреждённая запись — ошибка, а не повод молча исправлять данные. */
export function readStock(drone) {
  if (drone.mineStock == null) return [];
  if (!Array.isArray(drone.mineStock)) throw new Error("legacy");
  for (const m of drone.mineStock) {
    if (
      !isObj(m) ||
      !ID_RE.test(m.id ?? "") ||
      typeof m.label !== "string" ||
      !m.label ||
      m.status !== "stored" ||
      (m.installed != null && (!isObj(m.installed) || !Array.isArray(m.installed.mods)))
    )
      throw new Error("legacy");
  }
  if (new Set(drone.mineStock.map((m) => m.id)).size !== drone.mineStock.length) throw new Error("legacy");
  return drone.mineStock;
}

/** Идентификатор мины обязан быть уникальным во всём корабле: и среди развёрнутых, и среди хранимых. */
export function allMineIds(data) {
  const drones = Array.isArray(data.drones) ? data.drones : [];
  return drones.flatMap((d) => [
    ...(Array.isArray(d?.mines) ? d.mines : []).map((m) => m?.id),
    ...(Array.isArray(d?.mineStock) ? d.mineStock : []).map((m) => m?.id)
  ]);
}

/** Известные модификации оператора; хранятся на консоли и подтверждены ведущим. */
export function knownMods(station, operatorUuid) {
  const list = station.tscKnownMineMods;
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("legacy");
  for (const m of list) {
    if (!isObj(m) || !ID_RE.test(m.id ?? "") || typeof m.operatorUuid !== "string" || typeof m.label !== "string" || !m.label)
      throw new Error("legacy");
  }
  if (new Set(list.map((m) => m.id)).size !== list.length) throw new Error("legacy");
  return list.filter((m) => m.operatorUuid === operatorUuid);
}

/** GM подтверждает, что оператор действительно знает такую модификацию минного экзокортекса. */
export function changeKnownMod(data, { stationId, operatorUuid, op, modId, label, confirmed }) {
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  if (stations.length !== 1 || stations[0].type !== "drone-console" || !operatorUuid || stations[0].helmedBy !== operatorUuid)
    throw new Error("invalid");
  const station = stations[0];
  const all = Array.isArray(station.tscKnownMineMods) ? station.tscKnownMineMods : station.tscKnownMineMods == null ? [] : null;
  if (!all) throw new Error("legacy");
  knownMods(station, operatorUuid); // проверка формата всех записей
  if (op === "add") {
    const text = clean(label, 80);
    if (confirmed !== true || !text || text.length > 80 || !ID_RE.test(modId ?? "")) throw new Error("invalid");
    const mine = all.filter((m) => m.operatorUuid === operatorUuid);
    if (all.some((m) => m.id === modId)) {
      const old = all.find((m) => m.id === modId);
      if (old.operatorUuid === operatorUuid && same(old.label, text)) return false; // повтор запроса
      throw new Error("invalid");
    }
    if (mine.some((m) => same(m.label, text)) || mine.length >= MAX_KNOWN_MODS) throw new Error("invalid");
    station.tscKnownMineMods = [...all, { id: modId, operatorUuid, label: text, confirmed: true }];
    return true;
  }
  if (op === "remove") {
    const row = all.find((m) => m.id === modId && m.operatorUuid === operatorUuid);
    if (!row) return false;
    // Уже установленные на мины записи сохраняют собственную копию названия и не меняются.
    station.tscKnownMineMods = all.filter((m) => m !== row);
    return true;
  }
  throw new Error("invalid");
}

/**
 * Install Mine: до четырёх мин в неразвёрнутом дроне получают подтверждённые модификации.
 * entries: [{ stockId } | { label }, modId] — существующая подготовленная мина либо новая запись.
 * operatorClass: "mechanic" | "other" | "unknown" (определяется вызывающим кодом по классу оператора).
 */
export function installMines(
  data,
  { stationId, droneId, operatorUuid, entries, operationId, confirmed, operatorClass = "unknown", gmOverride = false, now = null }
) {
  if (
    confirmed !== true ||
    !OP_RE.test(operationId ?? "") ||
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > MAX_INSTALL_PER_ACTION
  )
    throw new Error("invalid");
  // Улучшение Mine Deployment Shell предназначено для механика. Класс проверяется только когда его удалось определить.
  if (operatorClass === "other" && gmOverride !== true) throw new Error("class");
  const { station, drone } = installContext(data, { stationId, droneId, operatorUuid });
  const known = knownMods(station, operatorUuid);
  const stock = readStock(drone);
  const rows = entries.map((e) => {
    if (!isObj(e) || !ID_RE.test(e.modId ?? "")) throw new Error("invalid");
    const mod = known.find((m) => m.id === e.modId);
    if (!mod) throw new Error("mod");
    const hasStock = typeof e.stockId === "string" && e.stockId.length > 0;
    const label = hasStock ? "" : clean(e.label, 80);
    if (hasStock === !!label) throw new Error("invalid"); // ровно одно из двух
    if (!hasStock && (!label || label.length > 80)) throw new Error("invalid");
    return { stockId: hasStock ? e.stockId : null, label, mod: { id: mod.id, label: mod.label } };
  });
  const fingerprint = JSON.stringify({ stationId, droneId, operatorUuid, rows });
  const receipts = drone.tscMineStockReceipts ?? {};
  if (!isObj(receipts) || Object.values(receipts).some((v) => typeof v !== "string")) throw new Error("legacy");
  if (Object.hasOwn(receipts, operationId)) {
    if (receipts[operationId] !== fingerprint) throw new Error("invalid");
    return false;
  }
  if (Object.keys(receipts).length >= MAX_RECEIPTS) throw new Error("receipts");
  // Одна и та же мина не получает две модификации за одно действие.
  const ids = rows.filter((r) => r.stockId).map((r) => r.stockId);
  const labels = rows.filter((r) => r.label).map((r) => r.label.toLocaleLowerCase());
  if (new Set(ids).size !== ids.length || new Set(labels).size !== labels.length) throw new Error("invalid");
  const next = stock.map((m) => ({ ...m }));
  const used = new Set([...allMineIds(data)]);
  for (const row of rows) {
    const installed = { operationId, operatorUuid, stationId, mods: [{ ...row.mod }], at: Number.isFinite(now) ? now : null };
    if (row.stockId) {
      const m = next.find((x) => x.id === row.stockId);
      if (!m) throw new Error("stock");
      if (m.installed != null) throw new Error("modified"); // повторная Модификация мины правилами не описана
      m.installed = installed;
    } else {
      if (next.some((m) => same(m.label, row.label)) || next.length >= MAX_STORED_MINES) throw new Error("invalid");
      let id;
      do id = `mine-${newId()}`;
      while (used.has(id));
      used.add(id);
      next.push({ id, label: row.label, status: "stored", installed });
    }
  }
  drone.mineStock = next;
  drone.tscMineStockReceipts = { ...receipts, [operationId]: fingerprint };
  return true;
}

/** GM снимает подготовленную мину со склада (ошибка ввода, утрата). Развёрнутые мины не затрагиваются. */
export function discardStoredMine(data, { stationId, droneId, stockId, operatorUuid = null }) {
  const stations = (data.stations ?? []).filter((s) => s?.id === stationId);
  const drones = (Array.isArray(data.drones) ? data.drones : []).filter((d) => d?.id === droneId);
  if (stations.length !== 1 || stations[0].type !== "drone-console" || drones.length !== 1 || drones[0].stationId !== stationId)
    throw new Error("invalid");
  if (operatorUuid && stations[0].helmedBy !== operatorUuid) throw new Error("invalid");
  const stock = readStock(drones[0]);
  if (!stock.some((m) => m.id === stockId)) return false;
  drones[0].mineStock = stock.filter((m) => m.id !== stockId);
  return true;
}

/**
 * Снимает подготовленную мину со склада для развёртывания. Возвращает запись либо null, если stockId не задан.
 * Повтор уже развёрнутой мины определяется вызывающей функцией по drone.mines.
 */
export function takeStoredMine(drone, stockId) {
  if (!stockId) return null;
  const stock = readStock(drone);
  const found = stock.find((m) => m.id === stockId);
  if (!found) throw new Error("stock");
  drone.mineStock = stock.filter((m) => m.id !== stockId);
  return found;
}

/** Краткая сводка для листа корабля. */
export function stockSummary(drone) {
  const stock = Array.isArray(drone?.mineStock) ? drone.mineStock : [];
  return {
    count: stock.length,
    modified: stock.filter((m) => m?.installed?.mods?.length).length,
    rows: stock.map((m) => ({
      id: m.id,
      label: m.label,
      mods: (m.installed?.mods ?? []).map((x) => x.label)
    }))
  };
}

/**
 * Mine Deployment Shell предназначена для механика. Класс определяется только по предмету класса персонажа;
 * для остальных документов результат "unknown", и подтверждение остаётся за ведущим.
 */
export function operatorClassStatus(actor) {
  const slug = actor?.class?.slug ?? actor?.system?.details?.class?.slug ?? null;
  if (typeof slug !== "string" || !slug) return "unknown";
  return slug === "mechanic" ? "mechanic" : "other";
}
