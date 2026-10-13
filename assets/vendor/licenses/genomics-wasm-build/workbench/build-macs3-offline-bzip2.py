"""Run genomics-wasm's scripts/build-macs3.py unchanged, except for one source archive (as for Cutadapt and Bracken).

  python3.14 build-macs3-offline-bzip2.py /path/to/genomics-wasm/scripts/build-macs3.py all

GitHub's zip of emscripten-ports/bzip2 1.0.6 is no longer byte for byte the one the lock file pins. The download
cache holds a zip that git archive made of the same commit (60ce9dfe9a75f7ee92956aba8a83d1a37625bc1d; SHA-256
bb380435…): the same files, other zip bytes. The zip is only copied into dist/macs3/sources/ as a record of the
runtime's source; nothing is compiled from it. Any other archive goes through the script's own fetch() and its
checks of the SHA-256 of the lock file.
"""
import importlib.util
import sys

script = sys.argv[1]
spec = importlib.util.spec_from_file_location("build_macs3", script)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
COPY_SHA = "bb380435a7e769b51b80bc0e35d75df6f34e37ec2b6f3ce11c8060e48c9487b9"
original = m.fetch


def fetch(record, *, toolchain=False):
    if not toolchain and record.get("archive") == "bzip2-1.0.6.zip":
        path = m.DOWNLOADS / "bzip2-1.0.6.zip"
        if m.sha256(path) != COPY_SHA:
            raise RuntimeError("bzip2-1.0.6.zip is neither GitHub's zip nor the known git-archive copy")
        print("NOTE: bzip2-1.0.6.zip is a git-archive copy of emscripten-ports/bzip2 1.0.6 "
              "(commit 60ce9dfe9a75f7ee92956aba8a83d1a37625bc1d); its zip bytes differ from GitHub's", flush=True)
        return path
    return original(record, toolchain=toolchain)


m.fetch = fetch
sys.argv = [script] + sys.argv[2:]
m.main()
