import type { BookEntity, BookMetadata, CodexDependencyEdge } from './persistence'

export const bookMetadataFields = ['title', 'seriesId', 'seriesOrder', 'overview', 'genre', 'writingStyle', 'pointOfView', 'tense', 'language'] as const
export const bookMetadataLabels: Record<keyof BookMetadata, string> = { title: 'Title', seriesId: 'Series', seriesOrder: 'Book in series', overview: 'Overview', genre: 'Genre', writingStyle: 'Writing style', pointOfView: 'Point of view', tense: 'Tense', language: 'Language' }
export type MetadataPatch = Partial<BookMetadata>
export type ChatManagementOperation =
  | { kind: 'metadata'; patch: MetadataPatch; before: MetadataPatch }
  | { kind: 'triggers'; triggers: string[]; before: string[] }
  | { kind: 'dependency'; action: 'create' | 'update' | 'remove'; targetId: string; relationLabel: string; includeWithSource: boolean; before: CodexDependencyEdge | null }
  | { kind: 'summary' }

export function metadataValues(book: BookEntity): BookMetadata {
  return Object.fromEntries(bookMetadataFields.map((field) => [field, typeof book[field] === 'string' ? book[field] : ''])) as BookMetadata
}

export function validateMetadataPatch(value: unknown): MetadataPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide a metadata changes object.')
  const entries = Object.entries(value)
  if (!entries.length || entries.some(([key, val]) => !bookMetadataFields.includes(key as keyof BookMetadata) || typeof val !== 'string')) throw new Error('Provide supported metadata fields with string values.')
  const patch = Object.fromEntries(entries.map(([key, val]) => [key, String(val).trim()])) as MetadataPatch
  if (patch.title !== undefined && !patch.title) throw new Error('The book title cannot be empty.')
  if (patch.seriesId === '') patch.seriesOrder = ''
  return patch
}
