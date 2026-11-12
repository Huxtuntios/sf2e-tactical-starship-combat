# Windows: GitHub Desktop и автоматический релиз

Модуль: **sf2e-tactical-starship-combat**. Версия: **1.0.0**. Владелец: **Huxtuntios**.

Порядок такой же, как у приложенного Animist Apparition Manager: добавляете распакованную папку в Desktop, публикуете репозиторий, создаёте Release на сайте. **GitHub Actions сам собирает и прикрепляет module.json, module.zip и SHA256SUMS.txt. Вручную загружать их не нужно. Node.js на вашем компьютере для публикации тоже не нужен.**

Репозиторий уже существует. Текущая версия **1.0.0 — подготовлена к публикации; проверка в живом Foundry не выполнена**, manifest содержит **22 пака**. Раздел создания репозитория ниже нужен только для нового форка или отдельной копии.

## Обязательный gate до тега и публикации — UNEXECUTED

**Живые проверки, policy/лицензионная проверка и HUMAN approval не выполнены. Не создавайте тег и не публикуйте релиз до их выполнения и явного решения человека.** Зелёные локальные/CI проверки не заменяют эти условия. См. [release readiness](release-readiness.md), [reality check](reality-check.md), [ограничения](known-limitations.md) и [план живой проверки](testing.md). Не объявляйте сборку live-certified; публикация 1.0.0 — отдельное явное решение человека после gate. Эта инструкция сама ничего не публикует.

После gate отдельно проверьте текущий commit, версии manifest/package/lockfile, поддерживаемую пару Toolbelt/libWrapper и реальный запуск с отдельными GM/игроками, включая SF2e и PF2e + Anachronism. Сверьте `../LICENSE` и `../THIRD-PARTY-NOTICES.md`; техническая сборка не даёт юридического заключения. Следующие шаги — только порядок действий для будущей явно одобренной публикации.

## Подготовка

