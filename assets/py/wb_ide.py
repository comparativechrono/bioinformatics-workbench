"""
wb_ide - the Python of Spyder in the workbench's IDE tab.

Spyder's IPython console is IPython itself (an InteractiveShell) with a few things added: the %runfile, %runcell,
%debugfile and %debugcell magics that the editor's Run and Debug buttons type into the console, the namespace that
the Variable Explorer shows and edits, the plots of the Plots pane, the documentation of the Help pane, and a
debugger whose prompt (IPdb [1]:) is the console's own. This module does the same for the workbench's imitation of
Spyder (spyder.js), with the IPython that Pyodide provides.

It runs in py-ide-worker.js, which is the notebook's worker (py-worker.js: Pyodide, the copy of the home folder, and
!commands run by the page's shell) with a little more added. Whatever the running code produces goes to the page
through nb_post_output(json): what it prints, its results (Out[n]), its errors, its plots, and where the debugger has
stopped. input() and the debugger's prompt wait for an answer with ide_input(), which blocks the worker until the page
has written the answer into a SharedArrayBuffer. That is only possible when the page is cross-origin isolated;
elsewhere input() says why it cannot ask.

The page calls the functions at the end of this file (run_cell, and through call(): variables, view, complete ...).
"""
import ast
import base64
import builtins
import datetime
import importlib.abc
import importlib.machinery
import importlib.util
import json
import linecache
import os
import re
import shlex
import sys
import types

from js import ide_input, ide_sleep, nb_post_output, nb_shell

# IPython keeps its settings in ~/.ipython and jedi its cache in ~/.cache: both go outside the home folder, which is
# copied back to the student's files
os.environ['IPYTHONDIR'] = '/tmp/ipython'
os.environ.setdefault('MPLBACKEND', 'Agg')
HERE = __file__

shell = None
SETTINGS = {
    'mute_inline': True,  # plots go to the Plots pane only (Spyder's "Mute inline plotting")
    'clear_before_run': False,  # Run > "Remove all variables before execution"
    'current_namespace': False,  # Run > "Run in console's namespace instead of an empty one"
    'dark': True,
    'dpi': 144,
    'figsize': (6.0, 4.0),
}
# the code of the cells that %runcell and %debugcell run, sent by the page with the command (the editor's text, saved
# or not): (path, index) -> (code, first line)
CELLS = {}
# the editor's breakpoints: path -> [line numbers]
BREAKPOINTS = {}
STATE = {'errors': 0, 'debugging': False}


def _emit(obj):
    nb_post_output(json.dumps(obj, default=str))


# ---------------------------------------------------------------------------------------------------------------
# IPython, without its package's start-up: IPython/__init__.py imports the terminal (prompt_toolkit), which a console
# in a web page does not use and which takes seconds to import in the browser. The submodules are IPython's own.
# ---------------------------------------------------------------------------------------------------------------
def _import_ipython():
    for k in [k for k in sys.modules if k == 'IPython' or k.startswith('IPython.')]:
        del sys.modules[k]  # (the notebook's small stand-in for IPython.display, from py-worker.js)
    spec = importlib.util.find_spec('IPython')
    pkg = types.ModuleType('IPython')
    pkg.__path__ = list(spec.submodule_search_locations)
    pkg.__file__ = spec.origin
    pkg.__spec__ = spec
    pkg.__package__ = 'IPython'
    sys.modules['IPython'] = pkg
    from IPython.core import release
    from IPython.core.getipython import get_ipython

    pkg.get_ipython = get_ipython
    pkg.__version__ = release.version
    pkg.version_info = release.version_info

    def _not_here(*a, **k):
        raise RuntimeError('IPython is already running here: this is its console. (embed() and start_ipython() are not available in the browser.)')

    pkg.embed = pkg.start_ipython = pkg.start_kernel = _not_here
    return release


_release = _import_ipython()

from IPython.core.debugger import Pdb as _IPdb  # noqa: E402
from IPython.core.displayhook import DisplayHook  # noqa: E402
from IPython.core.displaypub import DisplayPublisher  # noqa: E402
from IPython.core.interactiveshell import InteractiveShell  # noqa: E402
from traitlets import Type  # noqa: E402
from traitlets.config import Config  # noqa: E402

sys.modules['IPython'].InteractiveShell = InteractiveShell


class _Display(DisplayHook):
    """Out[n]: the page shows the prompt and the result together"""

    def write_output_prompt(self):
        pass

    def write_format_data(self, format_dict, md_dict=None):
        d = {'type': 'result', 'n': self.shell.execution_count, 'text': format_dict.get('text/plain', '')}
        png = format_dict.get('image/png')
        if png:
            d['png'] = png if isinstance(png, str) else base64.b64encode(png).decode('ascii')
        _emit(d)

    def finish_displayhook(self):
        pass


class _Publisher(DisplayPublisher):
    """display(): pictures and text for the console (and plots for the Plots pane)"""

    def publish(self, data, metadata=None, source=None, *, transient=None, update=False, **kwargs):
        out = {}
        for mime, v in (data or {}).items():
            if isinstance(v, (bytes, bytearray)):
                v = base64.b64encode(bytes(v)).decode('ascii')
            if isinstance(v, (str, int, float, bool)):
                out[mime] = v
        md = metadata or {}
        _emit({'type': 'display', 'data': out, 'plot': bool(md.get('wb_plot'))})

    def clear_output(self, wait=False):
        pass


