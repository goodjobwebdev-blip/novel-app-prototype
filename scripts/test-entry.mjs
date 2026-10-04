import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertTestResourceLimits } from '../tests/test-resource-policy.mjs'

const cgroup = assertTestResourceLimits()
const root = resolve(import.meta.dirname, '..')
const files = process.argv.slice(2)
if (!files.length || files.some(file => !readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.mjs')).map(name => resolve(root, 'tests', name)).includes(file))) throw new Error('Only repository test files may run.')

// Keeping this policy at every test entry also catches accidental direct node --test runs.
for (const file of readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.mjs'))) {
  const source = readFileSync(resolve(root, 'tests', file), 'utf8')
  if (!source.startsWith("import { assertTestResourceLimits } from './test-resource-policy.mjs'\nassertTestResourceLimits()\n")) throw new Error(`Missing test resource guard in tests/${file}. Add the standard guard before running tests.`)
}

const runner = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=30000', '--test-reporter=spec', ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1024' },
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => runner.kill(signal))
runner.on('error', error => { console.error(error.message); process.exitCode = 1 })
runner.on('exit', (code, signal) => {
  try {
    const peak = Number(readFileSync(resolve(cgroup, 'memory.peak'), 'utf8').trim())
    console.log(`Test cgroup peak RAM: ${(peak / 1024 ** 2).toFixed(0)} MiB (entire process tree).`)
  } catch { /* Older kernels may not expose memory.peak. */ }
  process.exitCode = code ?? (signal ? 1 : 0)
})
