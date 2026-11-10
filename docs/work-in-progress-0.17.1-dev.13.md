# 0.17.1-dev.13 — экспериментальный отчёт

Источник разработки: `c64ffd4bb5c9ea3d18d85bdca02b8f39942eeb8c` (родитель `d6589c7e706f4c534c92caf86281f875249e4a76`). Целевой commit и весь diff относительно родителя были изучены до внесения изменений. Рабочая ветка оставлена без commit/push; релиз не опубликован. Результаты CI #23 относятся к исходному commit; локальные результаты dev.13 не являются новым hosted Actions run.

## CI #23: причина и предупреждения

Для GitHub Actions run 23 (`42905167760`, head `c64ffd4`) job `check` завершился успешно. Job `ui` запускал Chromium, выполнил 47 assertion, и завершился с **46/47**: единственная ошибка `mine-modification/gm.html` → `install-gm-only`.

Первопричина — устаревший selector в `tools/smoke-mine-modification.mjs`: фикстура искала `data-action="installMinePlan"`, тогда как актуальный шаблон рендерит кнопку с `data-action="installMineStock"`. Поэтому проверка не находила GM control, хотя Chromium и фикстура стартовали. Selector обновлён на существующее действие; число и строгость проверок не уменьшались. Локальный Chromium run после изменений прошёл **49/49**.

Уведомление `Node.js 20 is deprecated` относится к версиям `actions/checkout@v4`, `actions/setup-node@v4` и `actions/upload-artifact@v4`: GitHub runner принудительно выполнял их на Node.js 24. В логах также есть предупреждения зависимостей `punycode` и `url.parse`. Рабочий runtime job задан Node.js 22; ни одно предупреждение не связано с assertion failure. Workflow использует `ubuntu-latest`; в логе run 23 предупреждение о нём не обнаружено. Ни одно из этих предупреждений не объявляется причиной падения. Workflow версии не менялись.

Обновлённый hosted run для dev.13 невозможен без commit/push, запрещённых запросом. Для локального воспроизведения временно возвращён старый selector: `npm run test:ui` дал ровно 48/49, с единственным отказом `mine-modification/gm.html` → `install-gm-only`; Chromium запускался. После восстановления исправленного selector тот же suite прошёл 49/49.

## Sensor Map и лист персонажа

- Меню GM позволяет выбрать Hazard и Starship Actor из мира и Actor-компендия. Compendium Actor копируется в новый мировой экземпляр перед размещением; исходник не должен меняться. NPC/Player роль и доступность отображаются; drag-and-drop сохранён.
- Скрытый контакт остаётся в существующей приватной системе контактов. Публичный контакт требует identified и явного подтверждения; уже видимый Actor нельзя скрыть, а скрытый Player Starship без доступа игроков отклоняется. Новый путь не создаёт публичный Combatant.
- В активном бою лист персонажа даёт доступ к свободным станциям и текущему назначению. Операции используют `Crew.claim`/`Crew.release`, права и существующую per-ship сериализацию; конкурентное занятие одной станции повторно проверяется.
- Статические проверки, mocks и DOM fixtures **не доказывают приватность** в Foundry. Реальные compendium indexes, ownership, hooks, отдельные клиенты, network/cache paths и GM failover не проверялись.

## Drone Block: правила и границы

