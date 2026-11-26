# Итог реконструкции SF2e Tactical Starship Combat

> Ветка: `rewrite/native-first-rebuild`
>
> Исходный коммит: `fa3bb679ae908c08ce85483a76aa1726b976a3e3`
>
> Версия модуля в сборке: `1.5.0` (интегрированная сборка)
>
> Историческая база реконструкции: `1.3.1`; итоговые метрики и live-матрица относятся к интегрированной сборке `1.5.0`, исторические решения помечены отдельно
>
> Дата плана: 2026-11-25
>
> Локальная release-проверка: 2026-11-26

Исторические решения и доказательства реконструкции сохранены ниже. Полная интеграция unified effects и persistent damage в `1.5.0` описана в разделе 8; GM live-проверка интеграции выполнена, post-1.5.0 backlog остаётся обязательным перед PR.

## 1. Что сделано

### Архитектура и данные

- Переведён на native-first подход: Actor, Item, Combat, Combatant, ChatMessage, Roll, ActiveEffect, permissions, targets и ApplicationV2 используются там, где их контракты подходят.
- Сохранены module ID, флаги, настройки, Actor/Item types, pack IDs, UUID, публичные API, hooks и socket event.
- Добавлен additive `DATA_VERSION=3`: отсутствующая базовая дальность сенсоров заполняется из подтверждённого frame/size источника; неизвестные размеры остаются `null` с предупреждением.
- Не добавлены runtime-зависимости. Dev-зависимости не менялись.

### Бой, экипаж и станции

- Добавлена настройка `resetStationsOnInitiative`, по умолчанию `false`.
- При включении сбрасывается только занятость станций на реальном старте инициативы; экипаж, оружие, улучшения, эффекты и остальные данные боя сохраняются.
- Сохранён и усилен guard операторского weapon proficiency и отказ без доступного гуннера.
- При добавлении второй и последующих станций того же типа к имени добавляется номер: `Gunnery 2`, `Gunnery 3` и т. п. Коллизии имён учитываются без учёта регистра.
- Существующие станции не переименовываются и не миграционно не переписываются.

### Звездолёты и интерфейс

- В NPC-лист добавлен Fortify из существующего `starship.fortify`; альтернативный расчёт не создавался.
- Листы звездолётов и Sensor Map стали компактнее за счёт scoped CSS, intrinsic grid/flex, container queries и реальных scroll regions.
- Station dock в Sensor Map: высота строки действия 26 px; dock 1100 px уменьшен с 170.4 до 132.4 (RU 210.4→132.4), 600 px с 233.4 до 167.4, 380 px с 155.4 до 128.4 (RU 170.4→143.4).
- В detail panel HP/SP больше не повторяются строками при доступных editable vitals; read-only представление сохранено.
- Редактор иммунитетов, сопротивлений, слабостей и навыков переведён с CSV/KV строк на native-like chips/select и type/value rows; схема числовых карт и `parseKv/formatKv` сохранены.
- `exceptions/doubleVs` не добавлялись как неработающие контролы: текущая схема их не хранит.
- Шрифты и читаемость не уменьшались глобально; все контролы сохранены.
- Fortify, станции, сенсорная карта и длинные RU-строки проверены Chromium-фикстурами и live GM-клиентом.

### Сенсоры

- Базовая дальность берётся из explicit statblock, затем player frame, затем официальный NPC size baseline.
- Scanner increase применяется один раз как производное значение и не сохраняется отдельно.
- Официальные правила подтвердили: Sensor Map видна GM и игрокам, Seek работает внутри дальности, Gunnery может атаковать за её пределами.
- Поэтому дальность не используется как blanket invisibility. Detection state по-прежнему управляет скрытием контактов.
- Для игроков добавлены отдельные контуры дальности и мягкое размытие вне единственной доступной дальности; несколько кораблей не объединяются в общий blur.
- GM всегда видит полную карту без ограничений и размытия.
- Скрытые данные не добавляются в range overlay.
- Повторный directory drop создаёт новую запись карты с уникальным `key` и тем же `actorUuid`; Actors Directory не растёт, drag перемещает только выбранную запись.