# ---------------------------------------------------------------------------------------------------------------
# the debugger: IPython's, with the console's prompt (IPdb [1]:) and the page told where it has stopped
# ---------------------------------------------------------------------------------------------------------------
class IDEPdb(_IPdb):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._n = 1
        self.prompt = 'IPdb [1]: '
        self.to_breakpoint = False  # run on to the first breakpoint (Debug with breakpoints set)

    def user_line(self, frame):
        if self.to_breakpoint:
            if not self.break_here(frame):
                self.set_continue()
                return
            self.to_breakpoint = False
        super().user_line(frame)

    def preloop(self):
        try:
            super().preloop()
        except Exception:
            pass
        _where(self)

    def precmd(self, line):
        # (the page sends the editor's breakpoints first when they changed while the debugger waited:
        # \x01bp:{"path": [lines]}\x01command)
        if line.startswith('\x01bp:'):
            parts = line.split('\x01')
            try:
                self._set_breakpoints(json.loads(parts[1][3:]))
            except Exception:
                pass
            line = parts[2] if len(parts) > 2 else ''
        # (Python's own commands of the debugger – it shows where it is with one – are not the user's)
        if not line.startswith('_pdbcmd'):
            self._n += 1
            self.prompt = f'IPdb [{self._n}]: '
        return super().precmd(line)

    def postcmd(self, stop, line):
        stop = super().postcmd(stop, line)
        if not stop:
            _where(self)
        return stop

    def _set_breakpoints(self, bps):
        BREAKPOINTS.clear()
        BREAKPOINTS.update({p: list(ls) for p, ls in bps.items() if ls})
        self.clear_all_breaks()
        for path, lines in BREAKPOINTS.items():
            for ln in lines:
                self.set_break(path, ln)


def _where(dbg):
    """where the debugger has stopped: the file and line (the editor shows them), the frames, the variables"""
    try:
        frame = dbg.curframe
        stack = []
        for f, lineno in dbg.stack:
            fn = f.f_code.co_filename
            if fn == HERE or fn.startswith('<frozen') or '/bdb.py' in fn or '/pdb.py' in fn or '/IPython/' in fn:
                continue
            stack.append({'file': fn, 'line': lineno, 'func': f.f_code.co_name, 'current': f is frame})
        STATE['debugging'] = True
        _emit({'type': 'debug', 'file': frame.f_code.co_filename, 'line': frame.f_lineno, 'func': frame.f_code.co_name,
               'stack': stack, 'vars': _var_list(frame.f_locals, FILTERS)})
    except Exception as e:  # (the page then has less to show, nothing worse)
        _emit({'type': 'debug', 'file': '', 'line': 0, 'stack': [], 'vars': [], 'problem': str(e)})


def _breakpoint(*args, **kwargs):
    """breakpoint() in the code: the debugger stops there"""
    if not _can_ask():
        print('breakpoint(): the debugger needs to wait for what you type, which this page cannot do (it is not cross-origin isolated).', file=sys.stderr)
        return
    IDEPdb().set_trace(sys._getframe(1))


_ANSI = re.compile(r'\x1b\[[0-9;]*m')


def _without_own_frames(text):
    """a traceback without the frames of this module (input(), time.sleep() and the magics are its functions, but
    to the user they are Python's own)"""
    out = []
    skip = False
    for line in text.split('\n'):
        plain = _ANSI.sub('', line)
        if re.match(r'\s*File .*wb_ide\.py', plain):
            skip = True
            continue
        if skip and re.match(r'\s{4,}\S', plain) and not re.match(r'\s*(File|Cell) ', plain):
            continue
        skip = False
        out.append(line)
    return '\n'.join(out)


class IDEShell(InteractiveShell):
    displayhook_class = Type(_Display)
    display_pub_class = Type(_Publisher)
    debugger_cls = IDEPdb

    def _showtraceback(self, etype, evalue, stb):
        text = _without_own_frames(self.InteractiveTB.stb2text(stb))
        STATE['errors'] += 1
        try:
            cwd = os.getcwd()  # (where the code was when it failed, for the AI assistant)
        except Exception:
            cwd = None
        _emit({'type': 'error', 'ename': getattr(etype, '__name__', str(etype)), 'evalue': str(evalue)[:2000], 'text': text, 'cwd': cwd})

    def system(self, cmd):
        print('A shell command runs when it is on a line of its own that starts with !, for example  !ls -l', file=sys.stderr)

    system_raw = system_piped = system

    def getoutput(self, cmd, split=True, depth=0):
        self.system(cmd)
        return []

    def ask_exit(self):
        _emit({'type': 'exit'})

    def set_next_input(self, s, replace=False):
        _emit({'type': 'next-input', 'text': s})

    def enable_gui(self, gui=None):
        pass

    def reset(self, new_session=True, aggressive=False):
        super().reset(new_session, aggressive)
        # (%reset empties the namespace: the helpers of !commands and %pip come back)
        self.user_ns.update(_HELPERS)
        self.user_ns_hidden.update(_HELPERS)


# ---------------------------------------------------------------------------------------------------------------
# input() and getpass(): the page asks, and the worker waits for the answer
# ---------------------------------------------------------------------------------------------------------------
_CAN_ASK = [None]


def _can_ask():
    return bool(_CAN_ASK[0])


def _read(prompt='', password=False):
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass
    r = json.loads(ide_input(str(prompt), bool(password)))
    if r.get('ok'):
        return r.get('text', '')
    if r.get('why') == 'interrupt':
        raise KeyboardInterrupt
    print(f"{str(prompt)}\ninput() needs to wait for what you type, and this page cannot do that because it is not "
          "cross-origin isolated (the IDE help explains why). Put the value in your code instead, for example  name = 'TP53'",
          file=sys.stderr)
    raise EOFError('EOF when reading a line')


def _input(prompt=''):
    return _read(prompt)


def _getpass(prompt='Password: ', stream=None):
    return _read(prompt, password=True)


_SLEEP = [None]


def _sleep(secs):
    """time.sleep(), which Ctrl+C can interrupt (the worker waits on the interrupt buffer)"""
    secs = float(secs)
    if secs < 0:
        raise ValueError('sleep length must be non-negative')
    if not ide_sleep(secs):
        _SLEEP[0](secs)


