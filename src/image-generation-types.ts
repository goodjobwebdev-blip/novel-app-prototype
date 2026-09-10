export type ImageProvider = 'nanogpt' | 'openai' | 'pruna'
export type OpenAIImageQuality = 'low' | 'medium' | 'high' | 'auto'
export type OpenAIImageModeration = 'low' | 'auto'
// Optional for favorites and jobs saved before these controls were added.
export type OpenAIImageOptions = { quality?: OpenAIImageQuality; moderation?: OpenAIImageModeration }
export type ImageSize = { value: string; width: number; height: number }
export type ImageModel = { id: string; name: string; provider: ImageProvider; sizes: ImageSize[]; source: string }
export type FavoriteImageModel = ImageModel & OpenAIImageOptions & { alias: string; enabledSizes: string[]; defaultSize: string }
export type ImageSettings = { keys: Record<ImageProvider, string>; favorites: FavoriteImageModel[]; defaultAlias: string }
export type ImageGenerationSpec = OpenAIImageOptions & { prompt: string; modelAlias: string; provider: ImageProvider; model: string; size: ImageSize }
export type ChatImageProposal = {
  id: string; prompt: string; modelAlias: string; size: string
  status: 'proposed' | 'accepted' | 'rejected' | 'stale'; createdAt: number
}
export type ImageJob = ImageGenerationSpec & {
  id: string; bookId?: string; bookTitle?: string; chatId?: string; messageId?: string; proposalId?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
  createdAt: number; startedAt?: number; completedAt?: number; error?: string
  assetId?: string; decision?: 'kept' | 'discarded'; hiddenInChat?: boolean
  providerJobId?: string; owner?: string; heartbeat?: number
}
export type GalleryImage = {
  id: string; bookId?: string; bookTitle?: string; prompt: string; provider?: ImageProvider; model?: string; modelAlias?: string
  requestedSize?: string; width: number; height: number; createdAt: number; durationMs?: number
  seed?: number; cost?: number; revisedPrompt?: string; kept: boolean
  image: Blob; thumbnail: Blob
  // Existing Codex uploads remain in their original store and are shown in the gallery too.
  entryId?: string; illustrationId?: string
}
