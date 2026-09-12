export type ImageProvider = 'nanogpt' | 'openai' | 'pruna'
export type GenerationTask = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'
export type MediaKind = 'image' | 'video'
export type OpenAIImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto'
export type OpenAIImageModeration = 'low' | 'auto'
// Optional for favorites and jobs saved before these controls were added.
export type OpenAIImageOptions = { quality?: OpenAIImageQuality; moderation?: OpenAIImageModeration }
export type ImageSize = { value: string; width: number; height: number }
export type GenerationSource = {
  id: string
  name?: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  data: Blob
  width: number
  height: number
}
export type VideoGenerationOptions = {
  resolution?: string
  duration?: number
  aspectRatio?: string
  fps?: number
  numFrames?: number
  seed?: number
  draft?: boolean
}
export type ImageModel = {
  id: string
  name: string
  provider: ImageProvider
  sizes: ImageSize[]
  source: string
  cost?: number
  description?: string
  tasks?: GenerationTask[]
  maxSourceImages?: number
  videoResolutions?: string[]
  videoDurations?: number[]
  aspectRatios?: string[]
}
export type FavoriteImageModel = ImageModel & OpenAIImageOptions & { alias: string; enabledSizes: string[]; defaultSize: string }
export type ImageSettings = {
  keys: Record<ImageProvider, string>
  favorites: FavoriteImageModel[]
  defaultAlias: string
  defaultAliases?: Partial<Record<GenerationTask, string>>
}
export type ImageGenerationSpec = OpenAIImageOptions & {
  prompt: string
  modelAlias: string
  provider: ImageProvider
  model: string
  size: ImageSize
  task?: GenerationTask
  sources?: GenerationSource[]
  video?: VideoGenerationOptions
}
export type MediaGenerationDraft = {
  enhancedPrompt?: string
  enhancementGuidance?: string
  enhancementTemplate?: string
  enhancementFingerprint?: string
  enhancementMode?: 'standard' | 'guided'
  promptSelection?: 'original' | 'enhanced'
  prompt: string
  alias: string
  size: string
  task?: GenerationTask
  sources?: GenerationSource[]
  resolution?: string
  duration?: number
  aspectRatio?: string
  fps?: number
  numFrames?: number
  seed?: number
  draftVideo?: boolean
}
export type ChatImageProposal = {
  id: string; prompt: string; modelAlias: string; size: string
  draft?: MediaGenerationDraft
  task?: GenerationTask
  status: 'proposed' | 'accepted' | 'rejected' | 'stale'; createdAt: number
}
export type ImageJob = ImageGenerationSpec & {
  directUserMessageId?: string
  id: string; bookId?: string; bookTitle?: string; chatId?: string; messageId?: string; proposalId?: string; submissionId?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
  createdAt: number; startedAt?: number; completedAt?: number; error?: string
  assetId?: string; decision?: 'kept' | 'discarded'; hiddenInChat?: boolean; hiddenInQueue?: boolean
  providerJobId?: string; owner?: string; heartbeat?: number
}
export type GalleryImage = {
  id: string; bookId?: string; bookTitle?: string; prompt: string; provider?: ImageProvider; model?: string; modelAlias?: string
  requestedSize?: string; width: number; height: number; createdAt: number; durationMs?: number
  seed?: number; cost?: number; revisedPrompt?: string; kept: boolean
  image: Blob; thumbnail: Blob
  kind?: MediaKind
  task?: GenerationTask
  mediaDurationMs?: number
  sourceIds?: string[]
  // Existing Codex uploads remain in their original store and are shown in the gallery too.
  entryId?: string; illustrationId?: string
}

export function generationTask(spec: Pick<ImageGenerationSpec, 'task'>): GenerationTask {
  return spec.task ?? 'text-to-image'
}

export function outputKind(spec: Pick<ImageGenerationSpec, 'task'>): MediaKind {
  return generationTask(spec).endsWith('video') ? 'video' : 'image'
}

export function modelTasks(model: Pick<ImageModel, 'tasks'>): GenerationTask[] {
  return model.tasks?.length ? model.tasks : ['text-to-image']
}
