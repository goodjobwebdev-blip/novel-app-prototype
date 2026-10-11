# Leonardo.AI: требования к интеграции генерации изображений

Статус: спецификация для согласования; реализация отсутствует.
Дата проверки документации: 11 октября 2026 года.
Репозиторий: `goodjobwebdev-blip/novel-app-prototype`.
Исследованная база: `main`, commit `ad5add3`.

Этот PR должен содержать только данный файл. Изменения приложения, зависимостей, конфигурации шлюза и тестов относятся к следующему PR.

## 1. Цель и границы

Добавить image-провайдера `leonardo` с отображаемым именем `Leonardo.AI` в существующую систему Image profiles, избранных моделей, очереди, Chat proposals и Gallery. Не создавать отдельную систему генерации и не менять активного текстового провайдера.

Обязательный первый этап — text-to-image для шести моделей ниже. Video, upscaling, background removal, дополнительные модели и пакетная генерация вне объёма. Одна локальная задача должна заказывать ровно одно изображение.

Референсы документированы отдельно в разделе 5: это не обещание I2I в первом этапе. Не выставлять `image-to-image` в каталоге, пока не реализованы роли референсов, загрузка/передача, проверки и тесты. Поддержка image guidance не равнозначна универсальному редактированию изображения.

### Точный список моделей

| Название в UI | Значение `model` в POST v2 | Источник |
| --- | --- | --- |
| Lucid Origin | `lucid-origin` | [S1] |
| Lucid Realism | `lucid-realism` | [S2] |
| FLUX Schnell | `flux-schnell` | [S3] |
| P-Image-Ideogram | `ideogram/p-image-ideogram` | [S4] |
| Krea 2 | `krea/krea-2` | [S5], схема `Krea_krea2GenerationRequest` |
| Krea 2 Turbo | `krea-2-turbo` | [S5], [S8], схема `Krea2TurboGenerationRequest` |

Для P-Image-Ideogram использовать документированное название и точный API slug `ideogram/p-image-ideogram` [S4]. Не реализовывать эвристическую нормализацию неизвестных IDs.

В объём входят **Krea 2 и Krea 2 Turbo** как две отдельные модели с разными контрактами [S5], [S8], не alias и не fallback. Krea 2 документирована в OpenAPI Create Async Generation [S5], Turbo — также в отдельном guide [S8]. Наличие схемы не доказывает доступность модели конкретному аккаунту.

## 2. Основной принцип: контракт определяется моделью

Один endpoint и одинаковая версия API **не означают одинаковые параметры**. Нужен явный реестр контрактов по точному API slug, а не общий Leonardo payload и не правила вида «все сторонние модели имеют quality».

Для каждой модели реестр задаёт:

- allowlist полей, обязательность, типы, enum, диапазоны и допустимые размеры;
- отдельные capability metadata и проверенные UI presets;
- defaults приложения отдельно от defaults провайдера;
- источник, дату проверки и версию локального контракта;
- builder и validator, выбираемые по точному `model`.

Создавать тело из разрешённых полей, не через spread всей задачи/избранной модели. Неизвестная модель, неизвестная опция или недопустимая комбинация должны давать локальную ошибку до сети. При восстановлении старой задачи не подменять её модель/размер/options новыми defaults.

Валидация нужна и при сохранении профиля, и перед enqueue, и непосредственно перед первоначальным POST. Cached/imported favorite metadata не является доверенным источником контракта. Проверять prompt, который фактически будет отправлен, включая выбранный enhanced prompt; не обрезать его молча.

## 3. Транспорт и discovery

### 3.1. Создание задачи

Согласно [S1–S5], [S8], используется:

```text
POST https://cloud.leonardo.ai/api/rest/v2/generations
Authorization: Bearer <device-local production API key>
Accept: application/json
Content-Type: application/json
```

Конверт: `model`, вложенный `parameters`, корневой `public`. `prompt`, `width`, `height`, `quantity` и опции находятся внутри `parameters`, не в корне.

Defaults приложения:

