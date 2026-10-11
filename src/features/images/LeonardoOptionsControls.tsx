import Input from '../../shared/ui/Input'
import Select from '../../shared/ui/Select'
import { leonardoContract, leonardoDefaults, type LeonardoOptions } from './leonardo-contracts'

/** Controls come from the local verified contract, never imported capability metadata. */
export default function LeonardoOptionsControls({ model, value, onChange }: { model: string; value?: LeonardoOptions; onChange: (value: LeonardoOptions) => void }) {
  let contract
  try { contract = leonardoContract(model) } catch { return <p role="alert">Unsupported Leonardo model. Original profile data is retained.</p> }
  const options = value ?? leonardoDefaults(model)
  const update = (patch: Partial<LeonardoOptions>) => onChange({ ...options, ...patch })
  return <>
    <Select label="Leonardo prompt enhancement" value={options.prompt_enhance ?? ''} onChange={event => update({ prompt_enhance: event.target.value as LeonardoOptions['prompt_enhance'] })}>{['OFF', 'AUTO', 'ON'].map(item => <option key={item} value={item}>{item}</option>)}</Select>
    {contract.modes && <Select label="Leonardo mode" value={options.mode ?? ''} onChange={event => update({ mode: event.target.value as LeonardoOptions['mode'] })}>{contract.modes.map(item => <option key={item} value={item}>{item}</option>)}</Select>}
    {contract.qualities && <Select label="Leonardo quality" value={options.quality ?? ''} onChange={event => update({ quality: event.target.value as LeonardoOptions['quality'] })}>{contract.qualities.map(item => <option key={item} value={item}>{item}</option>)}</Select>}
    {contract.styles && <Select label="Leonardo style" value={options.style_ids?.[0] ?? ''} onChange={event => update({ style_ids: [event.target.value] })}>{Object.entries(contract.styles).map(([name, id]) => <option key={id} value={id}>{name}</option>)}</Select>}
    {contract.seedMax !== undefined && <Input label="Leonardo seed" description="Optional integer; empty omits the seed." type="number" min={0} max={contract.seedMax} step={1} value={options.seed ?? ''} onChange={event => { if (event.target.value === '') { const { seed: _seed, ...rest } = options; onChange(rest) } else update({ seed: Number(event.target.value) }) }} />}
  </>
}
