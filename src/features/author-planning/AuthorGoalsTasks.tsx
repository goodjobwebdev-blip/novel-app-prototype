import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { ArcEntity } from '../../data/persistence'
import Button from '../../shared/ui/Button'
import Disclosure from '../../shared/ui/Disclosure'
import ExpandableTextInput from '../../shared/ui/ExpandableTextInput'
import Input from '../../shared/ui/Input'
import ProgressBar from '../../shared/ui/ProgressBar'
import Select from '../../shared/ui/Select'
import { emptyAuthorPlanning, manuscriptWords, taskStatusLabels, type AuthorGoal, type AuthorTask, type AuthorPlanning } from './author-planning'
import { readAuthorPlanning, saveAuthorPlanning } from './author-planning-service'

export default function AuthorGoalsTasks({ bookId, liveScene, onOpen }: { bookId: string; liveScene?: { id: string; content: string }; onOpen: (id: string) => void }) {
  const [planning, setPlanning] = useState<AuthorPlanning>(emptyAuthorPlanning)
  const [entities, setEntities] = useState<ArcEntity[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState('all')
  const [goal, setGoal] = useState<AuthorGoal>()
  const [task, setTask] = useState<AuthorTask>()
  const [draftBase, setDraftBase] = useState<AuthorPlanning>()
  const [target, setTarget] = useState('')

  const accept = (value: Awaited<ReturnType<typeof readAuthorPlanning>>) => {
    setPlanning(value.planning)
    setEntities(value.entities)
    setLoaded(true)
  }

  useEffect(() => {
    let alive = true
    const refresh = () => {
      void readAuthorPlanning(bookId).then(value => {
        if (alive) accept(value)
      }).catch(e => {
        if (alive) setError(e.message)
      })
    }
    refresh()
    window.addEventListener('arc-entity-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('arc-entity-changed', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [bookId, liveScene?.id])

  const active = planning.goals.find(item => !item.completed)
  const words = manuscriptWords(entities, liveScene)
  const visibleTasks = planning.tasks.filter(item => filter === 'all' || item.status === filter)
  const completedGoals = planning.goals.filter(item => item.completed)
  const links = entities.filter(entity => ['scene', 'chapter', 'note', 'codexEntry'].includes(entity.type) && !entity.hiddenInBook)

  async function save(next: AuthorPlanning, expected = planning) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      accept(await saveAuthorPlanning(bookId, expected, next))
      setGoal(undefined)
      setTask(undefined)
      setDraftBase(undefined)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function editGoal(value: AuthorGoal) {
    setTask(undefined)
    setGoal(structuredClone(value))
    setTarget(String(value.targetWords ?? ''))
    setDraftBase(structuredClone(planning))
    setError('')
  }

  function editTask(value: AuthorTask) {
    setGoal(undefined)
    setTask(structuredClone(value))
    setDraftBase(structuredClone(planning))
    setError('')
  }

  function move(id: string, delta: number) {
    const tasks = [...planning.tasks]
    const index = tasks.findIndex(item => item.id === id)
    const destination = index + delta
    if (destination < 0 || destination >= tasks.length) return
    ;[tasks[index], tasks[destination]] = [tasks[destination], tasks[index]]
    void save({ ...planning, tasks })
  }

  function submitDraft() {
    if (!draftBase) return
    if (goal) {
      const item = { ...goal, targetWords: target.trim() ? Number(target) : undefined }
      void save({
        ...draftBase,
        goals: draftBase.goals.some(candidate => candidate.id === goal.id)
          ? draftBase.goals.map(candidate => candidate.id === goal.id ? item : candidate)
          : [...draftBase.goals, item],
      }, draftBase)
      return
    }
    if (task) {
      void save({
        ...draftBase,
        tasks: draftBase.tasks.some(candidate => candidate.id === task.id)
          ? draftBase.tasks.map(candidate => candidate.id === task.id ? task : candidate)
          : [...draftBase.tasks, task],
      }, draftBase)
    }
  }

  return <Disclosure
    className="author-planning"
    open
    eyebrow="Planning"
    title="Goals & tasks"
    description={active ? active.title : `${words.toLocaleString()} manuscript words`}
  >
    <div className="author-planning-content">
      {active ? <section className="author-active-goal">
        <header><small>Current goal</small><strong>{active.title}</strong></header>
        {active.description && <p>{active.description}</p>}
        {active.targetWords && <ProgressBar label={`${words.toLocaleString()} of ${active.targetWords.toLocaleString()} manuscript words`} value={Math.min(words, active.targetWords)} max={active.targetWords} />}
        <div className="author-actions">
          <Button size="small" variant="ghost" disabled={busy} onClick={() => editGoal(active)}>Edit goal</Button>
          <Button size="small" disabled={busy} onClick={() => { void save({ ...planning, goals: planning.goals.map(item => item.id === active.id ? { ...item, completed: true } : item) }) }}>Complete goal</Button>
        </div>
      </section> : <section className="author-empty-goal">
        <p>Set a writing goal to track progress for this book.</p>
        <Button size="small" disabled={busy || !loaded} onClick={() => editGoal({ id: `goal-${crypto.randomUUID()}`, title: '', description: '', completed: false })}>New goal</Button>
      </section>}

      <p className="author-help">{active?.targetWords ? 'Progress counts manuscript prose. Goals are completed explicitly.' : `${words.toLocaleString()} manuscript words. Goals are completed explicitly.`}</p>

      <div className="author-task-toolbar">
        <Button size="small" disabled={busy || !loaded} onClick={() => editTask({ id: `task-${crypto.randomUUID()}`, title: '', notes: '', status: 'todo' })}>New task</Button>
        <Select aria-label="Filter author tasks" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All tasks</option>
          {Object.entries(taskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </div>

      <ol className="author-task-list">{visibleTasks.map(item => {
        const link = links.find(entity => entity.id === item.linkedEntityId)
        return <li key={item.id}>
          <div className="author-task-copy"><strong>{item.title}</strong>{item.notes && <p>{item.notes}</p>}{item.goalId && <small>{planning.goals.find(candidate => candidate.id === item.goalId)?.title || 'Unavailable goal'}</small>}</div>
          {item.linkedEntityId && (link ? <Button className="author-task-link" size="small" variant="ghost" onClick={() => onOpen(link.id)}>{link.title} · {link.type === 'codexEntry' ? 'Codex' : link.type}</Button> : <small>Unavailable linked item</small>)}
          <div className="author-task-actions">
            <Select aria-label={`Status: ${item.title}`} disabled={busy} value={item.status} onChange={event => { void save({ ...planning, tasks: planning.tasks.map(candidate => candidate.id === item.id ? { ...candidate, status: event.target.value as AuthorTask['status'] } : candidate) }) }}>
              {Object.entries(taskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Button size="small" variant="ghost" disabled={busy} onClick={() => editTask(item)}>Edit</Button>
            <Button className="author-icon-action" size="small" variant="ghost" aria-label={`Move ${item.title} up`} disabled={busy || planning.tasks[0].id === item.id} onClick={() => move(item.id, -1)} leadingIcon={<ArrowUp />} />
            <Button className="author-icon-action" size="small" variant="ghost" aria-label={`Move ${item.title} down`} disabled={busy || planning.tasks.at(-1)?.id === item.id} onClick={() => move(item.id, 1)} leadingIcon={<ArrowDown />} />
            <Button className="author-icon-action" size="small" variant="ghost" aria-label={`Delete ${item.title}`} disabled={busy} onClick={() => { if (window.confirm(`Delete task “${item.title}”?`)) void save({ ...planning, tasks: planning.tasks.filter(candidate => candidate.id !== item.id) }) }} leadingIcon={<Trash2 />} />
          </div>
        </li>
      })}</ol>
      {!visibleTasks.length && <p className="author-empty-tasks">No tasks in this view.</p>}

      {(goal || task) && <form className="author-draft" onSubmit={event => { event.preventDefault(); submitDraft() }}>
        <fieldset disabled={busy}>
          <legend>{goal ? 'Goal' : 'Task'} details</legend>
          <Input label="Title" required maxLength={160} value={goal?.title ?? task?.title ?? ''} onChange={event => goal ? setGoal({ ...goal, title: event.target.value }) : setTask({ ...task!, title: event.target.value })} />
          <label className="author-expandable-field"><span>{goal ? 'Description' : 'Notes'}</span><ExpandableTextInput value={goal?.description ?? task?.notes ?? ''} onChange={value => goal ? setGoal({ ...goal, description: value }) : setTask({ ...task!, notes: value })} aria-label={goal ? 'Goal description' : 'Task notes'} dialogTitle={goal ? 'Edit goal description' : 'Edit task notes'} /></label>
          {goal && <Input label="Target manuscript words (optional)" type="number" min="1" step="1" value={target} onChange={event => setTarget(event.target.value)} />}
          {task && <>
            <Select label="Goal" value={task.goalId ?? ''} onChange={event => setTask({ ...task, goalId: event.target.value || undefined })}><option value="">No goal</option>{planning.goals.filter(item => !item.completed || task.goalId === item.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>
            <Select label="Linked item" value={task.linkedEntityId ?? ''} onChange={event => setTask({ ...task, linkedEntityId: event.target.value || undefined })}><option value="">No link</option>{task.linkedEntityId && !links.some(item => item.id === task.linkedEntityId) && <option value={task.linkedEntityId}>Unavailable linked item</option>}{links.map(item => <option key={item.id} value={item.id}>{item.title} · {item.type}</option>)}</Select>
          </>}
          <div className="author-actions author-draft-actions"><Button size="small" variant="ghost" onClick={() => { setGoal(undefined); setTask(undefined) }}>Cancel</Button><Button size="small" variant="primary" type="submit">Save {goal ? 'goal' : 'task'}</Button></div>
        </fieldset>
      </form>}

      {completedGoals.length > 0 && <Disclosure className="author-completed" title={`Completed goals · ${completedGoals.length}`}>{completedGoals.map(item => <p key={item.id}><strong>{item.title}</strong>{item.description && ` — ${item.description}`}</p>)}</Disclosure>}
      {error && <p className="author-error" role="alert">{error}</p>}
    </div>
  </Disclosure>
}
