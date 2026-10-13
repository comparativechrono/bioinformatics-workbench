"""Run genomics-wasm's tools/hmmer/build.py unchanged, with one patch more for the WebAssembly programs.

    python3 -I build-hmmer-workbench.py tools/hmmer/build.py wasm      (in the genomics-wasm checkout, Emscripten active)

hmmer-easel-messages.patch (next to this script) is applied to the WebAssembly build only, after genomics-wasm's own
browser.patch. Easel takes a process whose parent is process 1 for a daemon and sends its error messages to syslog;
Emscripten's getppid() always returns 1, so compiled to WebAssembly every HMMER program lost them – "Failed to parse
command line:" without the reason, "hmmpress: ... already exists" not at all. Under Emscripten the patch makes getppid()
answer 2. The native programs are not changed; nothing else is.
"""
import runpy
import sys
from pathlib import Path

PATCH = Path(__file__).resolve().parent / 'hmmer-easel-messages.patch'
script = Path(sys.argv[1]).resolve()
sys.argv = [str(script), *sys.argv[2:]]
g = runpy.run_path(str(script), run_name='build_hmmer')['main'].__globals__  # the live module globals, not a copy
original = g['run']


def run(command, cwd, env):
    original(command, cwd, env)
    # after browser.patch, in the source tree of the WebAssembly build (build/hmmer/RUN/wasm/hmmer-3.4)
    if any(str(c).endswith('browser.patch') for c in command) and Path(cwd).parent.name == 'wasm':
        original(['patch', '--batch', '--fuzz=0', '-p1', '-i', PATCH], cwd, env)


g['run'] = run
g['main']()
