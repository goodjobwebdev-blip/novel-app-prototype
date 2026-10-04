import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import v8 from 'node:v8'

const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const options = { cwd: root, timeout: 10000, maxBuffer: 64 * 1024 }

async function rejectedRun(arguments_) {
  try { await execute('npm', ['test', '--', ...arguments_], options); assert.fail('The unsafe/nested run must be rejected') }
  catch (error) {
    assert.equal(error.code, 2)
    return String(error.stdout) + String(error.stderr)
  }
}

test('test tree is in a hard-limited cgroup with swap disabled and a bounded Node heap', async () => {
  const directory = assertTestResourceLimits()
  assert.equal(readFileSync(resolve(directory, 'memory.max'), 'utf8').trim(), String(2 * 1024 ** 3))
  assert.equal(readFileSync(resolve(directory, 'memory.swap.max'), 'utf8').trim(), '0')
  assert.equal(process.env.NODE_OPTIONS, '--max-old-space-size=1024')
  assert.ok(v8.getHeapStatistics().heap_size_limit < 1.1 * 1024 ** 3, 'Node heap remains close to its fixed 1 GiB limit')
  const { stdout } = await execute(process.execPath, ['-e', "console.log(require('node:fs').readFileSync('/proc/self/cgroup','utf8').trim())"], options)
  assert.equal(stdout.trim(), readFileSync('/proc/self/cgroup', 'utf8').trim(), 'Child processes share the limited group')
})

test('another npm test run is rejected while this repository is testing', async () => {
  assert.match(await rejectedRun(['tests/test-runner.test.mjs']), /Another test run is active/)
})

test('runner rejects attempts to override concurrency, memory, or use arbitrary paths', async () => {
  for (const argument of ['--test-concurrency=99', '--max-old-space-size=32000', '../tests/test-runner.test.mjs', 'src/app/Workspace.tsx']) {
    assert.match(await rejectedRun([argument]), /only tests\/.*Runner options cannot be overridden/)
  }
})

test('resource guard refuses an unguarded invocation before test setup', async () => {
  const env = { ...process.env }
  delete env.ARC_GUARDED_TEST_RUN
  await assert.rejects(execute(process.execPath, ['--input-type=module', '-e', "import { assertTestResourceLimits } from './tests/test-resource-policy.mjs'; assertTestResourceLimits()"], { ...options, env }), error => {
    assert.match(String(error.stderr), /Direct\/unrestricted test execution is forbidden/)
    return true
  })
})

test('all test entrypoints include the mandatory guard and all public runners use it', () => {
  const prefix = "import { assertTestResourceLimits } from './test-resource-policy.mjs'\nassertTestResourceLimits()\n"
  for (const name of readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.mjs'))) {
    assert.ok(readFileSync(resolve(root, 'tests', name), 'utf8').startsWith(prefix), `Missing resource guard: ${name}`)
  }
  assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts.test, 'python3 scripts/run-tests.py')
  assert.match(readFileSync(resolve(root, '.github/workflows/tests.yml'), 'utf8'), /run: npm test/)
  assert.match(readFileSync(resolve(root, 'AGENTS.md'), 'utf8'), /Never invoke `node --test`/)
})