# ---------------------------------------------------------------------------------------------------------------
# plots: matplotlib draws with Agg; the figures go to the Plots pane at plt.show() and at the end of each run
# ---------------------------------------------------------------------------------------------------------------
def _figures():
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return
    for num in plt.get_fignums():
        fig = plt.figure(num)
        if not (fig.axes or fig.texts or fig.images):
            continue
        try:
            buf = __import__('io').BytesIO()
            fig.savefig(buf, format='png', dpi=SETTINGS['dpi'], bbox_inches='tight', facecolor=fig.get_facecolor())
            w, hgt = fig.get_size_inches()
            _emit({'type': 'display', 'plot': True, 'data': {'image/png': base64.b64encode(buf.getvalue()).decode('ascii')},
                   'size': [round(w * SETTINGS['dpi']), round(hgt * SETTINGS['dpi'])], 'dpi': SETTINGS['dpi']})
        except Exception as e:
            print(f'The figure could not be drawn: {e}', file=sys.stderr)
    plt.close('all')


def _setup_pyplot(plt):
    import matplotlib
    matplotlib.rcParams['figure.figsize'] = SETTINGS['figsize']
    plt.show = lambda *a, **k: _figures()
    from matplotlib.figure import Figure
    Figure.show = lambda self, *a, **k: _figures()


class _PyplotHook(importlib.abc.MetaPathFinder):
    """when matplotlib.pyplot is first imported: plt.show() sends the figures to the Plots pane"""

    def find_spec(self, name, path=None, target=None):
        if name != 'matplotlib.pyplot':
            return None
        spec = importlib.machinery.PathFinder.find_spec(name, path)
        if spec is None or spec.loader is None:
            return spec
        inner = spec.loader

        class Loader(importlib.abc.Loader):
            def create_module(self, s):
                return inner.create_module(s)

            def exec_module(self, module):
                inner.exec_module(module)
                _setup_pyplot(module)

        spec.loader = Loader()
        return spec


def _post_execute():
    _figures()


# ---------------------------------------------------------------------------------------------------------------
# !commands (the workbench's shell, through the page) and %pip (micropip): both have to wait for the page, so they
# become  await …  lines before IPython reads the cell (IPython's own would call a shell that the browser has not got)
# ---------------------------------------------------------------------------------------------------------------
_BANG = re.compile(r'^(\s*)(?:([A-Za-z_][\w.]*)\s*=\s*)?!(?!=)(.*?)\s*$')
_PIP = re.compile(r'^(\s*)%pip\s+(.*?)\s*$')
_TRIPLE = re.compile(r'"""|' + r"'''")


def _escapes(lines):
    out = []
    in_str = False
    depth = 0
    for line in lines:
        if not in_str and depth == 0:
            m = _BANG.match(line)
            if m and m.group(3).strip() and not m.group(3).startswith('!'):
                ind, var, cmd = m.groups()
                call = f'await _ide_sh({cmd!r}, {bool(var)})'
                out.append(f'{ind}{var} = {call}\n' if var else f'{ind}{call}\n')
                continue
            m = _PIP.match(line)
            if m:
                out.append(f'{m.group(1)}await _ide_pip({m.group(2)!r})\n')
                continue
        out.append(line)
        if len(_TRIPLE.findall(line)) % 2 == 1:
            in_str = not in_str
        if not in_str:
            bare = re.sub(r'#.*$', '', re.sub(r"'[^'\\]*(?:\\.[^'\\]*)*'|\"[^\"\\]*(?:\\.[^\"\\]*)*\"", '', line))
            depth = max(0, depth + sum(bare.count(c) for c in '([{') - sum(bare.count(c) for c in ')]}'))
    return out


def _expand(cmd):
    """{expression} and $name in a shell command are Python values, as in IPython"""
    try:
        from IPython.utils.text import DollarFormatter
        return DollarFormatter().vformat(cmd, args=[], kwargs=dict(shell.user_ns))
    except Exception:
        return cmd


async def _ide_sh(cmd, capture=False):
    r = json.loads(await nb_shell(_expand(cmd), bool(capture)))
    shell.user_ns['_exit_code'] = r['code']
    if capture:
        from IPython.utils.text import SList
        return SList(r['out'].splitlines())
    return None


async def _ide_pip(args):
    import micropip
    a = shlex.split(args)
    if a and a[0] == 'install':
        pkgs = [x for x in a[1:] if not x.startswith('-')]
        if not pkgs:
            print('ERROR: You must give at least one requirement to install', file=sys.stderr)
            return
        for p in pkgs:
            print(f'Installing {p} ...')
            try:
                await micropip.install(p)
                print(f'Successfully installed {p}')
            except Exception as e:
                print(f"ERROR: Could not install {p}: {str(e).splitlines()[0][:300]}\n(Only packages written in pure Python, "
                      "or that Pyodide has built for the browser, can be installed.)", file=sys.stderr)
        print('Note: packages are installed for this visit only. After the page is reloaded, install them again.')
    elif a and a[0] in ('list', 'freeze'):
        for n, pk in sorted(micropip.list().items()):
            print(f'{n}=={pk.version}' if a[0] == 'freeze' else f'{n:30} {pk.version}')
    else:
        print('Usage:  %pip install PACKAGE    or    %pip list', file=sys.stderr)


_HELPERS = {'_ide_sh': _ide_sh, '_ide_pip': _ide_pip}


# ---------------------------------------------------------------------------------------------------------------
# Spyder's magics: %runfile, %runcell, %debugfile, %debugcell – and a few that a console in the browser does itself
# ---------------------------------------------------------------------------------------------------------------
class _RunArgs:
    path = None
    wdir = False
    wdir_path = None
    args = ''
    post_mortem = False
    current_namespace = False
    index = None
    name = None


def _parse(line):
    o = _RunArgs()
    a = shlex.split(line)
    i = 0
    while i < len(a):
        x = a[i]
        if x == '--wdir':
            o.wdir = True
            if i + 1 < len(a) and not a[i + 1].startswith('-'):
                o.wdir_path = a[i + 1]
                i += 1
        elif x == '--args':
            o.args = a[i + 1] if i + 1 < len(a) else ''
            i += 1
        elif x == '--post-mortem':
            o.post_mortem = True
        elif x == '--current-namespace':
            o.current_namespace = True
        elif x in ('-i', '--index'):
            o.index = int(a[i + 1])
            i += 1
        elif x in ('-n', '--name'):
            o.name = a[i + 1]
            i += 1
        elif o.path is None:
            o.path = x
        i += 1
    if o.path:
        o.path = os.path.abspath(os.path.expanduser(o.path))
    return o