- `public: false` всегда задаётся явно; публичная публикация не входит в первый этап;
- `quantity: 1` всегда задаётся явно; API default `4` нельзя наследовать;
- `prompt_enhance: OFF` по умолчанию, чтобы без согласия не повторять enhancement приложения. Пользователь может явно выбрать `AUTO`, `ON` или `OFF`; документированный default провайдера — `AUTO` [S1–S4];
- Lucid: явный `mode: FAST`; P-Image-Ideogram и Krea 2: явный `quality: MEDIUM`; Schnell и Krea 2 Turbo: ни `mode`, ни `quality`;
- если seed не выбран, поле отсутствует, а не `null` или автоматически сгенерированное значение;
- для моделей со styles профиль по умолчанию явно выбирает Dynamic. UUID и допустимость сверяются по конкретной модели, а не общей legacy-таблице.

Не переносить поля v1 (`modelId`, `num_images`, `styleUUID`, `enhancePrompt`, `alchemy`, `contrast`, `ultra`) в POST v2. Не использовать OpenAI-поля `n`, `size`, `response_format`, `moderation` или lowercase quality. Legacy recipes [S11] не являются шаблоном POST v2.

### 3.2. Каталог

`GET https://cloud.leonardo.ai/api/rest/v2/models` с Bearer auth возвращает `productionApiAvailableModels`, элементы с `id`, `name`, `parameters`; параметры описаны как OpenAPI schema и различаются между моделями [S6].

Требования:

1. Показывать только шесть выбранных моделей. Не импортировать весь production-каталог в UI.
2. Хранить API generation slug отдельно от discovery ID. Не считать, что `id` discovery совпадает с `model` POST; соответствие должно быть доказано схемой/ответом, а не выводиться из имени.
3. Оставить проверенный curated-каталог доступным без ключа с пометкой «документировано, доступность аккаунта не проверена».
4. Authenticated refresh не должен запускать генерацию. Сохранить время проверки и состояние доступности отдельно от настроек профиля.
5. Ошибка refresh/401/сеть не должна очищать favorites или выдавать cached данные за проверенный live-каталог. Если успешный ответ не содержит выбранную модель, отметить её недоступной, не заменять другой.
6. Не исполнять удалённую schema как код. Неизвестные keywords/несогласованные ограничения требуют диагностируемого состояния и проверки контракта, не расширения allowlist наугад.
7. Refresh не меняет profiles/defaults автоматически. Обновление capabilities — отдельное действие с повторной валидацией.

## 4. Контракты text-to-image

Размеры ниже — ограничения API. Приложение сохраняет свою нижнюю границу `64` и лимит `40 MP`; разрешено только пересечение ограничений приложения и модели. Для UI можно предложить небольшой curated-набор размерных плиток, но нельзя объявлять произвольные общие presets поддерживаемыми без проверки каждой модели.

| Модель | Prompt, символы | Width | Height | Управление режимом/качеством | Seed |
| --- | --- | --- | --- | --- | --- |
| Lucid Origin [S1] | `1..2000` | `16..3840`, шаг `8` | `16..3616`, шаг `8` | `mode: FAST / ULTRA` | целое `0..2147483647` |
| Lucid Realism [S2] | `1..9999` | `16..2496`, шаг `8` | `16..2496`, шаг `8` | `mode: FAST / ULTRA` | целое `0..2147483647` |
| FLUX Schnell [S3] | `1..2000` | `32..2048`, шаг `8` | `32..2048`, шаг `8` | нет `mode`, нет `quality` | целое `0..2147483637` |
| P-Image-Ideogram [S4] | `1..10000` | enum ниже | тот же enum | `quality: VERY_LOW / LOW / MEDIUM / HIGH` | не документирован: не отправлять |
| Krea 2 [S5] | `1..5000` | `16..4096`, шаг `8` | `16..4096`, шаг `8` | `quality: MEDIUM / HIGH` | целое `0..4294967295` |
| Krea 2 Turbo [S5], [S8] | `1..9999` | `16..4096`, шаг `8` | `16..4096`, шаг `8` | нет `mode`, нет `quality` | не документирован: не отправлять |

P-Image-Ideogram width/height enum [S4]:

```text
512, 640, 720, 800, 832, 864, 896, 1024,
1120, 1152, 1248, 1280, 1440, 1536, 1600, 1664,
1728, 1792, 2048, 2240, 2304, 2496, 2560, 2880,
3072, 3456
```

Наличие осей в enum не подтверждает работоспособность всех сочетаний на аккаунте. Учитывать дополнительные зависимости live-схемы, если они появятся; preset нельзя автоматически округлять до «похожего» разрешения.

Общие документированные поля: `prompt`, `width`, `height`, `quantity`, `prompt_enhance`. Диапазон API quantity — `1..8`; приложение ограничивает его значением `1` [S1–S5]. Документированные provider dimensions defaults: Origin `1200×1200`, остальные `1024×1024` [S1–S5]. Приложение сохраняет свой square default `1024×1024`, допустимый по проверенным схемам, а не наследует default сервера.

### 4.1. Styles и запреты

`style_ids` доступны для Origin, Realism и Schnell, не более одного preset по соответствующим guides. Списки UUID различаются [S1–S3]. Реестр должен хранить отдельные списки названий/UUID; не использовать union и не доверять произвольному UUID из профиля.

Dynamic: `111dc692-d470-4eec-b791-3475abac4c46`.
None: `556c1ee5-ec38-42e8-955a-1e82dad0ffa1`.

Для P-Image-Ideogram, Krea 2 и Krea 2 Turbo `style_ids` не входит в проверенные схемы: запретить. Это не запрещает отдельно документированные image style references Krea 2. У Turbo разрешены только `prompt`, `width`, `height`, `quantity`, `prompt_enhance`; не переносить `quality`, `seed` или `guidances` из контракта Krea 2.

Для выбранных T2I-моделей не включать unsupported `negative_prompt`, CFG/guidance scale, steps, sampler, safety-disable или OpenAI moderation. Отсутствие поля в проверенном контракте трактовать как отсутствие поддержки в приложении, а не как разрешение экспериментально отправить его.

### 4.2. Минимальные примеры ожидаемого тела

Это примеры для будущих contract fixtures, не результаты live API. Prompt демонстрационный; все примеры private и заказывают один output.

```json
{"model":"lucid-origin","parameters":{"prompt":"A fox in a quiet forest","width":1024,"height":1024,"quantity":1,"prompt_enhance":"OFF","mode":"FAST","style_ids":["111dc692-d470-4eec-b791-3475abac4c46"]},"public":false}
```

```json
{"model":"lucid-realism","parameters":{"prompt":"A fox in a quiet forest","width":1024,"height":1024,"quantity":1,"prompt_enhance":"OFF","mode":"FAST","style_ids":["111dc692-d470-4eec-b791-3475abac4c46"]},"public":false}
```

```json
{"model":"flux-schnell","parameters":{"prompt":"A fox in a quiet forest","width":1024,"height":1024,"quantity":1,"prompt_enhance":"OFF","style_ids":["111dc692-d470-4eec-b791-3475abac4c46"]},"public":false}
```

```json
{"model":"ideogram/p-image-ideogram","parameters":{"prompt":"A fox in a quiet forest","width":1024,"height":1024,"quantity":1,"prompt_enhance":"OFF","quality":"MEDIUM"},"public":false}
```

```json
{"model":"krea/krea-2","parameters":{"prompt":"A fox in a quiet forest","width":1024,"height":1024,"quantity":1,"prompt_enhance":"OFF","quality":"MEDIUM"},"public":false}
```

```json
{"model":"krea-2-turbo","parameters":{"prompt":"A fox in a quiet forest","width":1024,"height":1024,"quantity":1,"prompt_enhance":"OFF"},"public":false}
```

## 5. Image guidance: будущий этап и расхождения источников

Схемы [S5] описывают разные роли и лимиты:

| Модель | Роли | Максимум по роли |
| --- | --- | --- |
| Origin / Realism / Schnell | `guidances.content`, `guidances.style` | по `1` |
| P-Image-Ideogram | нет документированного guidance | не включать |
| Krea 2 | только `guidances.style` | `10` |
| Krea 2 Turbo | нет документированного guidance | не включать |

