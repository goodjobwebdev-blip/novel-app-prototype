import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, Bot, BrainCircuit, Check, ChevronDown, ImagePlus, MessageCircle, Mic, Palette, Plus, Redo2, RefreshCw, Search, SlidersHorizontal, Sparkles, Trash2, Undo2, Volume2, Zap } from 'lucide-react'
import { builtInThemes, defaultUiSettings, loadUiSettings, saveUiSettings, UI_SETTINGS_EVENT, type UiSettings, type UiTypography } from '../../features/settings/ui-settings'
import Button from './Button'
import Card from './Card'
import Checkbox from './Checkbox'
import ExpandableTextInput from './ExpandableTextInput'
import GenerationActions from './GenerationActions'
import Input from './Input'
import ProgressBar from './ProgressBar'
import RadioGroup from './RadioGroup'
import SearchableSelect from './SearchableSelect'
import Select from './Select'
import Tabs from './Tabs'
import Toast, { type ToastVariant } from './Toast'
import TypographyControls from './TypographyControls'
import './ui-kit.css'

export default function UiKitScreen({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<UiSettings>(() => loadUiSettings())
  const [saveError, setSaveError] = useState('')
  const [sampleTitle, setSampleTitle] = useState('The City Beneath the Tide')
  const [samplePrompt, setSamplePrompt] = useState('Continue the scene with a quiet discovery near the flooded archive.')
  const [lastAction, setLastAction] = useState('No action selected')
  const [sampleModel, setSampleModel] = useState('openrouter/anthropic/claude-sonnet-4')
  const [sampleRole, setSampleRole] = useState('writing')
  const [sampleAuthor, setSampleAuthor] = useState('Mara Voss')
  const [sampleChapters, setSampleChapters] = useState('12')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [narrativePerson, setNarrativePerson] = useState('third')
  const [sampleTab, setSampleTab] = useState('story')
  const [demoToast, setDemoToast] = useState<ToastVariant | null>(null)

  useEffect(() => {
    const sync = (event: Event) => setSettings((event as CustomEvent<UiSettings>).detail ?? loadUiSettings())
    window.addEventListener(UI_SETTINGS_EVENT, sync)
    return () => window.removeEventListener(UI_SETTINGS_EVENT, sync)
  }, [])

  function selectTheme(activeThemeId: string) {
    try {
      const next = saveUiSettings({ ...settings, activeThemeId })
      setSettings(next)
      setSaveError('')
    } catch {
      setSaveError('Theme could not be saved on this device.')
    }
  }

  function updateTypography(scope: 'editor' | 'inputs', value: UiTypography) {
    try {
      const next = saveUiSettings({ ...settings, [scope]: value })
      setSettings(next)
      setSaveError('')
    } catch {
      setSaveError('Typography could not be saved on this device.')
    }
  }

  const themes = [...builtInThemes, ...settings.customThemes.map(theme => ({ ...theme, tone: 'dark' as const }))]

  return <main className="ui-kit-screen">
    <header className="ui-kit-topbar">
      <Button variant="ghost" leadingIcon={<ArrowLeft />} onClick={onBack}>Library</Button>
      <div><Palette aria-hidden="true" /><span>ARC UI KIT</span></div>
      <span className="ui-kit-status">Internal</span>
    </header>

    <div className="ui-kit-content">
      <header className="ui-kit-heading">
        <div><small>Design system</small><h1>Component gallery</h1><p>The shared components below use the same themes and tokens as the application.</p></div>
        <span>{settings.inputs.fontFamily} · {settings.inputs.fontSize}px</span>
      </header>

      <Card eyebrow="Theme tester" title="Themes" description="Changes are applied globally and saved using the existing Appearance settings.">
        <div className="ui-kit-themes" role="group" aria-label="Select theme">
          {themes.map(theme => <button key={theme.id} className={settings.activeThemeId === theme.id ? 'selected' : ''} type="button" onClick={() => selectTheme(theme.id)} aria-pressed={settings.activeThemeId === theme.id}>
            <i style={{ background: theme.palette.background, borderColor: theme.palette.border }}><b style={{ background: theme.palette.accent }} /></i>
            <span>{theme.name}</span>
            {settings.activeThemeId === theme.id && <Check aria-hidden="true" />}
          </button>)}
        </div>
        {saveError && <p className="ui-kit-error" role="alert">{saveError}</p>}
      </Card>

      <section className="ui-kit-section" aria-labelledby="ui-kit-buttons">
        <header><small>01</small><div><h2 id="ui-kit-buttons">Buttons</h2><p>Semantic variants, three sizes, and common interaction states.</p></div></header>
        <Card variant="outlined">
          <div className="ui-kit-row">
            <Button variant="primary" leadingIcon={<Plus />}>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" leadingIcon={<Trash2 />}>Delete</Button>
          </div>
          <div className="ui-kit-row">
            <Button size="small">Small</Button>
            <Button size="medium">Medium</Button>
            <Button size="large">Large</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Card>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-inputs">
        <header><small>02</small><div><h2 id="ui-kit-inputs">Inputs</h2><p>Labels, descriptions, validation, icons, and disabled state.</p></div></header>
        <Card variant="outlined">
          <div className="ui-kit-input-grid">
            <Input label="Book title" value={sampleTitle} onChange={event => setSampleTitle(event.target.value)} description="Shown in the library and workspace." />
            <Input label="Search" leadingIcon={<Search />} placeholder="Search components" type="search" />
            <Input label="API key" error="An API key is required." placeholder="Enter API key" type="password" />
            <Input label="Unavailable field" value="Disabled value" disabled readOnly />
          </div>
        </Card>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-cards">
        <header><small>03</small><div><h2 id="ui-kit-cards">Cards</h2><p>Shared containers for settings, grouped content, and elevated surfaces.</p></div></header>
        <div className="ui-kit-card-grid">
          <Card eyebrow="Default" title="Standard card" description="The normal container for grouped application content."><p>Use this for most sections before adding another visual variant.</p></Card>
          <Card variant="elevated" eyebrow="Elevated" title="Raised card" description="Reserved for content that must sit above its surroundings." action={<Button size="small">Action</Button>}><p>Elevation communicates hierarchy, not decoration.</p></Card>
          <Card variant="outlined" eyebrow="Outlined" title="Quiet card" description="A lower-emphasis boundary with no filled surface."><p>Useful inside another card or on a stable background.</p></Card>
        </div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-expandable">
        <header><small>04</small><div><h2 id="ui-kit-expandable">Expandable elements</h2><p>Current disclosure, editor, collapsible surface, and action-menu patterns.</p></div></header>
        <div className="ui-kit-expandable-grid">
          <Card variant="outlined" eyebrow="Disclosure" title="Accordion">
            <details className="ui-kit-disclosure">
              <summary><span><strong>Advanced settings</strong><small>Optional controls and supporting information.</small></span><ChevronDown aria-hidden="true" /></summary>
              <div><p>Expanded content stays visually connected to its trigger and remains keyboard accessible.</p><Input label="Context limit" value="32,000" readOnly /></div>
            </details>
          </Card>

          <Card variant="outlined" eyebrow="Editor" title="Expandable text field">
            <p className="ui-kit-example-copy">Use the expand icon to open the same full-screen editor used by generation prompts.</p>
            <ExpandableTextInput value={samplePrompt} onChange={setSamplePrompt} aria-label="Sample generation prompt" dialogTitle="Edit sample generation prompt" />
          </Card>

          <details className="ui-kit-collapsible-card">
            <summary><span><small>Collapsible card</small><strong>Request details</strong></span><ChevronDown aria-hidden="true" /></summary>
            <div><p>Use this when the entire surface is optional and should be hidden until requested.</p><code>Model · context · message stack</code></div>
          </details>

          <Card variant="outlined" eyebrow="Popover" title="Quick actions">
            <p className="ui-kit-example-copy">Open the menu to inspect the existing compact action pattern.</p>
            <div className="ui-kit-popover-demo">
              <span aria-live="polite">{lastAction}</span>
              <GenerationActions label="Run" menuAlign="end" shape="square" onGenerate={() => setLastAction('Run main action')} actions={[
                { id: 'image', label: 'Insert image', icon: <ImagePlus aria-hidden="true" />, onSelect: () => setLastAction('Insert image') },
                { id: 'instruction', label: 'Dictate instruction', icon: <Mic aria-hidden="true" />, onSelect: () => setLastAction('Dictate instruction') },
                { id: 'regenerate', label: 'Regenerate', icon: <RefreshCw aria-hidden="true" />, onSelect: () => setLastAction('Regenerate') },
                { id: 'read', label: 'Read aloud', icon: <Volume2 aria-hidden="true" />, onSelect: () => setLastAction('Read aloud') },
                { id: 'undo', label: 'Undo', icon: <Undo2 aria-hidden="true" />, onSelect: () => setLastAction('Undo') },
                { id: 'redo', label: 'Redo', icon: <Redo2 aria-hidden="true" />, onSelect: () => setLastAction('Redo') },
                { id: 'disabled', label: 'Unavailable action', icon: <Trash2 aria-hidden="true" />, onSelect: () => {}, disabled: true },
              ]} />
            </div>
          </Card>
        </div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-form-controls">
        <header><small>05</small><div><h2 id="ui-kit-form-controls">Form controls</h2><p>Selection controls for searchable or metadata-rich option lists.</p></div></header>
        <Card variant="outlined" eyebrow="Searchable select" title="Model picker" description="Search and select directly. Mobile opens a modal; desktop opens an anchored dropdown.">
          <div className="ui-kit-form-example">
            <SearchableSelect
              label="Writing model"
              value={sampleModel}
              onChange={setSampleModel}
              searchPlaceholder="Search models, providers, or capabilities"
              description="The selected model is applied immediately."
              options={[
                { value: 'openrouter/anthropic/claude-sonnet-4', title: 'Claude Sonnet 4', subtitle: 'Anthropic · OpenRouter', leadingIcon: <BrainCircuit aria-hidden="true" />, meta: '$3 / $15', badges: ['Text', 'Tools', '200K'] },
                { value: 'openai/gpt-5', title: 'GPT-5', subtitle: 'OpenAI', leadingIcon: <Sparkles aria-hidden="true" />, meta: '$1.25 / $10', badges: ['Text', 'Vision', 'Tools'] },
                { value: 'google/gemini-2.5-pro', title: 'Gemini 2.5 Pro', subtitle: 'Google · OpenRouter', leadingIcon: <Zap aria-hidden="true" />, meta: '$1.25 / $10', badges: ['Text', 'Vision', '1M'] },
                { value: 'local/test-model', title: 'Local test model', subtitle: 'Fake provider · No network', leadingIcon: <Bot aria-hidden="true" />, meta: 'Free', badges: ['Testing'] },
                { value: 'legacy/unavailable', title: 'Unavailable legacy model', subtitle: 'No longer offered by this provider', leadingIcon: <Bot aria-hidden="true" />, disabled: true },
              ]}
            />
            <Select label="Model role" value={sampleRole} onChange={event => setSampleRole(event.target.value)} description="Use a simple select for short lists.">
              <option value="writing">Writing</option>
              <option value="support">Support</option>
              <option value="chat">Chat</option>
              <option value="image">Image</option>
            </Select>
          </div>
        </Card>
        <Card variant="outlined" eyebrow="Basic controls" title="Inputs and choices" description="Use native semantics with the same shared visual tokens.">
          <div className="ui-kit-basic-form-grid">
            <Input label="Author name" value={sampleAuthor} onChange={event => setSampleAuthor(event.target.value)} placeholder="Enter a name" />
            <Input label="Planned chapters" type="number" min="1" value={sampleChapters} onChange={event => setSampleChapters(event.target.value)} description="Whole numbers only." />
            <div className="ui-kit-choice-stack">
              <span>Checkboxes</span>
              <Checkbox label="Include current summary" description="Adds the latest summary to generation context." checked={includeSummary} onChange={event => setIncludeSummary(event.target.checked)} />
              <Checkbox label="Unavailable option" description="Disabled state." disabled />
            </div>
            <RadioGroup label="Narrative person" name="sample-narrative-person" value={narrativePerson} onChange={setNarrativePerson} options={[
              { value: 'first', label: 'First person', description: 'I crossed the empty room.' },
              { value: 'third', label: 'Third person', description: 'She crossed the empty room.' },
              { value: 'second', label: 'Second person', description: 'You crossed the empty room.', disabled: true },
            ]} />
          </div>
        </Card>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-tabs">
        <header><small>06</small><div><h2 id="ui-kit-tabs">Tabs</h2><p>Switch between related views without leaving the current context.</p></div></header>
        <Card variant="outlined">
          <Tabs label="Workspace views" value={sampleTab} onChange={setSampleTab} items={[
            { value: 'story', label: 'Story', icon: <BookOpen aria-hidden="true" /> },
            { value: 'chat', label: 'Chat', icon: <MessageCircle aria-hidden="true" /> },
            { value: 'settings', label: 'Settings', icon: <SlidersHorizontal aria-hidden="true" /> },
            { value: 'disabled', label: 'Disabled', disabled: true },
          ]} />
          <div className="ui-kit-tab-panel" role="tabpanel">Active view: <strong>{sampleTab}</strong></div>
        </Card>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-progress">
        <header><small>07</small><div><h2 id="ui-kit-progress">Progress bars</h2><p>Default and semantic progress states.</p></div></header>
        <Card variant="outlined">
          <div className="ui-kit-progress-grid">
            <ProgressBar label="Generating chapter" value={42} />
            <ProgressBar label="Saved successfully" value={100} variant="success" />
            <ProgressBar label="Context budget" value={78} variant="warning" />
            <ProgressBar label="Storage limit" value={94} variant="error" />
          </div>
        </Card>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-toasts">
        <header><small>08</small><div><h2 id="ui-kit-toasts">Warnings and toasts</h2><p>Success, warning, and error feedback with optional dismissal.</p></div></header>
        <Card variant="outlined">
          <div className="ui-kit-toast-grid">
            <Toast variant="success" title="Changes saved">Your appearance settings are up to date.</Toast>
            <Toast variant="warning" title="Context nearly full">This request uses 82% of the available context.</Toast>
            <Toast variant="error" title="Generation failed">The provider did not return a response.</Toast>
          </div>
          <div className="ui-kit-row ui-kit-toast-actions">
            <Button size="small" onClick={() => setDemoToast('success')}>Show success</Button>
            <Button size="small" onClick={() => setDemoToast('warning')}>Show warning</Button>
            <Button size="small" variant="danger" onClick={() => setDemoToast('error')}>Show error</Button>
          </div>
        </Card>
      </section>
      {demoToast && <Toast fixed duration={5000} variant={demoToast} title={demoToast === 'success' ? 'Changes saved' : demoToast === 'warning' ? 'Check this request' : 'Something went wrong'} onDismiss={() => setDemoToast(null)}>{demoToast === 'success' ? 'Your changes were saved successfully.' : demoToast === 'warning' ? 'Review the context before continuing.' : 'Please try again or check the provider settings.'}</Toast>}

      <section className="ui-kit-section" aria-labelledby="ui-kit-typography">
        <header><small>09</small><div><h2 id="ui-kit-typography">Typography</h2><p>Responsive type roles for mobile and desktop application UI.</p></div></header>
        <Card variant="outlined" eyebrow="Playground" title="User-controlled typography" description="These are the same two typography scopes available in Appearance settings. Only their matching previews change.">
          <div className="ui-kit-typography-controls">
            <TypographyControls title="Main editor" description="Scenes, notes, Codex entries, and summaries." value={settings.editor} onChange={value => updateTypography('editor', value)} onReset={() => updateTypography('editor', { ...defaultUiSettings.editor })} />
            <TypographyControls title="Expandable inputs" description="Generation drawer and scalable text inputs." value={settings.inputs} onChange={value => updateTypography('inputs', value)} onReset={() => updateTypography('inputs', { ...defaultUiSettings.inputs })} />
          </div>
          <div className="ui-kit-typography-previews">
            <article><small>Main editor preview</small><p className="ui-kit-editor-type-preview">The quiet room held its breath while the next sentence arrived. “Tell me what happened,” she said.</p></article>
            <article><small>Expandable input preview</small><p className="ui-kit-input-type-preview">Continue the scene from Mara’s point of view. Keep the dialogue restrained.</p></article>
          </div>
        </Card>
        <Card variant="outlined" eyebrow="Type scale" title="Application typography" description="Editorial headings use the serif family. Controls and supporting UI use the interface sans-serif family.">
          <div className="ui-kit-type-scale">
            <article className="ui-kit-type-display"><div>Display heading</div><span><b>Display</b><em>40px mobile · 54px desktop</em></span></article>
            <article className="ui-kit-type-page"><div>Page title</div><span><b>Page title</b><em>32px mobile · 42px desktop</em></span></article>
            <article className="ui-kit-type-section"><div>Section heading</div><span><b>Section title</b><em>24px mobile · 28px desktop</em></span></article>
            <article className="ui-kit-type-card"><div>Card heading</div><span><b>Card title</b><em>20px mobile · 22px desktop</em></span></article>
            <article className="ui-kit-type-body"><div>Body text explains content and guides the reader through the interface.</div><span><b>Body</b><em>14px mobile · 15px desktop</em></span></article>
            <article className="ui-kit-type-control"><div>Button and input text</div><span><b>Controls</b><em>14px mobile · 14px desktop</em></span></article>
            <article className="ui-kit-type-supporting"><div>Descriptions and supporting information</div><span><b>Supporting</b><em>12px mobile · 12px desktop</em></span></article>
            <article className="ui-kit-type-caption"><div>METADATA · CAPTION · STATUS</div><span><b>Caption</b><em>10px mobile · 10px desktop</em></span></article>
          </div>
          <p className="ui-kit-type-note">Editor prose remains independently configurable in Appearance settings. Its default is 19px with a 1.78 line height.</p>
        </Card>
      </section>
    </div>
  </main>
}