### Таргетинг

- Используются Foundry `game.user.targets` и `Token#setTarget`.
- Добавлен приоритетный module `KeyT` для объектов Sensor Map под курсором; вне карты работает core binding. `Shift` добавляет несколько целей.
- Добавлен явный crosshair marker и `aria-pressed`; обычное выделение объекта отличается от выбора цели.
- Опасности разрешены как цели; их HP, AC и saves берутся из native Actor system, звёздные флаги не пишутся.
- Sensor Map синхронизируется с Canvas/Tracker для реальных Token; map-only контакты остаются ephemeral и не создают фиктивные токены.
- Добавлен `targetUUIDs`; legacy `targetKey` сохранён.
- Цели дедуплицируются, удалённые/недоступные цели отбрасываются, права и detection перепроверяются.
- Окна и rerender не сбрасывают выбранные цели.

### Действия и мягкая автоматизация

- Добавлен общий formatter текстового результата для станций и аналогичных действий.
- Исходное описание действия и результат выполнения хранятся раздельно; source text не перезаписывается.
- Из HUD, списков, Sensor Map dock и options dialog можно отправить описание в чат без броска, записи документов и расхода ресурсов.
- HTML и plain-text описания проходят один inline-enrichment pipeline: numeric checks, damage, conditions и contextual DC становятся native links, HTML-структура сохраняется.
- Значимые изменения требуют confirm/edit/cancel; безопасные технические операции остаются автоматическими.
- Warn/strict поведение сохранено.

### Карточки и Toolbelt

- Карточки модуля приведены к общему `pf2e chat-card` shell с компактным содержимым.
- Target Helper используется только при активном Toolbelt, доступном API и включённых настройках.
- Native SF2e/Toolbelt damage buttons перехватываются только на поддерживаемых guarded routes и проходят через starship damage engine ровно один раз; остальной урон по кораблю следует направлять через диалог урона модуля.
- Обычные персонажи сохраняют нативный урон.
- Better Chat merge/inject/split для starship receipts отклоняются.
- Нет дублирующих damage buttons/card paths; сохранён узкий guarded undo.
- `manualReflexDC` использует общую таблицу КС по уровню корабля; manual DC имеет приоритет. Легитимные target-save DC не изменены.
- Карточки действий показывают четыре раздела степеней успеха из реальных `action.outcomes`; plasma basic-save легенда появляется только для resolved карточек с проверенными save metadata.

### Plasma-оружие

- Plasma определяется из реальных полей `group/type/id/weaponRef/name/traits`, а не только по имени каталога.
- Форма атаки описывается из `area`/`volley`/`kind`: single, line, burst, cone, emanation, volley.
- Для area/explicit save показываются отдельные Toolbelt-подобные кнопки `Урон` и `Спасбросок`.
- Area использует базовый Reflex save; explicit save type/DC поддерживается.
- Не-area plasma без явного save metadata получает только Damage — спаса не выдумывается.
- Plasma sheet attack принимает несколько целей, делает один damage roll, затем save на каждую цель и применяет save-adjusted typed damage.
- Per-target receipts, dedupe, stale/deleted targets, permissions, detection, reroll и partial retry защищены.

### Состояния и условия

- Восстановлен минимальный native-first GM-only менеджер состояний/эффектов без history UI.
- Добавлены действия «исправен» и «уничтожен»: operational очищает только operational damage flags, destroyed не удаляет Actor и не меняет vitals.
- Стандартные условия добавляются/удаляются через native SF2e Condition Manager; valued conditions сохраняют значение.
- Нативные condition modifiers подключаются к starship Statistic через проверенные ability-based домены без двойного учёта.

