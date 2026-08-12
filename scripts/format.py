#!/usr/bin/env python3
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

PRETTIER_EXT = {
    ".ts",
    ".mts",
    ".cts",
    ".js",
    ".mjs",
    ".cjs",
    ".svelte",
    ".css",
    ".scss",
    ".html",
    ".json",
    ".yml",
    ".yaml",
    ".md",
}
LOCK_FILES = {"package-lock.json", "Cargo.lock"}
SKIP_DIRS = {
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".gradle",
    ".ruff_cache",
    "gen",
}

MARK = {"ok": "OK", "fail": "FAIL", "skip": "SKIP"}


def walk():
    out = []
    stack = [REPO]
    while stack:
        for e in stack.pop().iterdir():
            if e.is_dir():
                if e.name not in SKIP_DIRS:
                    stack.append(e)
            elif e.is_file():
                out.append(e)
    return out


def run(cmd, cwd=REPO):
    try:
        p = subprocess.run(
            cmd, cwd=str(cwd), text=True, capture_output=True, check=False
        )
    except FileNotFoundError as e:
        return 127, "", str(e)
    return p.returncode, p.stdout, p.stderr


def main():
    files = walk()
    by_ext = {}
    for f in files:
        by_ext.setdefault(f.suffix, []).append(f)

    results = []

    cargo = shutil.which("cargo")
    if cargo:
        failed = None
        for d in (REPO / "server", REPO / "src-tauri"):
            rc, out, err = run([cargo, "fmt"], cwd=d)
            if rc != 0:
                failed = f"{d.name}: {(err or out).strip()[:200]}"
                break
        results.append(
            ("rust", "fail", failed) if failed else ("rust", "ok", "2 crate(s)")
        )
    else:
        results.append(("rust", "skip", "cargo not found"))

    node = shutil.which("node")
    prettier_bin = (
        REPO / "frontend" / "node_modules" / "prettier" / "bin" / "prettier.cjs"
    )
    svelte_plugin = (
        REPO / "frontend" / "node_modules" / "prettier-plugin-svelte" / "plugin.js"
    )
    if node and prettier_bin.exists():
        prettier = [node, str(prettier_bin)]
    elif shutil.which("prettier"):
        prettier = [shutil.which("prettier")]
    else:
        prettier = None
    if prettier:
        plugin = ["--plugin", str(svelte_plugin)] if svelte_plugin.exists() else []
        targets = [
            f
            for e in PRETTIER_EXT
            for f in by_ext.get(e, [])
            if f.name not in LOCK_FILES and (plugin or f.suffix != ".svelte")
        ]
        rc, out, err = run(prettier + plugin + ["--write", *[str(f) for f in targets]])
        results.append(
            ("prettier", "ok", f"{len(targets)} file(s)")
            if rc == 0
            else ("prettier", "fail", (err or out).strip()[:300])
        )
    else:
        results.append(
            ("prettier", "skip", "prettier not found (npm install in frontend/)")
        )

    taplo = shutil.which("taplo")
    if taplo:
        targets = by_ext.get(".toml", [])
        rc, out, err = run([taplo, "fmt", *[str(f) for f in targets]])
        results.append(
            ("toml", "ok", f"{len(targets)} file(s)")
            if rc == 0
            else ("toml", "fail", (err or out).strip()[:300] or "failed")
        )
    else:
        results.append(("toml", "skip", "taplo not found"))

    ruff = shutil.which("ruff")
    if ruff:
        targets = by_ext.get(".py", [])
        rc, out, err = run([ruff, "format", *[str(f) for f in targets]])
        results.append(
            ("python", "ok", f"{len(targets)} file(s)")
            if rc == 0
            else ("python", "fail", (err or out).strip()[:300])
        )
    else:
        results.append(("python", "skip", "ruff not found"))

    print(f"repo: {REPO}")
    code = 0
    for name, status, detail in results:
        if status == "fail":
            code = 1
        print(f"  {name:8} {MARK[status]:7} {detail}")
    print("done" if code == 0 else "done (issues)")
    return code


if __name__ == "__main__":
    sys.exit(main())
