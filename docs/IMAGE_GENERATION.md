# AI image and video generation

Open the standalone **Images** workspace with the image button in the Library, editor, or Chat. Its workspace tabs are **Generate** and **Gallery**. The gear opens the main **Settings > Images** screen, where provider keys, favorite models, sizes, and generation defaults remain configured. Returning from Settings restores the Images tab, generation draft, and Gallery search, scope, and pagination state held by Workspace.

Images opened from the Library have no book context. Opening from the editor or Chat carries the current book into Images: its title is shown, new direct generations are attributed to it, and Gallery offers **This book** filtering and **Use in Codex** for that book. The queue, the **All** Gallery scope, and image settings are device-global for this browser origin; they are not cross-device or cloud data.

## Set up and generate

1. Open the Images gear, then in **Settings > Images** expand **Provider API keys**. An explicit visual-generation key takes priority. NanoGPT and OpenAI otherwise use the matching provider key in the originating book’s saved AI settings, then global AI defaults. Pruna has a separate key.
2. Expand **Add a favorite model**, then refresh models or load the curated Pruna catalog. Favorites record explicit T2I, I2I, T2V, and I2V capabilities, source limits, dimensions, video resolutions, and defaults. OpenAI GPT Image 2.5 favorites also support Low, Medium, High, Extra high, Maximum, and Auto quality.
3. Choose **Text to image**, **Image to image**, **Text to video**, or **Image to video**. Source tasks accept uploads and kept gallery/Codex images. Selected source bytes are copied into the queued request and are not uploaded until Generate is pressed.
4. Chat uses `propose_image_generation` with an optional `task`. Chat creates an editable proposal only; the user selects source images, accepts the proposal, and explicitly presses Generate.
5. Each **Generate** tap saves an independent immutable request with the prompt, task, model, options, source bytes, and source chat/book. Changing or deleting a gallery source later does not alter the queued request.
6. **Keep image/video** saves a result to the shared gallery. The viewer zooms still images, plays videos with native controls, shows provider metadata, and downloads the original MIME type.

Each favorite shows selectable size tiles with the aspect ratio and dimensions. The default-model choice, generation defaults, and maintenance actions are grouped separately. Provider setup and model discovery can be collapsed once favorites are configured.

The square default is 1024×1024 when the model supports it; otherwise its first supported dimension is used. Ratios are derived from dimensions. Disabled/unsupported combinations and unknown aliases are rejected rather than silently changing the request. Refreshing the catalog does not silently replace saved favorite capabilities; use **Update supported sizes**.

## Provider adapters

| Provider | Discovery and initial scope | Generation |
| --- | --- | --- |
| NanoGPT | `/api/v1/image-models?detailed=true` and authenticated `/api/v1/video-models?detailed=true`; explicit capability metadata is retained | Images use `/v1/images/generations` with `imageDataUrl(s)` for references. Video uses `/api/generate-video`, persists `requestId`/`runId`/`id`, and polls `/api/video/status`. |
| OpenAI | Current documented models are `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`; `gpt-image-2` and earlier GPT Image models remain available for compatibility | T2I uses `/v1/images/generations`. I2I uses multipart `/v1/images/edits` with repeated `image[]` parts. OpenAI video is not enabled in this product. |
| Pruna | Curated T2I models plus `p-image-edit`, `qwen-image-edit-plus`, `wan-i2v`, `p-video`, and `wan-t2v` | Sources upload through `/v1/files`; `/v1/predictions` receives exact model-specific fields, and async jobs persist IDs for status polling and authenticated delivery. |

Pruna’s aspect-ratio models receive only `prompt` and an allowed `aspect_ratio`. The UI represents those ratios with approximately one-megapixel presets: 1024×1024, 1344×768, 768×1344, 1536×672, 672×1536, 1216×832, 832×1216, 896×1120, 1120×896, 896×1152, and 1152×896, filtered to each model’s supported ratios. `z-image-turbo` instead receives the selected preset’s explicit `width` and `height`. Saved unknown Pruna model IDs and unsupported model/size combinations are rejected rather than submitted with a guessed schema.

The Pruna catalog displays a flat estimated USD cost per successful image: `$0.025` for `qwen-image`, `$0.0001` for `flux-2-klein-4b`, and `$0.005` for each other listed model. Pruna’s prediction response does not report actual per-request billing, so gallery cost metadata for Pruna is this static catalog estimate—not provider-reported billing.