### Опциональные интеграции

- HoloDock 1.0.1: оставлен только реальный zero-argument `open()`; неподдерживаемые `openDashboard/openProfile/openShip` удалены.
- Aztec Engines of War 1.0.3: siege flag учитывается только для `vehicle`.
- PF2e + Anachronism: учитывается минимальная версия PF2e, объявленная активным Anachronism.
- Workbench 7.7.5 и Causodes 2.5.3/1.5.2: код не менялся; текущее поведение подтверждено characterization-тестами.

## 2. Решения, принятые без дополнительного согласования

> Этот раздел фиксирует состояние базовой реконструкции `1.3.1`. Пункт 6 исторический: в `1.5.0` подсистема v1.4.0 интегрирована полностью, а не ограничена минимальным менеджером.

1. Пункт `8.1` считается уже исправленным и не переписывался.
2. Дальность сенсоров не считается официальным правилом невидимости; range-only hiding не добавлялся.
3. GM не ограничивается дальностью сенсоров.
4. Для отсутствующей дальности NPC используется официальный size baseline, а не значения `4/6` по умолчанию.
5. Общий Undo и автоматический MAP/action budget не восстанавливались — это намеренные удаления предыдущих версий.
6. Ветка v1.4 effects не переносилась целиком; восстановлен только минимальный менеджер без history UI и с native Condition Manager.
7. Нумерация дублирующихся станций сделана как `Базовое имя 2`, `Базовое имя 3`.
8. Для не-area plasma без save metadata спаса не создавалось.
9. Пользовательские правки proficiency сохранены; тест был только отформатирован Prettier без изменения смысла.
10. Code Simplifier skill в этой сессии был недоступен; вместо него выполнен ручной review новых helper/card файлов.
11. Пользователь разрешил live deploy/reload/restart и операции в мире; live-проверки выполнялись в `sekrety-roya`, финальный модуль развёрнут после остановки сервера с резервной копией `sf2e-tactical-starship-combat.bak-20261125-145113`.
12. Коммит, push, merge, tag, release publication не выполнялись.
13. Английская `T` для Sensor Map реализована отдельным приоритетным binding с fallback к core, а не глобальной подменой клавиши.
14. Опасности сделаны допустимыми целями с native HP/AC/saves; прямые атаки, Area Fire и plasma saves покрыты тестами.
15. Повторный drop по последнему уточнению пользователя создаёт новый map record с тем же `actorUuid`, без копии Actor.
16. `manualReflexDC` переведён на `levelDC`: live level-10 attacker теперь должен дать 27, а не 10.
17. HTML-описания действий enriching выполняется один раз; существующие enrichers защищены `TOKEN_RE`.
18. Station dock и detail panel сделаны компактнее измеряемо; HP/SP не дублируются в editable detail.
19. Менеджер состояний восстановлен без history UI; operational/destroyed и native conditions используют существующие document/Statistic контракты.
20. Карточки степеней успеха рендерятся из реальных outcome/save данных; cancelled/dry-run/failed и неподтверждённые save metadata не показывают легенду.
21. Native-like редактор корабля использует публичные SF2e каталоги и сохраняет числовую схему; неподдерживаемые `exceptions/doubleVs` не выводятся как фиктивные поля.
22. Plasma-кнопки `Урон` и `Спасбросок` проверяются до применения урона; после `damageApplied=true` они намеренно скрываются, чтобы исключить повторное применение.
23. Финальный live-набор создавался с префиксом `TSC-LIVE-R3u38T`; после проверок удалены только принадлежащие тесту Actors, Combat, Scene, ChatMessage и макросы, включая оставшиеся сообщения старого `TSC-LIVE-v4gBCG`.
24. Для чистой проверки manifest выполнен разрешённый перезапуск Foundry с резервной копией установленного модуля; после старта загружена версия `1.3.1`, console errors/warnings — 0.

## 3. Фактические метрики