def _user_tb():
    """the error of the user's code, without the frames of this module above it"""
    etype, value, tb = sys.exc_info()
    t = tb
    while t is not None and t.tb_frame.f_code.co_filename == HERE:
        t = t.tb_next
    shell.showtraceback((etype, value, t or tb), tb_offset=0)


def _cell_of(path, index):
    """cell number index (from 0) of a file: its code and its first line (cells start at lines that begin with #%%)"""
    if (path, index) in CELLS:
        return CELLS.pop((path, index))
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    lines = text.split('\n')
    starts = [0] + [i for i, l in enumerate(lines) if re.match(r'^\s*#\s*%%', l) and i > 0]
    if index >= len(starts):
        raise IndexError(f'{os.path.basename(path)} has no cell {index}')
    a = starts[index]
    b = starts[index + 1] if index + 1 < len(starts) else len(lines)
    return '\n'.join(lines[a:b]), a + 1, text


def _compile(source, filename, first_line=1):
    tree = ast.parse(source, filename, 'exec')
    if first_line > 1:
        ast.increment_lineno(tree, first_line - 1)
    return compile(tree, filename, 'exec', dont_inherit=True)


def _remember_source(filename, text):
    """the traceback and the debugger show the lines of the code that ran, saved or not"""
    if text is not None:
        linecache.cache[filename] = (len(text), None, text.splitlines(True), filename)


def _exec(source, filename, o, first_line=1, cell=False, debug=False, text=None):
    if SETTINGS['clear_before_run'] and not cell:
        shell.reset(new_session=False)
    in_console = cell or o.current_namespace or SETTINGS['current_namespace']
    ns = shell.user_ns if in_console else {'__name__': '__main__', '__builtins__': builtins}
    if not cell:
        ns['__file__'] = filename
    _remember_source(filename, text)
    try:
        code = _compile(source, filename, first_line)
    except SyntaxError:
        shell.showsyntaxerror(filename)
        return
    old_argv = sys.argv[:]
    sys.argv[:] = [filename] + (shlex.split(o.args) if o.args else [])
    try:
        if debug:
            _debug(code, ns, filename)
        else:
            exec(code, ns)
    except SystemExit as e:
        if e.code not in (None, 0):
            print(f'SystemExit: {e.code}', file=sys.stderr)
    except BaseException as e:
        from bdb import BdbQuit
        if isinstance(e, BdbQuit):
            return
        tb = sys.exc_info()[2]
        _user_tb()
        if o.post_mortem and _can_ask():
            p = IDEPdb()
            p.reset()
            p.interaction(None, tb)
    finally:
        sys.argv[:] = old_argv
        if ns is not shell.user_ns:
            # (what the script made is in the console's namespace afterwards, as in Spyder)
            for k, v in ns.items():
                if not (k.startswith('__') and k.endswith('__')):
                    shell.user_ns[k] = v
        _emit({'type': 'cwd', 'cwd': os.getcwd()})


def _debug(code, ns, filename):
    if not _can_ask():
        print('The debugger needs to wait for what you type, which this page cannot do because it is not cross-origin '
              'isolated (the IDE help explains why). The code was not run.', file=sys.stderr)
        return
    dbg = IDEPdb()
    for path, lines in BREAKPOINTS.items():
        for ln in lines:
            dbg.set_break(path, ln)
    # with breakpoints, the debugger runs on to the first one; without, it stops at the first line
    dbg.to_breakpoint = bool(BREAKPOINTS.get(filename))
    try:
        dbg.run(code, ns)
    finally:
        STATE['debugging'] = False
        _emit({'type': 'debug-end'})


def _chdir(o):
    if o.wdir:
        d = o.wdir_path or os.path.dirname(o.path)
        if os.path.isdir(d):
            os.chdir(d)


