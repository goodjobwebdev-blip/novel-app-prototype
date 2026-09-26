/** Image processing stays outside database transactions. Only optimized pixels are kept. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export type ImageDetails = { caption: string; alt: string; cropX: number; cropY: number; cropZoom?: number }
export type ImagePixels = { image: Blob; thumbnail: Blob; width: number; height: number }

export function fitImage(width: number, height: number, longest = 1600) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('Choose an image smaller than 40 megapixels.')
  }
  const scale = Math.min(1, longest / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function cropRectangle(width: number, height: number, x: number, y: number, zoom = 1) {
  const size = Math.min(width, height) / Math.max(1, Math.min(4, zoom))
  return { x: (width - size) * Math.max(0, Math.min(100, x)) / 100, y: (height - size) * Math.max(0, Math.min(100, y)) / 100, size }
}

export async function assertImageFile(file: Blob) {
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error('Choose a PNG, JPEG, or WebP image up to 20 MB.')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('This file is not a supported PNG, JPEG, or WebP image.')
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode this image.')), 'image/webp', quality))
}

export async function makeThumbnail(blob: Blob, cropX = 50, cropY = 50, cropZoom = 1): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const crop = cropRectangle(bitmap.width, bitmap.height, cropX, cropY, cropZoom)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 160
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image processing is unavailable in this browser.')
    ctx.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, 160, 160)
    return await canvasBlob(canvas, .78)
  } finally { bitmap.close() }
}

export async function prepareIllustration(file: Blob): Promise<ImagePixels> {
  await assertImageFile(file)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('This image could not be opened. Try another PNG, JPEG, or WebP file.') }
  try {
    const dimensions = fitImage(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image processing is unavailable in this browser.')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    let image = await canvasBlob(canvas, .86)
    for (const quality of [.72, .58]) {
      if (image.size <= 500_000) break
      image = await canvasBlob(canvas, quality)
    }
    // Encoding is a target, not a promise: preserve detail and transparency when larger.
    const thumbnail = await makeThumbnail(image)
    return { image, thumbnail, ...dimensions }
  } finally { bitmap.close() }
}

export function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`
}

export async function checkStorageHeadroom(bytes: number) {
  if (!navigator.storage?.estimate) return
  let estimate: StorageEstimate
  try { estimate = await navigator.storage.estimate() } catch { return }
  if (estimate.quota && (estimate.usage ?? 0) + bytes + 10_000_000 > estimate.quota) {
    throw new Error('Storage is nearly full. Export a backup and free some space before adding images.')
  }
}

export function imageStorageError(error: unknown) {
  return error instanceof Error && error.name === 'QuotaExceededError'
    ? 'There is not enough browser storage. Your previous illustration is unchanged. Export a backup and free some space.'
    : error instanceof Error ? error.message : 'The illustration could not be saved.'
}
