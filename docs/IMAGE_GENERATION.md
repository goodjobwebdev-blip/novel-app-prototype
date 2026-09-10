# AI image generation

Open **Images** using the image icon on the library/editor or the settings sidebar. Its tabs are **Generate**, **Gallery**, and **Settings**. All images/settings are local to this browser and origin; “all books” does not mean other devices.

## Set up and generate

1. In Images → Settings, expand **Provider API keys** to configure provider keys. An explicit image key takes priority. NanoGPT and OpenAI otherwise use the matching provider key in the originating book’s saved AI settings, then global AI defaults. Switching the text provider does not send that provider’s key to an unrelated image service. Pruna has a separate key.
2. Expand **Add a favorite model**, then refresh models (NanoGPT/OpenAI) or load documented Pruna models. Favorite models, give them unique chat aliases, enable their supported dimensions, choose each default size, and choose a default model. For OpenAI favorites, choose **Image quality** (Low, Medium, High, Auto) and **Image moderation** (Low, Auto). Both default to **Low**, including existing favorites without saved values. Save image settings.
3. Ask Chat for an illustration. `propose_image_generation` accepts required `prompt` and optional string `ratio`, `size`, `model_alias`. The model sees favorite aliases and enabled dimensions, never API keys. Only text-to-image is supported.
4. Edit the prompt, search favorites in the compact model picker, and select dimensions. **Accept proposal** approves it; **Reject** dismisses it. Acceptance does not contact the image provider.
5. Each **Generate** tap saves an independent request with the current prompt, model, size, OpenAI quality/moderation, and source chat/book. Changing a favorite later does not change queued requests. A direct Generate form is also available in Images.
6. **Keep image** saves it to the shared gallery. **Discard** removes the unkept result. Close the tool and the result stays at its original chat position. Tap it for touch zoom, prompt, original download, and provider metadata.

Each favorite shows selectable size tiles with the aspect ratio and dimensions. The default-model choice, generation defaults, and maintenance actions are grouped separately. Provider setup and model discovery can be collapsed once favorites are configured.

The square default is 1024×1024 when the model supports it; otherwise its first supported dimension is used. Ratios are derived from dimensions. Disabled/unsupported combinations and unknown aliases are rejected rather than silently changing the request. Refreshing the catalog does not silently replace saved favorite capabilities; use **Update supported sizes**.

## Provider adapters

| Provider | Discovery and initial scope | Generation |
| --- | --- | --- |
| NanoGPT | Public `/api/v1/image-models?detailed=true`; text-to-image models advertising numeric resolutions and single-image output | `/v1/images/generations`, `n: 1`, numeric size, `b64_json` preferred |
| OpenAI | `/v1/models` filtered to GPT Image; documented presets available without a key. Common sizes: 1024×1024, 1536×1024, 1024×1536 | `/v1/images/generations`, `n: 1`, PNG output, saved `quality` and `moderation` (both default to `low`) |
| Pruna | Documented P-Image presets; other Pruna model input schemas are not enabled yet | `/v1/predictions`, model header and custom dimensions, then status polling and authenticated delivery |

Sources: [NanoGPT image models](https://docs.nano-gpt.com/api-reference/endpoint/image-models), [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation), [Pruna quickstart](https://docs.api.pruna.ai/guides/quickstart), [Pruna P-Image](https://docs.api.pruna.ai/guides/models/p-image).

Requests go directly from the browser to the selected provider. Provider CORS policy, account/model access, API changes, and balance still apply. Automated tests use provider fixtures; they do not make paid requests or prove live account access.

## Queue lifetime and recovery

The workspace owns one queue manager outside chat and settings screens. Jobs and results are in IndexedDB, so navigation between books/chats cannot move or lose a job. Each provider runs one request at a time; providers can run concurrently. Queue position and elapsed generation seconds are displayed. Browser Web Locks and transactional claims coordinate multiple tabs. Without Web Locks, transactional claims and stale heartbeat recovery prevent reusing an active claim.

**Clear queue** removes all listed generations, including earlier history, from the Generate view. It cancels queued work, stops local waiting for running jobs, and discards unkept images (also from their chat results). Kept gallery images and their chat attachments remain available. You are asked to confirm if there is active work or an unkept result. **Remove from queue** clears one finished job; **Discard** also removes an unwanted result from this view. Clearing persists across reloads and does not affect new jobs added after you click.

Keep the app open while generating. Mobile OS suspension or closing the browser can interrupt network activity; there is no server worker or background completion promise. Queued jobs resume on return. A recorded Pruna prediction ID resumes polling the existing request. Interrupted synchronous requests are **not** automatically resubmitted: **Retry as new generation** is an explicit new request that may incur another charge. **Stop waiting** aborts local waiting; it cannot guarantee provider cancellation or a refund. Provider IDs, keys, and pending requests are not included in book backups.

Provider errors remain visible with explicit retry controls and key redaction. Storage headroom is checked before starting a request, and jobs/results commit with ownership checks so a late response cannot restore a cancelled/deleted job. Original PNG/JPEG/WebP outputs are bounded to 20 MB and 40 megapixels; originals are retained with separate 160px thumbnails. Storage estimates cannot guarantee that a later write will succeed.

## Gallery, deletion, and backups

The Gallery includes kept generations from all books plus current uploaded Codex illustrations. **Only this book** filters by source book. Images generated from the library have no source book. **Use in Codex** creates the existing optimized illustration for a selected entry in the current book; the gallery original remains intact.

Removing a result from chat hides only that attachment. Deleting a chat/book removes its jobs and unkept outputs, but kept generated images remain in the gallery. Deleting a generated image from the gallery removes its chat attachments too. Uploaded Codex illustrations retain their existing entry ownership and undo behavior. Forked chats share visible kept images; they do not copy running requests or authorize new generation.

Database v6 only adds `imageJobs` and `galleryImages` stores. Existing books, text, illustrations, and undo records retain their stores and identities. API keys remain in existing AI settings or the separate device image-settings record; they are never stored in jobs, image metadata, or chat proposals.

`.arcbook` v2 backups include kept generated originals and their completed chat references for the exported book. Queued/running jobs, unkept results, provider prediction IDs, and API keys are excluded. Import creates new book/image/job identities and makes old proposals stale; it never submits generation. Existing v1 backups remain readable. Unassigned images and images whose book was deleted can be downloaded individually from their viewer; they are not part of a book backup.

## Verification

`node --test tests/*.test.mjs` covers schema upgrades and book creation, provider key fallback, favorite validation, no generation before explicit action, concurrent claims, cancellation/late writes, interruption recovery, provider request fixtures, gallery ownership, backups, and the rendered proposal → queue → keep → viewer flow. Existing mobile gesture tests continue to exercise the shared zoom/modal components. `npm run build` runs TypeScript and the production Vite build.