Sources: [NanoGPT image models](https://docs.nano-gpt.com/api-reference/endpoint/image-models), [OpenAI image generation and editing](https://platform.openai.com/docs/guides/images/image-generation), and the checked/curated Pruna API contracts used by the product.

Requests go directly from the browser to the selected provider. Provider CORS policy, account/model access, API changes, and balance still apply. Automated tests use provider fixtures; they do not make paid requests or prove live account access.

## Queue, badges, and recovery

The standalone Generate view groups device-wide jobs as **Active** (queued/running), **Needs review** (completed but not kept or discarded), **Attention** (failed, interrupted, or cancelled), and **Earlier** (completed and already decided, or completed without a result). Queue cards retain their source book label when applicable.

The Images buttons in the Library and book workspace show queue badges. An exclamation mark takes priority when failed or interrupted jobs need attention; otherwise the badge shows the number needing review, then the number active (counts above nine display as `9+`). Open Images for the full grouped queue and controls.

Workspace starts and owns the in-browser queue coordination while the app is open. Jobs and results are in IndexedDB, so moving between books, Chat, Images, and Settings does not move or lose them. Each provider runs one request at a time; providers can run concurrently. Queue position and elapsed generation seconds are displayed. Browser Web Locks and transactional claims coordinate multiple tabs. Without Web Locks, transactional claims and stale heartbeat recovery prevent reusing an active claim.

**Clear queue** removes all listed generations, including earlier history, from the Generate view. It cancels queued work, stops local waiting for running jobs, and discards unkept images (also from their chat results). Kept gallery images and their chat attachments remain available. You are asked to confirm if there is active work or an unkept result. **Remove from queue** clears one finished job; **Discard** also removes an unwanted result from this view. Clearing persists across reloads and does not affect new jobs added after you click.

Keep the app open while generating. Mobile OS suspension or closing the browser can interrupt network activity; there is no server worker or background completion promise. Queued jobs resume on return. A recorded Pruna prediction ID resumes polling the existing request. Interrupted synchronous requests are **not** automatically resubmitted: **Retry as new generation** is an explicit new request that may incur another charge. **Stop waiting** aborts local waiting; it cannot guarantee provider cancellation or a refund. Provider IDs, keys, and pending requests are not included in book backups.

Provider errors remain visible with explicit retry controls and key redaction. Storage headroom is checked before starting a request, and jobs/results commit with ownership checks so a late response cannot restore a cancelled/deleted job. PNG/JPEG/WebP outputs are bounded to 20 MB and 40 megapixels. MP4/WebM outputs are bounded to 200 MB and receive a locally generated poster thumbnail. Storage estimates cannot guarantee that a later write will succeed.

## Gallery, deletion, and backups

The **All** Gallery scope includes kept generations from all books plus current uploaded Codex illustrations on this device. When Images has book context, **This book** filters by that source book. Images generated from the Library have no source book.

Open a Gallery thumbnail to access actions in the full-screen viewer. Download is always available. With book context, **Use in Codex** remains available only for still images. Videos use an inline player and cannot be attached as Codex illustrations.

Removing a result from chat hides only that attachment. Deleting a chat/book removes its jobs and unkept outputs, but kept generated images remain in the gallery. Deleting a generated image from the gallery removes its chat attachments too. Uploaded Codex illustrations retain their existing entry ownership and undo behavior. Forked chats share visible kept images; they do not copy running requests or authorize new generation.

Database v6 only adds `imageJobs` and `galleryImages` stores. Existing books, text, illustrations, and undo records retain their stores and identities. API keys remain in existing AI settings or the separate device image-settings record; they are never stored in jobs, image metadata, or chat proposals.

Image-only `.arcbook` backups remain version 2. Backups containing kept videos use version 3 and store the original MP4/WebM plus its poster. Source blobs, queued/running jobs, unkept results, provider IDs, ownership state, and API keys are excluded. Imports continue reading versions 1 and 2, create new identities, stale old proposals, and never submit generation.

## Verification

`node --test tests/*.test.mjs` covers schema upgrades and book creation, provider key fallback, favorite validation, no generation before explicit action, concurrent claims, cancellation/late writes, interruption recovery, provider request fixtures, gallery ownership, backups, and the rendered proposal → queue → keep → viewer flow. Existing mobile gesture tests continue to exercise the shared zoom/modal components. `npm run build` runs TypeScript and the production Vite build.
