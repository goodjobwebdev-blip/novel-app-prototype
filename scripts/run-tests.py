#!/usr/bin/env python3
"""The only supported frontend test entrypoint; fail closed without cgroup limits."""
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
MEMORY_LIMIT = "2G"
CONSOLE_LIMIT = 512 * 1024
LOG_LIMIT = 4 * 1024 * 1024


def test_files(arguments):
    if not arguments:
        return sorted(ROOT.glob("tests/*.test.mjs"))
    result = []
    for argument in arguments:
        path = (ROOT / argument).resolve()
        if path.parent != ROOT / "tests" or not path.name.endswith(".test.mjs") or not path.is_file():
            raise ValueError("Pass only tests/<name>.test.mjs paths. Runner options cannot be overridden.")
        if path not in result:
            result.append(path)
    return result


def main():
    try:
        files = test_files(sys.argv[1:])
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    if sys.platform != "linux" or not shutil.which("systemd-run"):
        print("Tests require Linux systemd/cgroup v2 memory isolation. No unrestricted fallback. See README.md.", file=sys.stderr)
        return 2
    node = shutil.which("node")
    if not node:
        print("Node.js is unavailable.", file=sys.stderr)
        return 2
    common = subprocess.run(["git", "--no-pager", "rev-parse", "--git-common-dir"], cwd=ROOT, capture_output=True, text=True)
    if common.returncode:
        print("Cannot locate the shared repository test lock; refusing to run.", file=sys.stderr)
        return 2
    common_directory = (ROOT / common.stdout.strip()).resolve()
    lock_path = common_directory / "frontend-tests.lock"
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another test run is active in this repository/worktree. Wait for it; concurrent runs are forbidden.", file=sys.stderr)
            return 2
        # A stable unit name also prevents overlap if the launcher is killed with SIGKILL,
        # when its file lock is released but the isolated test service is still alive.
        identity = hashlib.sha256(str(common_directory).encode()).hexdigest()[:12]
        unit = f"arc-tests-{os.getuid()}-{identity}"
        ci = os.environ.get("GITHUB_ACTIONS") == "true"
        control = ["sudo", "--non-interactive", "systemctl"] if ci else ["systemctl", "--user"]
        active = subprocess.run(control + ["show", "--property=ActiveState", "--value", unit + ".service"], capture_output=True, text=True, timeout=10)
        if active.stdout.strip() in ["active", "activating", "deactivating", "reloading"]:
            print("Another isolated test run is still active. Wait for it; concurrent runs are forbidden.", file=sys.stderr)
            return 2
        manager = ["sudo", "--non-interactive", "systemd-run"] if ci else ["systemd-run", "--user"]
        command = manager + ["--quiet", "--collect", "--wait", "--pipe", f"--unit={unit}",
            f"--property=MemoryMax={MEMORY_LIMIT}", "--property=MemorySwapMax=0", "--property=TasksMax=128",
            "--property=OOMPolicy=kill", "--property=RuntimeMaxSec=1200", "--property=TimeoutStopSec=5",
            f"--property=WorkingDirectory={ROOT}", "--setenv=NODE_OPTIONS=--max-old-space-size=1024",
            f"--setenv=PATH={os.environ.get('PATH', '')}", "--setenv=ARC_GUARDED_TEST_RUN=1"]
        if ci:
            command += [f"--uid={os.getuid()}", f"--gid={os.getgid()}"]
        command += ["--", node, str(ROOT / "scripts/test-entry.mjs"), *map(str, files)]
        stop = control + ["stop", unit + ".service"]
        process = None

        def interrupted(signum, _frame):
            subprocess.run(stop, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if process is not None:
                process.terminate()
            raise SystemExit(128 + signum)

        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        print(f"Tests: {len(files)} file(s), concurrency=1, total RAM≤2 GiB, swap=0, Node heap≤1 GiB.", flush=True)
        log_path = ROOT / "node_modules/.test-runner-output.log"
        log_path.parent.mkdir(exist_ok=True)
        written = 0
        console_bytes = 0
        last_output = b""
        try:
            with log_path.open("wb") as log:
                process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                while chunk := process.stdout.read1(4096):
                    last_output = (last_output + chunk)[-8192:]
                    if written < LOG_LIMIT:
                        portion = chunk[:LOG_LIMIT - written]
                        log.write(portion)
                        written += len(portion)
                    if console_bytes < CONSOLE_LIMIT:
                        portion = chunk[:CONSOLE_LIMIT - console_bytes]
                        sys.stdout.buffer.write(portion)
                        sys.stdout.buffer.flush()
                        console_bytes += len(portion)
                        if console_bytes == CONSOLE_LIMIT:
                            print("\nTest output truncated to protect the editor; see node_modules/.test-runner-output.log (also capped).", flush=True)
                result = process.wait()
            if console_bytes == CONSOLE_LIMIT:
                print("\nLast output:\n" + last_output.decode(errors="replace"))
            if result:
                print(f"Test run failed (exit {result}). Memory-limit failures are test failures; do not increase or bypass limits.", file=sys.stderr)
            return result if result >= 0 else 128 - result
        finally:
            subprocess.run(stop, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)


if __name__ == "__main__":
    sys.exit(main())
