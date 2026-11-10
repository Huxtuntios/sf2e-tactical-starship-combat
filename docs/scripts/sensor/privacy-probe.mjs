/**
 * Диагностика приватности для проверки в настоящем Foundry с несколькими клиентами (dev.12).
 *
 * ВАЖНО: зонд только описывает то, что видит ТЕКУЩИЙ клиент. Он не доказывает безопасность: отсутствие находок
 * в одном запуске не означает, что данные не передавались по сети. Сетевую часть проверяют вручную в DevTools
 * (WebSocket-кадры) по MANUAL-TEST-0.17.1-dev.12-ru.md. Автоматические тесты репозитория используют имитацию
 * Foundry и подтверждением приватности НЕ являются.
 *
 * Запуск в консоли любого пользователя:
 *   game.modules.get("sf2e-tactical-starship-combat").api.privacyProbe()
 */
import { MODULE_ID, FLAGS } from "../constants.mjs";

const PROJECTION_KEYS = ["key", "zone", "type", "span", "name", "heading", "detection", "tscPrivateProjection"];

const belowLimited = (doc, user) => typeof doc.testUserPermission === "function" && !doc.testUserPermission(user, "LIMITED");
const brief = (d) => ({ id: d.id, name: d.name });

export function privacyProbe({ user = game.user, combats = game.combats?.contents ?? [] } = {}) {
  const journals = game.journal?.contents ?? [];
  const actors = game.actors?.contents ?? [];
  const findings = [];

  // 1. Документы, на которые у пользователя нет даже LIMITED, но которые находятся в памяти клиента.
  const hiddenJournals = journals.filter((j) => belowLimited(j, user));
  const hiddenActors = actors.filter((a) => belowLimited(a, user));
  if (!user.isGM && hiddenJournals.length) findings.push({ code: "journals-below-limited", count: hiddenJournals.length });
  if (!user.isGM && hiddenActors.length) findings.push({ code: "actors-below-limited", count: hiddenActors.length });

  // 2. Закрытое хранилище приватных контактов и история в клиенте не-GM.
  const stores = journals.filter((j) => j.flags?.[MODULE_ID]?.privateSensor);
  const historyStores = journals.filter((j) => j.flags?.[MODULE_ID]?.historyStore);
  if (!user.isGM && stores.length) findings.push({ code: "private-store-present", count: stores.length });
  if (!user.isGM && historyStores.length) findings.push({ code: "history-store-present", count: historyStores.length });
  const leakedContacts = stores.reduce((n, j) => n + (j.flags[MODULE_ID].privateSensor.contacts?.length ?? 0), 0);
  if (!user.isGM && leakedContacts) findings.push({ code: "private-contacts-readable", count: leakedContacts });

  // 3. Копии опасностей из компендия и иные скрытые Actor, доступные не-GM.
  const imported = actors.filter((a) => a.flags?.[MODULE_ID]?.contactImport);
  if (!user.isGM && imported.length) findings.push({ code: "imported-hazard-present", count: imported.length });

  // 4. Анонимные маркеры в Combat не должны нести ничего, кроме разрешённых полей.
  let projections = 0;
  for (const combat of combats) {
    const objects = combat.flags?.[MODULE_ID]?.[FLAGS.COMBAT]?.objects ?? [];
    for (const o of objects) {
      if (o?.tscPrivateProjection !== true) continue;
      projections++;
      const extra = Object.keys(o).filter((k) => !PROJECTION_KEYS.includes(k));
      if (extra.length || o.type !== "contact" || o.name !== "Contact" || o.detection?.party !== "observed" || o.actorUuid || o.art)
        findings.push({ code: "projection-leaks-fields", combatId: combat.id, key: o.key, extra });
    }
  }

  return {
    user: { id: user.id, name: user.name, isGM: !!user.isGM },
    counts: {
      journals: journals.length,
      journalsBelowLimited: hiddenJournals.length,
      actors: actors.length,
      actorsBelowLimited: hiddenActors.length,
      privateStores: stores.length,
      anonymousProjections: projections
    },
    belowLimited: user.isGM ? [] : { journals: hiddenJournals.map(brief), actors: hiddenActors.map(brief) },
    findings,
    // Намеренно нет значения «безопасно»: пустой список находок — это лишь отсутствие находок этого зонда.
    note: findings.length ? "FINDINGS" : "NO_FINDINGS_IN_THIS_PROBE_NOT_A_SECURITY_PROOF"
  };
}
