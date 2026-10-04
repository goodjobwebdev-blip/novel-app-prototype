import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const MAX_TEST_MEMORY_BYTES = 2 * 1024 ** 3

/** Verify the kernel limit, not just an environment flag or V8 heap setting. */
export function assertTestResourceLimits() {
  const advice = 'Use npm test -- tests/<name>.test.mjs. Direct/unrestricted test execution is forbidden.'
  if (process.env.ARC_GUARDED_TEST_RUN !== '1' || process.platform !== 'linux') throw new Error(advice)
  const unified = readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))
  if (!unified) throw new Error(`cgroup v2 is required. ${advice}`)
  const directory = resolve('/sys/fs/cgroup', '.' + unified.slice(3))
  const memory = readFileSync(resolve(directory, 'memory.max'), 'utf8').trim()
  const swap = readFileSync(resolve(directory, 'memory.swap.max'), 'utf8').trim()
  if (!/^\d+$/.test(memory) || Number(memory) > MAX_TEST_MEMORY_BYTES || swap !== '0') throw new Error(`Kernel test memory limits are missing or unsafe. ${advice}`)
  return directory
}