Структурированные schema [S5] допускают reference types `UPLOADED`, `GENERATED`, `VARIATION`, `URL`, `BASE64`, требуют у guidance item `image` и `strength`; style strength: `LOW/MID/HIGH/ULTRA/MAX`. В schema content strength включает `ULTRA`, тогда как guides [S1–S3] перечисляют только `LOW/MID/HIGH`. Guides также перечисляют более узкие/legacy image types.

Это реальное расхождение, не основание смешивать форматы. Первый T2I-этап не отправляет `guidances`. Перед отдельным I2I-этапом проверить live metadata/Get API Code [S9], зафиксировать выбранный supported subset и источник. Не подавать единую `sources[]` в одинаковый payload всех моделей; UI должен назначать role и strength каждой ссылке. Не переносить локальный Gallery ID в provider UUID. Не путать style preset UUID и image style reference.

## 6. Async lifecycle и защита от повторной оплаты

Create Async Generation v2 возвращает корневой `generationId` и nullable `apiCreditCost` [S5]. Не использовать response shape v1 или OpenAI `data[0]` для этого ответа.

Опубликованный endpoint чтения изображения находится в **v1** [S7]:

```text
GET https://cloud.leonardo.ai/api/rest/v1/generations/{id}
Authorization: Bearer <same captured connection>
```

Результат: `generations_by_pk`, `status: PENDING / COMPLETE / FAILED`, массив `generated_images` с `id` и `url` [S7]. Не изобретать GET v2 только потому, что POST использует v2. Совместимость ticket из POST v2 с этим reader должна быть подтверждена integration smoke-check перед объявлением live-ready; публичная документация не заменяет такую проверку.

Требования к реализации:

1. Если `providerJobId` уже сохранён, начинать с чтения результата, без повторного POST и без повторной отправки prompt/source.
2. После принятого POST атомарно сохранить ID через существующий `onSubmitted`, прежде чем poll. Сохранять approved connection fingerprint и immutable request snapshot.
3. При PENDING/пустых images продолжать ограниченное, abortable ожидание. COMPLETE без пригодного output, FAILED, null result, неверный status/schema дают понятную ошибку; неизвестный status не должен создавать бесконечный цикл.
4. Общий timeout согласовать с существующим image-job budget; GET retry с bounded backoff/jitter, поддержкой `Retry-After` и AbortSignal. 401/403 и contract 4xx не повторять автоматически.
5. POST timeout/network error после отправки — неопределённый исход. Не retry POST автоматически: задача могла быть оплачена. Если ID не удалось сохранить, остановиться с предложением проверить provider history; новая генерация требует отдельного явного действия.
6. После reload/stale heartbeat восстанавливать только polling сохранённого ticket. Если ключ/endpoint изменился, блокировать resume, пока не восстановлено исходное соединение. Не переиспользовать ticket с другим аккаунтом.
7. `Stop waiting`, Cancel и удаление книги/чата прерывают локальную работу; не обещать отмену на стороне Leonardo или refund. Late result не должен возрождать удалённые записи.
8. Provider COMPLETE с одним пригодным изображением превращать в существующий `ProviderResult` и Gallery pipeline; неожиданные дополнительные outputs — диагностируемое несоответствие, не молчаливая потеря.
9. API credits не являются USD. Не класть `apiCreditCost` в существующий USD `cost` без новой явной units-модели. Допускается device-local поле с именем и единицей API credits; в первом этапе можно не отображать стоимость вовсе.

Polling предпочтителен для текущего browser-only приложения. Webhooks требуют серверного receiver и не входят в объём. Не наследовать лимиты конкретного Leonardo plan: учитывать 429 и account concurrency отдельно от локального лимита очереди [S12].

## 7. Настройки, UI и сохранение