| Показатель                          |        Исходно |   Итог |       Изменение |
| ----------------------------------- | -------------: | -----: | --------------: |
| JS/MJS/CSS/HBS, всё рабочее дерево  |         58,230 | 78,870 |         +20,640 |
| Runtime `scripts/styles/templates`  |         29,316 | 35,939 | +6,623 (+22.6%) |
| Runtime dependencies                |              0 |      0 |               0 |
| Dev dependencies                    |              9 |      9 |               0 |
| Unit/integration/architecture tests | 1,490 baseline |  2,016 |            +526 |
| Chromium UI fixtures                |    63 baseline |    100 |             +37 |

Сырой объём runtime-кода вырос примерно на 22.6%, потому что добавлены требуемые функции, интеграция v1.4.0, map-only identity, post-1.5.0 UI и privacy/concurrency guards. При этом устранено дублирование targeting/card/damage/sensor-default логики и увеличено использование нативных Foundry/SF2e/Toolbelt контрактов. Сокращение общего числа строк не заявляется.

## 4. Проверки

- `TSC_SYSTEMS_PATH="C:/Program Files/FoundryVTT-WindowsPortable-14/Data/systems" npm run check` — **1943 passed, 0 failed, 0 skipped**.
- `npm run test:ui` — **100/100**.
- `npm run lint` — чисто; `npm run validate` — 0 errors/warnings.
- `npm run build:release` и `node tools/verify-release.mjs dist v1.5.0` — успешно; ZIP, manifest, hashes и packs проверены.
- `git diff --check` — чисто.
- Merge `origin/main` ec57d50 выполнен commit `55e441d`; после merge сохранены v1.4.0 и native-first поведения.
- Live environment: Foundry `14.370`, SF2e `1.7.1`, world `sekrety-roya`, GM `Gamemaster2`, module `1.5.0`, Toolbelt `3.62.0`.
- Финальная live-матрица `1.5.0` — **24/24**: manual ship/crew/scoped effects, replay/conflict, persistent strongest/multi-type/apply-once/recovery, hazard target, Sensor Map range split, native multi-target, plasma controls/one-roll/two-saves/damage/replay, inline HTML, destroyed/operational и card outcomes.
- Post-1.5.0 live: T-045 **4/4**, T-046 **4/4**, T-047 **7/7**, T-048 **5/5**, T-049 **2/2**, T-050 **6/6**, T-051 **1/1**.
- Cleanup: owned Actors, Combat, Scene, ChatMessages, private journals и макросы удалены; ID-массивы восстановлены, остались 3 исходных пользовательских макроса.
- Чистый reload после cleanup: module `1.5.0`, API/KeyT загружены, console errors/warnings — **0**, тестовых артефактов — **0**.

Исторические live-результаты реконструкции `1.3.1` сохранены в `dist/live-verification/final-live-results.json` и `plasma-regression-results.json`. Не проверено в реальном Foundry: отдельный подключённый player-client и multi-client синхронизация, PF2e + Anachronism gameplay, live Workbench/HoloDock/Causodes/Toolbelt взаимодействие. GM-проверки не заменяют двухклиентский privacy/gameplay прогон.

## 5. Скриншоты и размеры

В bundle включены 11 live-снимков GM-клиента Foundry и 7 локальных Chromium-фикстур. Live-снимки различаются явно в `manifest.json` и не выдаются за mocked fixtures.

### Live Foundry 14.370 / SF2e 1.7.1