1. Установите GitHub Desktop с https://desktop.github.com и войдите в аккаунт **Huxtuntios**: **Sign in to GitHub.com**, либо **File → Options → Accounts**.
2. Распакуйте архив исходников через **Extract All**. Внутри находится папка `sf2e-tactical-starship-combat`. Именно она станет репозиторием. Можно перенести её в `Документы\GitHub\`.
3. Проверьте: `module.json`, `README.md`, `package.json` и папка `.github` лежат непосредственно внутри неё.
4. Логин **Huxtuntios** и имя репозитория уже подставлены. Заменять `OWNER` не требуется.

Лицензия этого модуля — **ORC**, а не MIT. Перед публичным распространением отдельно проверьте уведомления исходных публикаций в `LICENSE` и `THIRD-PARTY-NOTICES.md`: техническая проверка не является юридическим заключением.

## Создание репозитория

1. В Desktop выберите **File → Add local repository…** и укажите распакованную папку `sf2e-tactical-starship-combat`.
2. В сообщении о том, что папка не является Git-репозиторием, нажмите **create a repository**.
3. В **Create a Git Repository** проверьте:
   - **Name:** `sf2e-tactical-starship-combat`;
   - итоговый путь указывает на существующую распакованную папку, а не на новую одноимённую папку внутри неё;
   - **Initialize this repository with a README** — выключено;
   - **Git Ignore:** `None`;
   - **License:** `None`.
4. Нажмите **Create Repository**. Все перечисленные файлы уже есть в архиве.
5. В **Current Branch** должна быть `main`. Если указана `master`, переименуйте через **Branch → Rename…** до публикации.
6. Если в **Changes** остались файлы, напишите в **Summary** `Initial commit` и нажмите **Commit … files to main**. Число файлов отличается от примера. Если Desktop уже создал начальный коммит и Changes пуста, повторный коммит не нужен — проверьте **History**.
7. Предупреждение LF/CRLF само по себе не является ошибкой сборки: текстовые окончания строк заданы в `.gitattributes`.
8. Нажмите **Publish repository**. Владелец — **Huxtuntios**, **Organization** оставьте пустым для личного аккаунта.
9. Снимите **Keep this code private** и нажмите **Publish Repository**. Для установки без авторизации нужны публичные вложения.
10. Откройте **Repository → View on GitHub** (`Ctrl+Shift+G`). Проверьте адрес:

```text
https://github.com/Huxtuntios/sf2e-tactical-starship-combat
```

11. На вкладке **Actions** дождитесь зелёного **CI**. Он проверяет форматирование, линтер, содержимое, собирает 22 компендиума, запускает Node-тесты и Chromium-стенды. Проверки могут занять несколько минут.

## Релиз

Этот шаг выполняется на сайте GitHub, не в Desktop.

1. Откройте **Releases → Create a new release** либо **Draft a new release**.
2. В **Choose a tag** введите **`v1.0.0`** и выберите создание нового тега при публикации. **Target:** `main` с подготовленным коммитом.
3. **Release title:** `1.0.0`.
4. В описание скопируйте текст из **`docs/releases/1.0.0.md`** в репозитории.
5. Для **1.0.0** не включайте **Pre-release**: это стабильный канал, и после публикации `releases/latest` должен указывать на него. Это не отменяет обязательный gate выше; публикация выполняется только после явного решения человека.
6. **Файлы вручную не прикрепляйте.** Нажмите **Publish release**.
7. Откройте **Actions** и дождитесь зелёного **Release**. Он проверит соответствие тега версии, выполнит тесты, соберёт компендиумы и прикрепит:
   - `module.json`;
   - `module.zip`;
   - `SHA256SUMS.txt`.
8. Вернитесь в **Releases → 1.0.0 → Assets**: там должны появиться эти три файла. Автоматические **Source code (zip/tar.gz)** для установки Foundry не подходят, поскольку не содержат собранных компендиумов.

**Проверка в Foundry — UNEXECUTED:** исторические локальные результаты находятся в [testing](testing.md), но полноценный запуск Foundry с ведущим и отдельным игроком не выполнен. До тега/публикации выполните live/policy/HUMAN gate выше. Для стабильной 1.0.0 после публикации используется обычный канал `latest`.

### Важное исключение: immutable releases

Как и workflow модуля-примера, эта схема прикрепляет файлы **после публикации** и рассчитана на обычные изменяемые релизы. Если в репозитории включены **immutable releases**, GitHub запрещает добавлять вложения после публикации. Workflow остановится с понятной ошибкой. Для такого режима файлы нужно заранее приложить к черновику до публикации — это другой порядок работы.

### Если Release красный

- **Несовпадение версии:** тег должен быть `v1.0.0`, версии в manifest/package/lockfile — `1.0.0`.
- **403 при загрузке:** workflow уже содержит `permissions: contents: write`. Проверьте **Settings → Actions → General**, разрешён ли запуск Actions и не ограничена ли запись токена политикой репозитория/организации. Если запись запрещена настройкой и у вас есть право её менять, выберите **Read and write permissions**, сохраните и нажмите **Re-run all jobs**. Это не отменяет ограничения immutable releases.
- **Ошибка тестов:** откройте первый упавший шаг и исправьте причину. Наличие страницы Release без файлов ещё не означает успешную сборку.
- **404:** проверьте публичность репозитория, точное имя, тег, наличие вложений и зелёный Release. Для prerelease адрес `latest` не подходит.

## Установка в Foundry

После успешной сборки обычного релиза откройте:

```text
https://github.com/Huxtuntios/sf2e-tactical-starship-combat/releases/latest/download/module.json
```

Адрес должен открыть или скачать JSON без входа в GitHub. Вставьте его в **Foundry → Add-on Modules → Install Module → Manifest URL**, установите модуль и включите его в мире SF2e.

Для конкретной версии или предварительного релиза:

```text
https://github.com/Huxtuntios/sf2e-tactical-starship-combat/releases/download/v1.0.0/module.json
```

`latest` не выбирает prerelease. Поле `manifest` модуля указывает на стабильный канал; пока обычного релиза нет, проверка обновлений по нему может возвращать 404.

При ручной установке скачайте **module.zip** из Assets и распакуйте его содержимое в `Data/modules/sf2e-tactical-starship-combat`. В этой папке должен непосредственно лежать `module.json`, без двойной вложенности. Сначала сделайте резервную копию мира.

## Следующие обновления

1. Вносите изменения в файлы.
2. После live/policy/HUMAN gate выберите новую, ещё не опубликованную версию и укажите один и тот же номер в:
   - `module.json → version`;
   - `package.json → version`;
   - `package-lock.json → version`;
   - `package-lock.json → packages → "" → version`.
3. Текущий исходный `module.json` не содержит `manifest`/`download`. `tools/build-release.mjs` формирует в `dist/module.json` постоянный `.../releases/latest/download/module.json` и `.../releases/download/v<version>/module.zip`; перед публикацией проверьте их и соответствие ZIP-манифеста. Не добавляйте неподтверждённые update URLs ради документации.
4. Обновите `CHANGELOG.md`, добавьте `docs/releases/<version>.md` для выбранной новой версии; существующую историю не удаляйте.
5. Только после отдельного разрешения на commit/push: в Desktop **Commit → Push origin**, затем дождитесь зелёного **CI** подготовленного commit.
6. Повторно проверьте live/policy/HUMAN gate. После явного разрешения создайте Release с тегом **`v<version>`**, соответствующим подготовленному commit, и дождитесь зелёного **Release** с проверенными вложениями. Для dev-версии используйте **Pre-release**.

Локальный Node.js для публикации не требуется. Для проверки до отправки установите Node.js 22.13+ и выполните:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:ui
npm run build:release
```

Результаты локальной сборки появятся в `dist/`. На Linux Chromium может требовать `npx playwright install --with-deps chromium`.

Не коммитьте `node_modules`, `packs`, `packs-src`, `dist` и `.work`: они исключены через `.gitignore`. Исходные печатные материалы и секреты отдельно проверяйте перед добавлением файлов; `.gitignore` не является полной защитой. Не переиспользуйте опубликованный номер для другого кода.

## Справка GitHub

- GitHub Desktop: https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop
- Локальные репозитории: https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop
- Создание релизов и immutable releases: https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
