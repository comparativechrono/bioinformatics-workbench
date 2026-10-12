"""Run genomics-wasm's tools/bracken/build.py unchanged, except for one source archive.

GitHub's codeload service is unreachable from this machine. Every other codeload archive was
recreated byte-for-byte with `git archive` (recreate-github-archive.sh), but GitHub's zip container
for emscripten-ports/bzip2 1.0.6 cannot be reproduced exactly (the files inside are the same commit).
Bracken's build only copies that zip into dist/bracken/sources as a source record of the Pyodide
runtime; nothing is compiled from it (bzip2 comes with the Pyodide runtime, as released).
"""
import runpy
import sys
from pathlib import Path

script = Path(sys.argv[1]).resolve()
sys.argv = [str(script), *sys.argv[2:]]
g = runpy.run_path(str(script), run_name="build_bracken")["main"].__globals__  # the live module globals, not a copy
original = g["fetch"]


def fetch(record):
    if record.get("archive") == "bzip2-1.0.6.zip":
        path = g["DOWNLOADS"] / "bzip2-1.0.6.zip"
        if path.is_file():
            print("NOTE: bzip2-1.0.6.zip is a git-archive copy of emscripten-ports/bzip2 1.0.6 "
                  "(commit 60ce9dfe9a75f7ee92956aba8a83d1a37625bc1d); its zip bytes differ from GitHub's", flush=True)
            return path
    return original(record)


g["fetch"] = fetch
g["main"]()
