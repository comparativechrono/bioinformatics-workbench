#!/usr/bin/env python3
"""Make an Emscripten loader fit the workbench's runner (assets/vendor/biowasm/aioli.js, execIO):
record the exit status of the program as Module.__exitStatus, and say where the program comes from.
usage: finish-loader.py LOADER.js "first line of the header comment" """
import sys
path, title = sys.argv[1], sys.argv[2]
s = open(path, encoding='utf-8').read()
old = 'var exitJS=(status,implicit)=>{'
assert s.count(old) == 1, 'exitJS not found once in ' + path
s = s.replace(old, old + 'Module.__exitStatus=status;')
s = '// ' + title + ' exit(status) is recorded as Module.__exitStatus.\n' + s
open(path, 'w', encoding='utf-8').write(s)
print('patched', path)