- Добавить Leonardo в список image providers и discovery в Image profiles. Не включать в Video profiles или список активных text providers.
- Ключ — отдельная глобальная media connection в `Global Settings → AI → Connections`, сохраняемая кнопкой `Save connections`. Экран сейчас ориентирован на `AiProvider`; расширить раздел media connections явно, а не притворяться, что Leonardo поддерживает text completion.
- Leonardo key не имеет fallback к NanoGPT/OpenAI/LiteLLM. Отсутствие ключа блокирует генерацию с указанием, где его добавить. Profile editor с `hideCredentials` не должен быть единственным местом настройки.
- Настройки конкретной модели оформить namespaced типом, например `leonardoOptions`, с discriminated contracts. Не переиспользовать `OpenAIImageQuality` и `moderation` для Leonardo.
- В favorite/profile сохранять только валидные mode/quality, prompt enhancement, style preset и optional seed. В queued job — snapshot всех effective options и версии контракта. Не сохранять API key, headers или полный remote schema в job/profile.
- Показывать `FAST/ULTRA` только Lucid; quality — только P-Image-Ideogram/Krea 2 с их собственными enum; у Schnell и Krea 2 Turbo quality-control отсутствует. Seed-control отсутствует у P-Image-Ideogram и Krea 2 Turbo. Styles-control отсутствует у P-Image-Ideogram/Krea 2/Krea 2 Turbo.
- При смене модели не переносить несовместимые опции. При чтении повреждённого/старого профиля показать ошибку и сохранить оригинальные данные, не сбрасывать библиотеку целиком.
- Миграция добавляет пустой `keys.leonardo`, сохраняет существующие favorites, defaults, книги, captions и profiles. Обновить все constructors/test fixtures с `Record<ImageProvider, string>`.
- Добавить новые media-option поля в sanitizer allowlist профилей: иначе save/import потеряет настройки. Обновить portable archive/sync валидацию provider и options; ключи, tickets и fingerprints по-прежнему исключаются.
- Chat tool использует существующие favorite aliases, model-specific prompt limits и размеры. Proposal, preview, enhancement и открытие Settings не запускают платную генерацию. Оплачиваемое действие — только явный Generate.
- UI error сообщения не должны содержать ключ, Authorization, raw request prompt или непроверенные HTML от провайдера.

## 8. Сеть и безопасность

Доступ из browser origin, CORS API и CORS image CDN **не проверены** этим documentation-only PR. Нельзя объявить direct browser integration рабочей по одному server-side curl.

Перед реализацией определить и проверить транспорт на реальном origin приложения: discovery, POST preflight, authenticated GET poll и чтение image Blob. Прямые вызовы допустимы только если CORS позволяет их читать. Если нет — нужен отдельный приватный HTTPS gateway; его configuration/deployment, authentication и budgets согласуются отдельно. Не использовать public CORS proxy, `no-cors` или существующий Pruna route как недокументированный Leonardo proxy.

Ключи остаются device-local при direct transport либо server-only при gateway transport. Не класть их в Vite env/build, репозиторий, PR, profile export, backup, sync или логи. Snapshot credentials фиксируется на всё исполнение задачи.

К API-ключу обращаться только на разрешённом API origin/приватном gateway; `credentials: omit`, запрет credential-bearing redirect. Image URL из ответа проверять на HTTPS, отсутствие credentials и приватных/local адресов. Скачать image без Authorization Leonardo и без Referer. При gateway downloads дополнительно защищать от SSRF и смены host через redirect.

Сохранить существующие проверки MIME/file signature, `20 MB`, `40 MP`, storage headroom, thumbnail и transactional ownership. Подтверждённые moderation/provider failures показывать как ошибки; не обходить фильтрацию неподдерживаемыми параметрами.

## 9. Карта будущих изменений в репозитории

Это точки интеграции, не список файлов данного PR:

| Область | Файлы/требуемое изменение |
| --- | --- |
| Типы и contracts | `src/features/images/image-generation-types.ts`; отдельный Leonardo registry/adapter вместо роста общего payload |
| Каталог, keys, favorites, spec | `image-settings.ts`, `book-image-settings.ts`, `image-providers.ts`: точные IDs, validation, discovery и отдельная dispatch-ветка |
| Connection identity | `image-connection.ts`: Leonardo endpoint и resumable tickets; сейчас default endpoint ветки попадает в NanoGPT |
| Queue/recovery | `image-queue.ts`, `image-store.ts`, `ImageResults.tsx`: ID persistence, resume без POST, ownership и existing-result action |
| Profile storage | `src/features/settings/settings-profiles.ts`: emptyKeys, sanitizer allowlist, media validation |
| Connections/profile UI | `SettingsProfilesPanel.tsx`, `ImageSettingsPanel.tsx`, `ImageGenerationControls.tsx`: media credentials и controls по контракту |
| Draft и Chat | `useMediaWorkspaceDraft.ts`, `media-prompt.ts`, Chat proposal/direct-image paths: snapshot/limits, без неявной оплаты |
| Gallery и portable data | `src/data/persistence.ts`, `src/data/book-archive.ts`, Gallery metadata: provider/options и исключение secrets/tickets |
| Документация | В реализации актуализировать `docs/IMAGE_GENERATION.md`; в этом PR его не менять |

Особенно важно: `fetchImageModels` сейчас после специальных веток использует OpenAI discovery, а `generateProviderImage` — Pruna fallback. Добавление только union member без отдельных веток приведёт к неверному API. `resolveImageKey` сейчас обращается к text provider profiles; для Leonardo нужна явная media-only ветка.

## 10. Тесты и критерии приёмки реализации

### Contract tests, без платных запросов

- Для каждой из шести моделей проверить точный URL, headers и тело из раздела 4.2; `public:false`, `quantity:1`, вложенный parameters. Assertions должны проверять отсутствие запрещённых полей, не только наличие разрешённых.
- Границы prompt: accepted maximum и rejected maximum+1 для каждой модели, пустой/whitespace prompt, фактически выбранный enhanced prompt. Unicode length policy согласовать с provider schema, не считать байты лимитом символов.
- Width/height: оба края диапазона, шаг 8, асимметрия Origin, enum P-Image-Ideogram, application min 64 и 40 MP; отказ вместо округления.
- Seed 0 сохраняется; разные upper bounds; отрицательные, дробные, NaN/Infinity отклоняются. У P-Image-Ideogram и Krea 2 Turbo seed запрещён. Krea 2 и Turbo сохраняют разные IDs и контракты; смена модели не подменяет сохранённые задачи.
- Lucid не получает quality; Schnell и Krea 2 Turbo не получают mode/quality; Krea 2 отвергает LOW/VERY_LOW; Turbo отвергает seed/style_ids/guidances и принимает prompt до 9999 символов вместо лимита 5000 у Krea 2; styles проверяются по отдельному model allowlist; v1/OpenAI/video fields не просачиваются.
- Неизвестный ID, несовместимые options из cached/imported favorite и поддержка I2I до реализации — локальный отказ, ноль POST.
- Discovery fixtures: реальный response shape, отдельный mapping ID→slug, missing model, 401/429, malformed metadata и cache/offline fallback без потери profiles.

### Lifecycle, persistence и UI

- Mock POST → ID persistence → GET PENDING → GET COMPLETE → download → thumbnail → Keep/Gallery. Fixtures для FAILED, null result, COMPLETE без output, неправильного JSON и image MIME/size.
- Saved ticket/reload/retry выполняет GET без POST. Unknown POST outcome не вызывает повторного paid submit. Abort, timeout, stale ownership, deleted book/chat и late response не восстанавливают удалённые jobs.
- API/CDN key separation, redirect policy, redaction, changed connection fingerprint, malformed ID и unsafe delivery URL.
- Profiles save/load/duplicate/import/export сохраняют model options; migration старых settings не теряет данные; backup/sync не содержит key, ticket, fingerprint.
- UI показывает правильные controls и списки; ключ можно настроить в Connections без изменения text provider; Chat proposal не платит до Generate.
- Regression: OpenAI, NanoGPT, Pruna, book Image profiles, Gallery/Codex и существующая multi-tab queue продолжают работать.

Frontend tests запускать только через resource-limited `npm test` согласно `AGENTS.md`. Начать с focused image/media/profile tests; затем полный `npm test` и `npm run build`. Не использовать альтернативный test runner и не ослаблять cgroup/memory policy.

### Минимальный live-check — только при необходимости

Для подготовки требований ключ не нужен и не использовался. До объявления реализации live-ready:

1. Сначала разрешённый пользователем read-only GET models и CORS-проверка на origin приложения; это не generation, но всё равно обращения к аккаунту и rate limits.
2. Только если остаётся неясность transport/reader/schema, запросить временный production API key через безопасный secret-ввод, не в чат/PR. Если защищённого ввода нет, пользователь запускает probe у себя.
3. До POST согласовать небольшой бюджет в API credits/денежном эквиваленте по актуальному pricing, список моделей и количество вызовов. Не угадывать стоимость.
4. Начать с одного private `1024×1024`, quantity 1, самого дешёвого подтверждённого варианта; остальные модели проверять только в пределах разрешённого бюджета. Любой незапущенный model-path явно отметить как не проверенный live.
5. Проверить POST v2 → сохранённый ID → reader v1 → реальный image Blob. Не retry POST автоматически и не отправлять рукопись/личные изображения.
6. Записать только очищенные shapes/status/errors, не секреты. После проверки временный ключ отзывается владельцем.

Приёмка: все шесть точных моделей доступны в curated-каталоге, каждый builder/validator соответствует отдельному контракту, lifecycle не дублирует оплату, UI и portable data не теряют options/secret isolation, transport проверен для поддерживаемого способа deployment. Состояние live access каждой модели должно быть честно обозначено; fixtures не доказывают доступность аккаунта.

## 11. Непроверенные факты и решения перед реализацией

- Доступность шести моделей конкретному аккаунту и точная форма их GET models metadata.
- Совместимость generation ID POST v2 с documented GET v1 для каждой модели.
- CORS на фактическом browser origin и media CDN; нужен ли приватный gateway.
- Дополнительные ограничения пар размеров, зависящие от model/quality/account.
- Расхождения guidance schema и guides; они не блокируют T2I, но блокируют утверждение расширенной I2I-поддержки.
- Pricing/API credits и разрешённый бюджет live probes; платных запросов в этом PR нет.

Ни одно из этих неизвестных не оправдывает подмену модели, расширение payload или выдачу выдуманных response fixtures за live results.

## 12. Официальные источники

Источники проверены 11 октября 2026 года. Numeric T2I-параметры сверены с отдельными guides и OpenAPI. Для Krea 2 источник — конкретная OpenAPI schema, не руководство Turbo. При изменении источников требуются обновление registry и contract tests, а не тихое принятие новых полей.

- [S1] [Lucid Origin](https://docs.leonardo.ai/docs/lucid-origin.md).
- [S2] [Lucid Realism](https://docs.leonardo.ai/docs/lucid-realism.md).
- [S3] [FLUX Schnell](https://docs.leonardo.ai/docs/flux-schnell.md).
- [S4] [P-Image-Ideogram](https://docs.leonardo.ai/docs/p-image-ideogram.md).
- [S5] [Create Async Generation: OpenAPI v2](https://docs.leonardo.ai/reference/creategeneration.md), discriminator `model` и схемы `LucidOriginGenerationRequest`, `LucidRealismGenerationRequest`, `FluxSchnellGenerationRequest`, `Ideogram_pImageIdeogramGenerationRequest`, `Krea_krea2GenerationRequest`, `Krea2TurboGenerationRequest`; страница отмечена updatedAt `2026-09-01`.
- [S6] [Get Available Models: OpenAPI v2](https://docs.leonardo.ai/reference/getmodels.md).
- [S7] [Get a Single Generation: OpenAPI v1](https://docs.leonardo.ai/v1.0/reference/getgenerationbyid.md).
- [S8] [Krea 2 Turbo — другой контракт](https://docs.leonardo.ai/docs/krea-2-turbo.md).
- [S9] [Guide to Get API Code](https://docs.leonardo.ai/docs/get-api-code.md).
- [S10] [Индекс официальной документации](https://docs.leonardo.ai/llms.txt).
- [S11] [Legacy Lucid Origin recipe, POST v1](https://docs.leonardo.ai/recipes/generate-image-using-lucid-origin.md).
- [S12] [Concurrency, Queue and Rate Limit](https://docs.leonardo.ai/docs/guide-to-concurrency-queue-and-rate-limit.md).
