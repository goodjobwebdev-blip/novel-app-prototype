import type { ArcEntity, BookEntity } from './persistence'
import { proseText } from './document-projection'

export type AuthorGoal = { id: string; title: string; description: string; targetWords?: number; completed: boolean }
export type AuthorTask = { id: string; title: string; notes: string; status: 'todo' | 'doing' | 'done'; goalId?: string; linkedEntityId?: string }
export type AuthorPlanning = { goals: AuthorGoal[]; tasks: AuthorTask[] }
export type AuthorPlanOperation = { kind: 'author_plan'; target: 'goal' | 'task'; item: AuthorGoal | AuthorTask; before: AuthorGoal | AuthorTask | null }
export const taskStatusLabels = { todo: 'To do', doing: 'Doing', done: 'Done' }
export const emptyAuthorPlanning = (): AuthorPlanning => ({ goals: [], tasks: [] })
export function authorPlanning(book: BookEntity): AuthorPlanning { return structuredClone(book.authorPlanning as AuthorPlanning ?? emptyAuthorPlanning()) }
export function manuscriptWords(entities: ArcEntity[], liveScene?: { id: string; content: string }) { return entities.filter(e => e.type === 'scene').reduce((sum, scene) => sum + (proseText(liveScene?.id === scene.id ? liveScene.content : String(scene.content ?? '')).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0), 0) }
const text = (value: unknown, label: string, maximum: number, required = false) => { if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new Error(`${label} must be ${required ? 'nonempty and ' : ''}at most ${maximum.toLocaleString()} characters.`); return value.trim() }
export function validateAuthorPlanning(value: AuthorPlanning, bookId: string, entities: ArcEntity[], previous: AuthorPlanning = emptyAuthorPlanning()): AuthorPlanning {
  if (!value || !Array.isArray(value.goals) || !Array.isArray(value.tasks) || value.goals.length > 1000 || value.tasks.length > 5000) throw new Error('Provide a valid list of goals and tasks (up to 1,000 goals and 5,000 tasks).')
  const ids = new Set<string>()
  const id = (value: string) => { if (typeof value !== 'string' || !value || ids.has(value)) throw new Error('Goals and tasks need distinct stable IDs.'); ids.add(value); return value }
  const goals = value.goals.map(goal => {
    if (typeof goal.completed !== 'boolean' || (goal.targetWords !== undefined && (!Number.isSafeInteger(goal.targetWords) || goal.targetWords <= 0))) throw new Error('Choose a positive whole word target, or leave it empty.')
    return { id: id(goal.id), title: text(goal.title, 'Goal title', 160, true), description: text(goal.description, 'Goal description', 10000), ...(goal.targetWords === undefined ? {} : { targetWords: goal.targetWords }), completed: goal.completed }
  })
  if (goals.filter(goal => !goal.completed).length > 1) throw new Error('Complete the active goal before starting another.')
  const tasks = value.tasks.map(task => {
    if (!Object.hasOwn(taskStatusLabels, task.status)) throw new Error('Choose To do, Doing or Done.')
    if ([task.goalId, task.linkedEntityId].some(value => value !== undefined && typeof value !== 'string')) throw new Error('Task links must be stable IDs or empty.')
    const old = previous.tasks.find(item => item.id === task.id)
    const goalId = task.goalId || undefined, linkedEntityId = task.linkedEntityId || undefined
    if (goalId && old?.goalId !== goalId && !goals.some(goal => goal.id === goalId && !goal.completed)) throw new Error('Group a task under the active goal, or leave it ungrouped.')
    if (linkedEntityId && old?.linkedEntityId !== linkedEntityId && !entities.some(entity => entity.id === linkedEntityId && entity.bookId === bookId && ['scene', 'chapter', 'note', 'codexEntry'].includes(entity.type) && !entity.hiddenInBook)) throw new Error('Choose an available Scene, Chapter, Note or Codex entry in this book.')
    return { id: id(task.id), title: text(task.title, 'Task title', 160, true), notes: text(task.notes, 'Task notes', 10000), status: task.status, ...(goalId ? { goalId } : {}), ...(linkedEntityId ? { linkedEntityId } : {}) }
  })
  return { goals, tasks }
}
export function applyAuthorPlanOperation(current: AuthorPlanning, op: AuthorPlanOperation, bookId: string, entities: ArcEntity[]) {
  if (!['goal', 'task'].includes(op.target) || !op.item?.id) throw new Error('Invalid planning target.')
  const next = structuredClone(current), key = op.target === 'goal' ? 'goals' : 'tasks'
  const existing = current[key].find(item => item.id === op.item.id) ?? null
  if (JSON.stringify(existing) !== JSON.stringify(op.before)) throw new Error('This goal or task changed. Request a fresh proposal.')
  if (existing) (next[key] as Array<AuthorGoal | AuthorTask>).splice(next[key].findIndex(item => item.id === existing.id), 1, structuredClone(op.item))
  else (next[key] as Array<AuthorGoal | AuthorTask>).push(structuredClone(op.item))
  return validateAuthorPlanning(next, bookId, entities, current)
}
export function authorPlanChanges(op: AuthorPlanOperation) { return [{ field: op.target === 'goal' ? 'Author goal' : 'Author task', before: op.before ? JSON.stringify(op.before, null, 2) : 'New item', after: JSON.stringify(op.item, null, 2) }] }