def _file_text(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def m_runfile(line):
    """%runfile FILENAME [--wdir [WDIR]] [--args ARGS] [--post-mortem] [--current-namespace]: run a file, as Spyder's
    Run file (F5) does"""
    __tracebackhide__ = True
    o = _parse(line)
    if not o.path or not os.path.isfile(o.path):
        print(f'ERROR: {o.path or "(no file)"} not found.', file=sys.stderr)
        return
    _chdir(o)
    text = _file_text(o.path)
    _exec(text, o.path, o, text=text)


def m_debugfile(line):
    """%debugfile FILENAME [--wdir [WDIR]] [--args ARGS]: run a file in the debugger"""
    __tracebackhide__ = True
    o = _parse(line)
    if not o.path or not os.path.isfile(o.path):
        print(f'ERROR: {o.path or "(no file)"} not found.', file=sys.stderr)
        return
    _chdir(o)
    text = _file_text(o.path)
    _exec(text, o.path, o, debug=True, text=text)


def _cell_cmd(line, debug):
    o = _parse(line)
    if o.index is None or not o.path:
        print('Usage: %runcell -i INDEX FILENAME', file=sys.stderr)
        return
    try:
        code, first, full = _cell_of(o.path, o.index)
    except (OSError, IndexError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return
    # (the traceback shows the lines of the cell as they are in the editor, saved or not)
    _exec(code, o.path, o, first_line=first, cell=True, debug=debug, text=full)


def m_runcell(line):
    """%runcell -i INDEX FILENAME: run one cell of a file (the code between two #%% lines) in the console's namespace"""
    __tracebackhide__ = True
    _cell_cmd(line, False)


def m_debugcell(line):
    """%debugcell -i INDEX FILENAME: run one cell of a file in the debugger"""
    __tracebackhide__ = True
    _cell_cmd(line, True)


def m_clear(line):
    """%clear: clear the console"""
    _emit({'type': 'clear'})


def m_matplotlib(line):
    """%matplotlib: plots are shown in the Plots pane here (the inline backend); other backends need a desktop"""
    a = line.strip()
    if a and a not in ('inline',):
        print(f'Using the inline backend: the "{a}" backend needs a desktop, so plots appear in the Plots pane.')


def m_ls(line):
    """%ls [FOLDER]: the files of a folder"""
    d = os.path.expanduser(line.strip() or '.')
    try:
        names = sorted(os.listdir(d), key=str.lower)
    except OSError as e:
        print(f'ls: {e.strerror}: {line.strip()}', file=sys.stderr)
        return
    shown = [n + ('/' if os.path.isdir(os.path.join(d, n)) else '') for n in names if not n.startswith('.')]
    if not shown:
        return
    w = max(len(s) for s in shown) + 2
    cols = max(1, 100 // w)
    for i in range(0, len(shown), cols):
        print(''.join(s.ljust(w) for s in shown[i:i + cols]).rstrip())


def m_cat(line):
    """%cat FILE: print a file"""
    for p in shlex.split(line):
        try:
            print(_file_text(os.path.expanduser(p)), end='')
        except OSError as e:
            print(f'cat: {p}: {e.strerror}', file=sys.stderr)


def m_mkdir(line):
    """%mkdir FOLDER: make a folder"""
    for p in shlex.split(line):
        if p.startswith('-'):
            continue
        os.makedirs(os.path.expanduser(p), exist_ok=True)


# ---------------------------------------------------------------------------------------------------------------
# the Variable Explorer: what it lists, what it shows, what it changes (after Spyder's spyder_kernels.utils.nsview)
# ---------------------------------------------------------------------------------------------------------------
FILTERS = {'private': True, 'uppercase': True, 'capitalized': False, 'unsupported': False, 'callables': True}
_HIDDEN = {'In', 'Out', 'exit', 'quit', 'get_ipython', '_ide_sh', '_ide_pip'}


def _np():
    return sys.modules.get('numpy')


def _pd():
    return sys.modules.get('pandas')


def _kind(v):
    """what the Variable Explorer opens for a value"""
    np, pd = _np(), _pd()
    if pd is not None:
        if isinstance(v, pd.DataFrame):
            return 'dataframe'
        if isinstance(v, pd.Series):
            return 'series'
        if isinstance(v, pd.Index):
            return 'index'
    if np is not None:
        if isinstance(v, np.ndarray):
            return 'array'
        if isinstance(v, np.generic):
            return 'number'
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, (int, float, complex)):
        return 'number'
    if isinstance(v, str):
        return 'text'
    if isinstance(v, bytes):
        return 'bytes'
    if isinstance(v, (list, tuple, set, frozenset, dict)):
        return 'collection'
    if isinstance(v, (datetime.date, datetime.datetime, datetime.timedelta)):
        return 'date'
    if v is None:
        return 'none'
    return 'object'


def _supported(v):
    return _kind(v) != 'object'


def _type_name(v):
    np, pd = _np(), _pd()
    try:
        if np is not None and isinstance(v, np.ndarray):
            return 'Array of ' + v.dtype.name
        if pd is not None:
            if isinstance(v, pd.DataFrame):
                return 'DataFrame'
            if isinstance(v, pd.Series):
                return 'Series'
            if isinstance(v, pd.Index):
                return type(v).__name__
        m = re.findall(r"<(?:type|class) '(\S*)'>", str(type(v)))
        if not m:
            return 'Unknown'
        t = 'class' if m[0] == 'type' else m[0]
        return t[t.find('.') + 1:]
    except Exception:
        return 'Unknown'


def _size(v):
    try:
        shape = getattr(v, 'shape', None)
        if isinstance(shape, tuple):
            return list(shape) if shape else 1
        if hasattr(v, '__len__') and not isinstance(v, type):
            return len(v)
    except Exception:
        pass
    return 1


def _short(s, n=300):
    s = str(s)
    return s if len(s) <= n else s[:n] + ' ...'


def _collection_text(v, level=0):
    if level > 1:
        return {list: '[...]', tuple: '(...)', set: '{...}', frozenset: 'frozenset({...})', dict: '{...}'}.get(type(v), '...')
    if isinstance(v, dict):
        items = list(v.items())
        inner = ', '.join(f'{_value_text(k, level + 1)}: {_value_text(x, level + 1)}' for k, x in items[:10])
        return '{' + inner + (', ...' if len(items) > 10 else '') + '}'
    items = list(v)
    inner = ', '.join(_value_text(x, level + 1) for x in items[:10]) + (', ...' if len(items) > 10 else '')
    if isinstance(v, tuple):
        return '(' + inner + (',' if len(items) == 1 else '') + ')'
    if isinstance(v, (set, frozenset)):
        return ('{' + inner + '}') if items else 'set()'
    return '[' + inner + ']'


def _value_text(v, level=0):
    """the Value column (Spyder's value_to_display)"""
    np, pd = _np(), _pd()
    try:
        if pd is not None:
            if isinstance(v, pd.DataFrame):
                return 'Column names: ' + ', '.join(str(c) for c in v.columns) if level == 0 else 'DataFrame'
            if isinstance(v, (pd.Series, pd.Index)):
                return f'{type(v).__name__} object of {type(v).__module__} module'
        if np is not None and isinstance(v, np.ndarray):
            if v.dtype.kind in 'biufc':
                with np.printoptions(threshold=20, edgeitems=3, linewidth=10000):
                    return ' '.join(str(v).split())
            return f'{type(v).__name__} object of numpy module'
        if isinstance(v, (list, tuple, set, frozenset, dict)):
            return _collection_text(v, level)
        if isinstance(v, str):
            return repr(v) if level else v
        if isinstance(v, bytes):
            return repr(v)
        if isinstance(v, (bool, int, float, complex)) or v is None:
            return repr(v)
        if np is not None and isinstance(v, np.generic):
            return str(v)
        if isinstance(v, (datetime.date, datetime.datetime, datetime.timedelta)):
            return str(v)
        if level:
            return f'<{type(v).__name__}>'
        return f'{type(v).__name__} object of {type(v).__module__} module'
    except Exception:
        return f'{type(v).__name__} object'


def _color(v):
    """the colour of a variable's row (Spyder's get_color_name)"""
    np, pd = _np(), _pd()
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, (int, float, complex)):
        return 'scalar'
    if isinstance(v, list):
        return 'list'
    if isinstance(v, (set, frozenset)):
        return 'set'
    if isinstance(v, dict):
        return 'dict'
    if isinstance(v, tuple):
        return 'tuple'
    if isinstance(v, (str, bytes)):
        return 'text'
    if isinstance(v, (datetime.date, datetime.timedelta)):
        return 'date'
    if np is not None:
        if isinstance(v, np.ndarray):
            return 'array'
        if isinstance(v, np.generic):
            return 'scalar'
    if pd is not None and isinstance(v, (pd.DataFrame, pd.Series, pd.Index)):
        return 'frame'
    if v is None:
        return 'none'
    return 'custom'


def _row(name, v):
    return {'name': str(name), 'type': _type_name(v), 'size': _size(v), 'value': _short(_value_text(v)).replace('\n', ' '),
            'color': _color(v), 'kind': _kind(v)}


def _visible(name, v, f):
    if not isinstance(name, str) or name in _HIDDEN:
        return False
    if shell is not None and name in shell.user_ns_hidden and shell.user_ns_hidden[name] is v:
        return False
    if f.get('private', True) and name.startswith('_'):
        return False
    if f.get('uppercase', True) and len(name) > 1 and name.isupper():
        return False
    if f.get('capitalized') and name[:1].isupper():
        return False
    if f.get('callables', True) and (isinstance(v, (types.ModuleType, type)) or (callable(v) and _kind(v) == 'object')):
        return False
    if f.get('unsupported') and not _supported(v):
        return False
    return True


def _var_list(ns, f):
    out = []
    for name in sorted(ns, key=lambda n: str(n).lower()):
        v = ns[name]
        try:
            if _visible(name, v, f):
                out.append(_row(name, v))
        except Exception:
            continue
    return out


def _namespace():
    """the namespace the Variable Explorer shows: the console's – or, while the debugger has stopped, the frame's"""
    return shell.user_ns


def _resolve(path):
    """a value from a path: [name, position, position …] – the position of an item in a list, tuple, set or dict"""
    v = _namespace()[path[0]]
    for step in path[1:]:
        if isinstance(v, dict):
            v = v[list(v.keys())[step]]
        elif isinstance(v, (set, frozenset)):
            v = list(v)[step]
        else:
            v = v[step]
    return v


def _jv(x, kind):
    """a value of a table as JSON can carry it (a missing value is null, an infinite one is text)"""
    if x is None:
        return None
    if kind == 'b':
        return bool(x)
    if kind in 'iu':
        return int(x)
    if kind == 'f':
        f = float(x)
        if f != f:
            return None
        if f in (float('inf'), float('-inf')):
            return 'inf' if f > 0 else '-inf'
        return f
    if isinstance(x, float) and x != x:
        return None
    return str(x)


MAX_CELLS = 400000


def _frame_data(df, title):
    np, pd = _np(), _pd()
    nrow, ncol = df.shape
    shown = min(nrow, max(1, MAX_CELLS // max(1, ncol)))
    part = df.iloc[:shown]
    cols = []
    for j in range(ncol):
        col = part.iloc[:, j]
        kind = col.dtype.kind
        cols.append({'name': str(df.columns[j]), 'dtype': str(col.dtype), 'kind': kind, 'values': [_jv(x, kind) for x in col.tolist()]})
    index = [str(x) for x in part.index.tolist()]
    return {'kind': 'dataframe', 'title': title, 'nrow': nrow, 'ncol': ncol, 'shown': shown, 'index': index,
            'index_name': str(df.index.name) if df.index.name is not None else '', 'columns': cols}


def view(path):
    """what the Variable Explorer's viewers show (DataFrame, Series, array, collection, text, object)"""
    v = _resolve(path)
    title = path[0] + ''.join(f'[{p}]' for p in path[1:])
    k = _kind(v)
    np, pd = _np(), _pd()
    if k == 'dataframe':
        return _frame_data(v, title)
    if k in ('series', 'index'):
        df = v.to_frame() if k == 'series' else pd.DataFrame({str(v.name or 'value'): v})
        d = _frame_data(df, title)
        d['kind'] = k
        return d
    if k == 'array':
        a = v
        if a.ndim == 0:
            a = a.reshape(1)
        if a.ndim > 2:
            return {'kind': 'array', 'title': title, 'shape': list(v.shape), 'dtype': str(v.dtype),
                    'note': f'This array has {v.ndim} dimensions. The table shows the first two, at position 0 of the others.',
                    'rows': _array_rows(a[(slice(None), slice(None)) + (0,) * (a.ndim - 2)]), 'numeric': a.dtype.kind in 'biuf'}
        return {'kind': 'array', 'title': title, 'shape': list(v.shape), 'dtype': str(v.dtype), 'rows': _array_rows(a), 'numeric': a.dtype.kind in 'biuf'}
    if k == 'collection':
        if isinstance(v, dict):
            items = [(repr(key) if not isinstance(key, str) else key, x) for key, x in v.items()]
            label = 'Key'
        else:
            items = list(enumerate(v))
            label = 'Index'
        rows = []
        for i, (key, x) in enumerate(items[:5000]):
            r = _row(key, x)
            r['pos'] = i
            rows.append(r)
        return {'kind': 'collection', 'title': title, 'type': type(v).__name__, 'label': label, 'rows': rows,
                'total': len(items), 'editable': isinstance(v, (list, dict))}
    if k in ('text', 'bytes'):
        return {'kind': 'text', 'title': title, 'text': v if isinstance(v, str) else repr(v), 'editable': isinstance(v, str)}
    if k in ('number', 'bool', 'none', 'date'):
        return {'kind': 'scalar', 'title': title, 'text': repr(v) if not (np is not None and isinstance(v, np.generic)) else str(v), 'type': _type_name(v)}
    # anything else: its attributes (as Spyder's Object Explorer)
    attrs = []
    for a in dir(v):
        if a.startswith('__'):
            continue
        try:
            x = getattr(v, a)
        except Exception:
            continue
        if callable(x):
            continue
        attrs.append({'name': a, 'type': _type_name(x), 'value': _short(_value_text(x, 1), 200)})
    return {'kind': 'object', 'title': title, 'type': _type_name(v), 'repr': _short(repr(v), 2000), 'attrs': attrs[:500]}


def _array_rows(a):
    a = a if a.ndim == 2 else a.reshape(-1, 1)
    rows = min(a.shape[0], max(1, MAX_CELLS // max(1, a.shape[1])))
    kind = a.dtype.kind
    return [[_jv(x, kind) for x in r] for r in a[:rows].tolist()]


def variables(filters=None):
    FILTERS.update(filters or {})
    return _var_list(_namespace(), FILTERS)


def set_value(path, text, as_text=False):
    """a value changed in the Variable Explorer: text is Python (a number, a list …) – or, for a string, the text itself"""
    if as_text:
        value = text
    else:
        try:
            value = ast.literal_eval(text)
        except Exception:
            value = eval(text, shell.user_ns)
    if len(path) == 1:
        _namespace()[path[0]] = value
    else:
        parent = _resolve(path[:-1])
        if isinstance(parent, dict):
            parent[list(parent.keys())[path[-1]]] = value
        else:
            parent[path[-1]] = value
    return True


def remove(names):
    ns = _namespace()
    for n in names:
        ns.pop(n, None)
    return True


def rename(old, new):
    if not new.isidentifier():
        return {'error': f'“{new}” cannot be the name of a variable: a name is made of letters, digits and underscores, and does not start with a digit.'}
    ns = _namespace()
    ns[new] = ns.pop(old)
    return True


def duplicate(old, new):
    import copy
    if not new.isidentifier():
        return {'error': f'“{new}” cannot be the name of a variable: a name is made of letters, digits and underscores, and does not start with a digit.'}
    ns = _namespace()
    ns[new] = copy.deepcopy(ns[old])
    return True


def reset_namespace():
    shell.reset(new_session=False)
    return True


def plot_var(name, how):
    """Plot / Histogram / Show image of a variable (the Variable Explorer's menu): to the Plots pane"""
    import matplotlib.pyplot as plt
    v = _namespace()[name]
    plt.figure()
    if how == 'hist':
        plt.hist(v)
    elif how == 'image':
        plt.imshow(v)
        plt.colorbar()
    else:
        plt.plot(v)
    _figures()


# ---------------------------------------------------------------------------------------------------------------
# completion, help, code analysis
# ---------------------------------------------------------------------------------------------------------------
def complete(code, cursor):
    """Tab in the console: IPython's completions → {start, end, items}"""
    from IPython.core.completer import provisionalcompleter
    try:
        with provisionalcompleter():
            cs = list(shell.Completer.completions(code, int(cursor)))
    except Exception:
        cs = []
    if not cs:
        return {'start': cursor, 'end': cursor, 'items': []}
    start = min(c.start for c in cs)
    end = max(c.end for c in cs)
    items = []
    seen = set()
    for c in cs:
        text = code[start:c.start] + c.text + code[c.end:end]
        if text in seen:
            continue
        seen.add(text)
        items.append({'text': text, 'type': c.type or ''})
    return {'start': start, 'end': end, 'items': items[:400]}


def inspect(name):
    """the Help pane: the documentation of an object of the console's namespace"""
    try:
        info = shell.object_inspect(name, detail_level=0)
    except Exception:
        info = {'found': False}
    if not info.get('found'):
        return {'found': False, 'name': name}
    keys = ('type_name', 'base_class', 'string_form', 'namespace', 'length', 'file', 'definition', 'docstring',
            'init_definition', 'class_docstring', 'init_docstring', 'call_def', 'call_docstring', 'isclass', 'ismagic')
    out = {k: info.get(k) for k in keys if info.get(k) not in (None, '')}
    out.update({'found': True, 'name': name})
    return out


_JEDI = [None]


def _jedi():
    if _JEDI[0] is None:
        import jedi
        jedi.settings.cache_directory = '/tmp/jedi'
        _JEDI[0] = jedi
    return _JEDI[0]


def jedi_complete(source, line, col, path=''):
    """completion in the editor (as Spyder's, which asks jedi through its language server)"""
    jedi = _jedi()
    try:
        cs = jedi.Script(source, path=path or None).complete(int(line), int(col))
    except Exception:
        cs = []
    return [{'name': c.name, 'complete': c.complete, 'type': c.type} for c in cs[:300]]


def jedi_help(source, line, col, path=''):
    """Ctrl+I in the editor when the name is not in the console's namespace: what jedi knows about it"""
    jedi = _jedi()
    try:
        names = jedi.Script(source, path=path or None).help(int(line), int(col))
    except Exception:
        names = []
    for n in names:
        doc = n.docstring(raw=True) or ''
        sig = ''
        try:
            sigs = n.get_signatures()
            if sigs:
                sig = sigs[0].to_string()
        except Exception:
            pass
        return {'found': True, 'name': n.full_name or n.name, 'type_name': n.type, 'definition': sig, 'docstring': doc, 'module': n.module_name}
    return {'found': False}


def jedi_goto(source, line, col, path=''):
    """Go to definition (Ctrl+G)"""
    jedi = _jedi()
    try:
        ds = jedi.Script(source, path=path or None).goto(int(line), int(col), follow_imports=True)
    except Exception:
        ds = []
    return [{'path': str(d.module_path) if d.module_path else '', 'line': d.line, 'col': d.column, 'name': d.name} for d in ds[:1]]


def lint(source, path=''):
    """code analysis: Python's own check for syntax errors, then pyflakes's warnings (if it is there)"""
    out = []
    try:
        compile(source, path or '<editor>', 'exec', dont_inherit=True)
    except SyntaxError as e:
        out.append({'line': e.lineno or 1, 'col': (e.offset or 1) - 1, 'msg': e.msg, 'level': 'error', 'code': 'E'})
        return out
    except Exception:
        return out
    try:
        from pyflakes import api, reporter
    except ImportError:
        return out

    class _R(reporter.Reporter):
        def __init__(self):
            pass

        def unexpectedError(self, filename, msg):
            pass

        def syntaxError(self, filename, msg, lineno, offset, text):
            out.append({'line': lineno or 1, 'col': (offset or 1) - 1, 'msg': msg, 'level': 'error', 'code': 'E'})

        def flake(self, m):
            out.append({'line': m.lineno, 'col': getattr(m, 'col', 0), 'msg': m.message % m.message_args, 'level': 'warning', 'code': type(m).__name__})

    api.check(source, path or '<editor>', _R())
    return out


# ---------------------------------------------------------------------------------------------------------------
# start, and what the page calls
# ---------------------------------------------------------------------------------------------------------------
def start(opts_json='{}'):
    global shell
    opts = json.loads(opts_json or '{}')
    SETTINGS.update({k: v for k, v in opts.items() if k in SETTINGS})
    _CAN_ASK[0] = bool(opts.get('can_ask'))
    # (the notebook's worker shows every warning once: here Python's own rules apply again, as in IPython)
    import warnings
    warnings.resetwarnings()
    warnings.filterwarnings('default', category=DeprecationWarning, module='__main__', append=True)
    for cat in (DeprecationWarning, PendingDeprecationWarning, ImportWarning, ResourceWarning):
        warnings.filterwarnings('ignore', category=cat, append=True)
    # (the console shows any character: IPython writes µs and ± – in %timeit – only to a stream that says so)
    for s in (sys.stdout, sys.stderr):
        try:
            type(s).encoding = 'utf-8'
        except Exception:
            pass
    c = Config()
    c.HistoryManager.enabled = False
    # (Spyder's console completes without jedi, which is slow to start; the editor uses jedi)
    c.IPCompleter.use_jedi = False
    c.InteractiveShell.autoindent = False
    c.InteractiveShell.colors = 'linux' if SETTINGS['dark'] else 'lightbg'
    c.InteractiveShell.xmode = 'Plain'
    shell = IDEShell.instance(config=c)
    shell.autoawait = True
    shell.input_transformers_cleanup.insert(0, _escapes)
    # (IPython's own %ls, %cat … are aliases of shell commands, which the browser has not got: magics of this module do
    # the work instead)
    try:
        shell.alias_manager.clear_aliases()
    except Exception:
        pass
    for name, fn in (('runfile', m_runfile), ('runcell', m_runcell), ('debugfile', m_debugfile), ('debugcell', m_debugcell),
                     ('clear', m_clear), ('cls', m_clear), ('matplotlib', m_matplotlib), ('ls', m_ls), ('cat', m_cat), ('mkdir', m_mkdir)):
        shell.register_magic_function(fn, 'line', name)
    shell.events.register('post_execute', _post_execute)
    shell.set_hook('show_in_pager', lambda self, data, start=0, screen_lines=0: print(data.get('text/plain', '') if isinstance(data, dict) else data))
    shell.user_ns.update(_HELPERS)
    shell.user_ns_hidden.update(_HELPERS)
    builtins.input = _input
    import getpass
    getpass.getpass = _getpass
    import time
    if _SLEEP[0] is None:
        _SLEEP[0] = time.sleep
        time.sleep = _sleep
    sys.breakpointhook = _breakpoint
    sys.meta_path.insert(0, _PyplotHook())
    if 'matplotlib.pyplot' in sys.modules:
        _setup_pyplot(sys.modules['matplotlib.pyplot'])
    return json.dumps({'ipython': _release.version, 'banner': shell.banner, 'count': shell.execution_count, 'cwd': os.getcwd()})


def settings(opts):
    SETTINGS.update({k: v for k, v in (opts or {}).items() if k in SETTINGS})
    if 'dark' in (opts or {}):
        try:
            shell.colors = 'linux' if SETTINGS['dark'] else 'lightbg'
        except Exception:
            pass
    return True


async def run_cell(code, silent=False, extra_json='{}'):
    """run what was typed into the console (or sent by the editor) → {ok, count, cwd}"""
    extra = json.loads(extra_json or '{}')
    for c in extra.get('cells', []):
        CELLS[(c['path'], c['index'])] = (c['code'], c['first'], c.get('text') or ('\n' * (c['first'] - 1) + c['code']))
    if 'breakpoints' in extra:
        BREAKPOINTS.clear()
        BREAKPOINTS.update({p: list(ls) for p, ls in extra['breakpoints'].items() if ls})
    STATE['errors'] = 0
    try:
        cell = shell.transform_cell(code)
        exc = None
    except Exception:
        cell = code
        exc = sys.exc_info()
    res = await shell.run_cell_async(code, store_history=not silent, silent=bool(silent), transformed_cell=cell, preprocessing_exc_tuple=exc)
    ok = bool(res.success) and STATE['errors'] == 0
    return json.dumps({'ok': ok, 'count': shell.execution_count, 'cwd': os.getcwd()})


def call(name, args_json='[]'):
    """the page's other requests, with their arguments as a JSON list → the answer as JSON"""
    fn = {'variables': variables, 'view': view, 'set_value': set_value, 'remove': remove, 'rename': rename,
          'duplicate': duplicate, 'reset_namespace': reset_namespace, 'complete': complete, 'inspect': inspect,
          'jedi_complete': jedi_complete, 'jedi_help': jedi_help, 'jedi_goto': jedi_goto, 'lint': lint,
          'settings': settings}.get(name)
    if fn is None:
        return json.dumps({'error': f'no such request: {name}'})
    try:
        return json.dumps(fn(*json.loads(args_json or '[]')), default=str)
    except Exception as e:
        return json.dumps({'error': f'{type(e).__name__}: {e}'})
