export async function archiveContentHash(archive: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await archive.arrayBuffer())
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
