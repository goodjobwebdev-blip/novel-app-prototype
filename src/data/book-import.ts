import { copyBookArchive, decodeBookArchive } from './book-archive'
import { writeBookArchive } from './persistence'
import { checkStorageHeadroom } from '../features/images/illustration-image'

export async function importBookArchiveBlob(file: Blob): Promise<string> {
  const archive = await decodeBookArchive(file)
  await checkStorageHeadroom(file.size)
  const copy = copyBookArchive(archive)
  await writeBookArchive(copy.data)
  return copy.bookId
}