| Файл                            |   Размер |   Байты |
| ------------------------------- | -------: | ------: |
| `live-sensor-map-targets.png`   | 1920×889 | 211,339 |
| `live-vitals-dedupe.png`        | 1920×889 | 212,228 |
| `live-effect-manager.png`       | 1920×889 | 129,171 |
| `live-defense-editor.png`       | 1920×889 | 184,606 |
| `live-outcome-card.png`         | 1920×889 | 373,581 |
| `live-plasma-controls.png`      | 1920×889 | 233,753 |
| `v1.5.0-effect-manager.png`     | 1920×889 | 302,827 |
| `v1.5.0-effect-targets.png`     | 1920×889 | 289,526 |
| `v1.5.0-sensor-map.png`         | 1920×889 | 288,131 |
| `v1.5.0-persistent-receipt.png` | 1920×889 | 326,461 |
| `v1.5.0-plasma-card.png`        | 1920×889 | 329,127 |

### Chromium fixtures

| Файл                                           |  Размер |  Байты |
| ---------------------------------------------- | ------: | -----: |
| `compact-ui__sheet-npc-overview-ru-380.png`    | 380×950 | 41,053 |
| `compact-ui__sheet-player-stations-ru-600.png` | 600×950 | 63,684 |
| `compact-ui__sensor-gm-ru-380.png`             | 380×950 | 33,166 |
| `compact-ui__sensor-player-ru-380.png`         | 380×950 | 34,209 |
| `plasma-attack__plasma-attack-en.png`          | 1084×72 |  3,585 |
| `plasma-attack__plasma-attack-ru.png`          | 1084×72 |  3,659 |
| `action-controls__action-controls-ru-dark.png` | 320×670 | 27,366 |

Дополнительно сохранены `compactness-before.json`, `compactness-after.json`, `compactness-station-before-after.json`, `vitals-dedupe.json` и документные результаты live-проверки `1.5.0`. Архив `dist/ui-screenshots.zip` — **2,913,243 bytes**, SHA-256 `df6cbc4e441a41d85e6e0efdce416e13c8e56dda6cdbb9c67c8c7959ee1cb847`.

## 6. Артефакты

- Installable module ZIP: `dist/module.zip`.
- Release manifest: `dist/module.json`.
- Актуальные размер и SHA-256 module ZIP: `dist/SHA256SUMS.txt` и финальный отчёт; hash не вписан внутрь самого архива, чтобы избежать самоссылочного несовпадения.
- Скриншоты: `dist/ui-screenshots/`.
- ZIP скриншотов: `dist/ui-screenshots.zip` — **2,913,243 bytes**.
- Контрольная сумма скриншотов: `dist/ui-screenshots.sha256`.
- Manifest скриншотов: `dist/ui-screenshots/manifest.json`.
- Live-результаты `1.5.0`: `dist/live-verification/v1.5.0-baseline.json`, `v1.5.0-results.json`, `v1.5.0-cleanup-results.json`, `v1.5.0-startup-verification.json`.
- Post-1.5.0 live: `dist/live-verification/post-1.5.0-t045-results.json`, `t046-results.json`, `t047-results.json`, `t048-results.json`, `t049-results.json`, `t050-results.json`, `t051-results.json`.
- Исторические live-результаты `1.3.1`: `dist/live-verification/final-live-results.json`, `plasma-regression-results.json`, `cleanup-results.json`, `final-startup-verification.json`.
- Архитектура: `docs/architecture.md`.
- Миграции: `docs/migration-notes.md`.
- Карта API: `docs/rebuild-native-api-map.md`.
- Матрица функций: `docs/rewrite-feature-matrix.md`.

## 8. Интеграция 1.5.0: unified effects и persistent damage

