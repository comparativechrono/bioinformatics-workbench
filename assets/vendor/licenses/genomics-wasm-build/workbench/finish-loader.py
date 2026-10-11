import re, sys
# The exit status of each run is recorded as Module.__exitStatus (the site's program runner reads it). The loader is
# minified when the link optimises (-O2/-O3) and is not when it does not (StringTie's link): both forms are known.
path, title = sys.argv[1], sys.argv[2]
s = open(path, encoding='utf-8').read()
found = re.findall(r'var exitJS ?= ?\(status, ?implicit\) ?=> ?\{', s)
assert len(found) == 1, 'exitJS not found once in ' + path
s = s.replace(found[0], found[0] + 'Module.__exitStatus=status;')
s = '// ' + title + ' exit(status) is recorded as Module.__exitStatus.\n' + s
open(path, 'w', encoding='utf-8').write(s)
print('patched', path)