Источник: Tech Core, печатная стр. 179, подтверждённая [AoN Drone Block](https://2e.aonsrd.com/actions/585-drone-block). Требуются развернутый дрон и входящий Strike; сопротивление равно половине уровня оператора. Текст отдельно возвращает дрон и запрещает его Deployment 10 минут. Поэтому у оператора 1-го уровня сопротивление 0, но дрон всё равно возвращается и получает cooldown. В поддерживаемом native Strike card GM выбирает дрон и конкретный удар; сопротивление проходит через штатный `applyDamageInDraft`, либо GM явно выбирает ручное разрешение.

Tech Core p.184 описывает отдельный Drone Shield Protocol: до двух блоков на дрон, первый уничтожает экран, Fetch and Fix немедленно возвращает/чинит его; при уничтоженном экране Deployment запрещён на 2 раунда. Карточка атаки предлагает для этого upgrade отдельное GM-подтверждаемое ручное разрешение. Оно использует существующий per-drone ledger `updateProtocolDrone`: записывает receipt конкретного удара, увеличивает счётчик блоков и отмечает ожидание Fetch and Fix, которые уже отображаются в листе корабля. GM вручную применяет сопротивление и adjudicates состояние щита; базовые возврат/cooldown не применяются.

Два вопроса не имеют прямого ответа в цитируемом тексте, поэтому код их не интерпретирует молча:

1. [Intercept Munitions](https://2e.aonsrd.com/actions/576-intercept-munitions), Tech Core p.193, называет `Retrieve Drone`; Drone Block говорит, что дрон retrieved, но не уточняет, эквивалентен ли автоматический возврат действию. Состояние `tscInterceptUsed` сохраняется; explicit Retrieve сбрасывает запись. При подтверждении GM показывается caveat.
2. [Pyrotechnics Drone](https://2e.aonsrd.com/tactical-starship-combat/drones/1-pyrotechnics-drone) и [Deploy Starship Mine](https://2e.aonsrd.com/actions/569-deploy-starship-mine), Tech Core pp.192–193, описывают размещение мин как отдельных starship mines и доступность drone actions при развёрнутом дроне; не найден текст о судьбе хранимых/развёрнутых мин при возврате. Mine stock и mine records сохраняются неизменными; drone-dependent операции недоступны, пока дрон возвращён. Предупреждение требует проверки GM. Это сохранение состояния, а не ruling.

Мягкая автоматизация покрывает только поддерживаемые нативные single-target Strike-карточки по Player Starship. Toolbelt/external damage, area attacks, NPC-defender reactions и применение сопротивления при Drone Shield Protocol остаются ручными. Вернувшийся дрон показывает остаток 10-минутного срока по времени мира; если world time недоступен, UI сообщает, что срок нельзя определить, а не подставляет часы компьютера. Добавлен service integration test, вызывающий `Crew.claim`/`Crew.release` и проверяющий конкурирующие заявки на одну станцию. Переподключение, cross-GM concurrency и реальные SF2e/PF2e документы не проверялись. Список для живого теста: `docs/MANUAL-TEST-0.17.1-dev.13-ru.md`.

## Другие источники

`Huxtuntios/sf2e-missing-tech-pets` изучен отдельно: в нём нет Drone Block, Intercept Munitions или Pyrotechnics Drone и нет текста правил. Учтены только совместимые engineering patterns — отдельное состояние, проверка переходов, подтверждение, идемпотентность и тесты инвариантов. Обязательная зависимость не добавлена.

`foundryvtt/pf2e` проверен только на APIs листов персонажа. Контекст листа поддерживает hooks AppV1 и AppV2; добавлена команда через `getActorSheetHeaderButtons` и `getHeaderControlsApplicationV2`. Это исходниковая проверка API, не runtime-совместимость с живым Foundry.

## Итоговые проверки и артефакт

Итоговые локальные проверки:

- `npm run check` — успешно; 767 unit, architecture and integration tests прошли (0 failures), вместе с проверками форматирования, lint, сборки и валидации. Integration включает `Crew.claim`/`Crew.release` и конкурентные заявки на одну станцию.
- `npm run package` — успешно; штатный packaging path собрал dev.13.
- `npm run test:ui` — успешно, 49/49 Playwright/DOM checks (Chromium). Для отрицательного контроля со старым selector — 48/49, только целевая assertion упала.
- `git diff --check` — успешно.

Для ручной установки: `dist/module.zip`; SHA-256 указан в сопутствующем `dist/SHA256SUMS.txt`. Архив проверен на корневой `module.json`, release/manual documentation и отсутствие лишнего верхнего каталога. Версия — `0.17.1-dev.13`.

Локальные unit/integration и mock/UI fixtures не являются реальными Foundry проверками. Foundry не запускался; ownership, compendium import в живом мире, multi-client privacy/delivery, конкурентные станции и GM failover остаются непроверенными. Реальный GitHub Actions run для dev.13 не создавался.