- Подсистема v1.4.0 объединена с native-first реконструкцией без второго хранилища эффектов. Опциональные поля эффектов сами по себе не требуют миграции; отдельная миграция дальности сенсоров повышает `DATA_VERSION` с 2 до 3. Состояние остаётся в `flags.sf2e-tactical-starship-combat.starship`; существующие Actor, Item, Combat, флаги, pack IDs и UUID сохраняются.
- Ручные эффекты получают явные области: весь корабль, механики, станции, действия, оружие и члены экипажа. Поддерживаемые эффекты экипажа создаются как native Items; частичный отказ, устаревшие цели и конфликт повторного `operationId` сообщаются явно.
- Продолжительный урон проходит staging в том же Draft, выбирает сильнейший эффект каждого типа по ожидаемому значению, использует native dice и сохраняет durable receipt до явного применения ведущим. Применение идёт через единственный корабельный damage path ровно один раз; восстановление корабля и экипажа следует правильному порядку.
- Интервал корабля — обычный конец его хода либо один end-of-round fallback, если обычного хода нет. Ходы экипажа и проверка целостности критически повреждённого корпуса не создают дополнительных тиков.
- Объединённый Effect Manager и отдельный target dialog сохраняют operational/destroyed, native valued conditions и локализацию EN/RU. Общего Undo и history UI нет; сохранена только узкая guarded Toolbelt-квитанция отмены одного применения урона.
- Native-first targeting, hazard AC/saves/HP/Hardness/IWR, plasma multi-target и per-target receipts, Sensor Map range/detection/placement, карточки степеней успеха и native Condition Manager остались действующими. Нативные condition modifiers учитываются один раз.
- Публичный API расширен аддитивно: `applyManualEffect`, `removeManualEffect`, `getEffectTargetCatalog`, `processPersistentDamage`, `applyPersistentDamage`, `recoverPersistentDamage`, `openEffectManager`.

Точные локальные команды, счётчики тестов, размеры и проверка release-артефактов записаны в [заметках 1.5.0](releases/1.5.0.md). GM live-матрица Foundry для `1.5.0` выполнена — **24/24**; post-1.5.0 backlog T-045–T-050 и T-051 также прошли live-проверки, тестовые документы очищены и baseline восстановлен. После сохранения T-044 ветка отправлена в origin и создан PR #26 против `main`; tag, публикация релиза и merge в `main` не выполнялись.

## 9. Post-1.5.0 backlog

- Редактор защит и навыков теперь точечно удаляет и заменяет числовые карты через `ForcedDeletion`/dotted assignments; custom-ключи и иммунитеты сохранены.
- Каждое размещение Sensor Map создаёт независимый map-only snapshot без документа в Actors Directory; world и non-first compendium drops изолированы, drag перемещает только выбранную запись.
- Стрелки и art-трансформы выровнены; rotation, horizontal mirror и heading-aware auto-mirror сохраняются per object.
- GM header selector позволяет выбирать player/NPC/hazard map objects, видеть zone/order, запускать проверенные NPC/hazard действия и открывать Effects Manager map-only snapshot.
- GM Combat Tracker показывает истинные имя/арт приватных контактов; player projection остаётся анонимной.
- Strike trait selector использует локализованные системные/module каталоги, поиск и мультивыбор с сохранением custom traits.
- T-051 закрыл live-найденные persistence edges: active-GM ownership и JSON-nonpersistable `undefined` embedded Item fields.

Все перечисленные пункты прошли live-проверки и cleanup. Отдельный подключённый player-client по-прежнему не проверялся; player projection проверялась переключением локального user context.

## 10. Источники правил и API

- [Foundry API — Document](https://foundryvtt.wiki/en/development/api/document)
- [Foundry API — Roll](https://foundryvtt.wiki/en/development/api/roll)
- [Foundry Hooks](https://foundryvtt.wiki/en/development/guides/Hooks_Listening_Calling)
- [AoN — Sensor Map](https://2e.aonsrd.com/rules/1339-sensor-map)
- [AoN — Seek Starships](https://2e.aonsrd.com/actions/604-seek-starships)
- [AoN — Speed and Sensors](https://2e.aonsrd.com/rules/1411-speed-and-sensors)
- [AoN — Gunnery](https://2e.aonsrd.com/rules/1416-gunnery)
- [AoN — Area Fire](https://2e.aonsrd.com/actions/17-area-fire)
- [AoN — Plasma Cannon](https://2e.aonsrd.com/Equipment/weapons/69)
