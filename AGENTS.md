# Repository agent instructions

## Mandatory frontend test resource policy

This machine has experienced an OS out-of-memory failure from a UI test exceeding 20 GiB. These rules apply to the main agent and every subagent.

- Run frontend tests **only** through `npm test` or `npm test -- tests/<name>.test.mjs [tests/<other>.test.mjs ...]`.
- Never invoke `node --test`, import/execute test files directly, or create an alternative unguarded test runner.
- Never change memory limits, concurrency, guards, or runner environment to make a failing test pass. Fix the test or report the failure.
- The supported runner enforces concurrency 1, one run per repository (including worktrees), a 2 GiB **whole-process-tree** cgroup memory limit, no swap, a 1 GiB Node heap limit, and bounded test output.
- If cgroup/systemd isolation is unavailable, stop and report it. There is intentionally no unrestricted fallback.
- Delegate code changes freely, but the parent agent coordinates validation. Do not have several subagents start test/build suites independently.
- Start with targeted files. Run a full suite only through the same protected runner, after focused checks.
- Every new `tests/*.test.mjs` file must start with:
  ```js
  import { assertTestResourceLimits } from './test-resource-policy.mjs'
  assertTestResourceLimits()
  ```
  The runner checks this requirement for all test files. Existing tests also reject accidental direct execution before their test setup.
- Register React root cleanup with `t.after()` immediately after creating the root, before rendering or awaiting setup. Close JSDOM, streams, databases and temporary files even when setup/assertions fail.
- Do not pass DOM/React objects to equality assertions that can expand browser/fiber graphs on failure. Compare scalar values or use `assert.ok(actual === expected, 'description')` for identity.

## Scope and user work

Do not discard unrelated work. The settings/profile redesign is still being integrated; do not treat its unfinished state as permission to revert it.
