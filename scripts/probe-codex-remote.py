"""No model calls or authentication material; disposable existing-VM transport proof."""
import argparse, base64, hashlib, json, os, pathlib, queue, shutil, subprocess, sys, tempfile, threading, time, uuid

D = [shutil.which('docker') or '/opt/homebrew/bin/docker', '--host', f'unix://{pathlib.Path.home()}/.colima/pazmo-office/docker.sock']
IMAGE = 'node@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', required=True, help='Verified official Linux arm64 Codex 0.154.0 binary')
parser.add_argument('--mock-controller', action='store_true', help='Also test local Codex 0.155.1 against a fixed localhost model fixture')
options = parser.parse_args()
BINARY = options.binary
with open(BINARY, 'rb') as binary_file:
    binary_hash = hashlib.sha256()
    for chunk in iter(lambda: binary_file.read(1024 * 1024), b''):
        binary_hash.update(chunk)
if binary_hash.hexdigest() != '9b7c1c7abdc26fc3c4f47c77656a8e9121def5483dbae830ef1ee561758448a9':
    raise SystemExit('Refusing unverified exec-server binary')
root = pathlib.Path(tempfile.mkdtemp(prefix='pazmo-exec-server-', dir='/private/tmp'))
name = 'pazmo-exec-probe-' + uuid.uuid4().hex
volume = name + '-bin'
created = []
volume_created = False
child = None
report = {'scope': 'unauthenticated exec-server in disposable isolated VM container', 'liveReady': False,
          'fixtureRoot': str(root), 'events': [], 'checks': [], 'errors': []}
def run(args):
    process = subprocess.Popen(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=60)
    except subprocess.TimeoutExpired:
        import signal
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise
    if process.returncode:
        raise RuntimeError(f'Command failed ({process.returncode}): {args[0]}: {stderr[:1000]}')
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
def check(name, passed):
    report['checks'].append({'name': name, 'passed': bool(passed)})
try:
    if run(D + ['info', '--format', '{{.Name}}']).stdout.strip() != 'colima-pazmo-office':
        raise RuntimeError('Refusing a daemon other than the dedicated VM')
    if options.mock_controller:
        codex = shutil.which('codex')
        if not codex or run([codex, '--version']).stdout.strip() != 'codex-cli 0.155.1':
            raise RuntimeError('Mock controller probe requires observed Codex CLI 0.155.1')
    fake = root / 'private-controller-canary'; fake.write_text('FAKE SECRET ONLY')
    run(D + ['volume', 'create', '--label', 'pazmo.probe=' + name, volume]); volume_created = True
    seed = name + '-seed'
    run(D + ['create', '--name', seed, '--pull', 'never', '--network', 'none', '--mount',
             f'type=volume,src={volume},dst=/runner', IMAGE, 'true']); created.append(seed)
    run(D + ['cp', BINARY, seed + ':/runner/codex'])
    flags = ['create', '--name', name, '--pull', 'never', '--interactive', '--network', 'none',
             '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
             '--pids-limit', '64', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
             '--tmpfs', '/work:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000,mode=700',
             '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000,mode=700',
             '--env', 'HOME=/work', '--env', 'CODEX_HOME=/work/codex-home', '--workdir', '/work',
             '--mount', f'type=volume,src={volume},dst=/runner,readonly,volume-nocopy',
             '--entrypoint', '/runner/codex', IMAGE, 'exec-server', '--listen', 'stdio']
    run(D + flags); created.append(name)
    stderr = open(root / 'stderr.txt', 'w')
    child = subprocess.Popen(D + ['start', '--attach', '--interactive', name], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=stderr, text=True, bufsize=1)
    incoming = queue.Queue()
    def read():
        for line in child.stdout:
            try: incoming.put(json.loads(line))
            except Exception: incoming.put({'unparsed': line[:200]})
        incoming.put({'eof': True})
    threading.Thread(target=read, daemon=True).start()
    counter = 0
    def rpc(method, params):
        global counter
        counter += 1
        child.stdin.write(json.dumps({'id': counter, 'method': method, 'params': params}) + '\n'); child.stdin.flush()
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            event = incoming.get(timeout=max(.1, deadline - time.monotonic()))
            if event.get('id') == counter:
                report['events'].append({'method': method, 'response': event})
                return event
            if event.get('eof'): raise RuntimeError('exec-server EOF')
        raise TimeoutError(method)
    initialized = rpc('initialize', {'clientName': 'pazmo-isolation-probe'})
    check('official-exec-server-initialized', 'result' in initialized)
    child.stdin.write(json.dumps({'method': 'initialized', 'params': {}}) + '\n'); child.stdin.flush()
    payload = """const fs = require('fs');
fs.writeFileSync('/work/result.txt', 'tool execution works');
const r = {write: fs.readFileSync('/work/result.txt','utf8') === 'tool execution works'};
try {fs.readFileSync(%s);r.hostControllerDenied=false;} catch {r.hostControllerDenied=true;}
try {fs.writeFileSync('/runner/codex','corrupt');r.runtimeReadonly=false;} catch {r.runtimeReadonly=true;}
r.authAbsent=!fs.existsSync('/work/codex-home/auth.json');
console.log(JSON.stringify(r));
""" % json.dumps(str(fake))
    started = rpc('process/start', {'processId': 'probe', 'argv': ['node', '-e', payload],
                                  'cwd': 'file:///work', 'env': {}, 'tty': False, 'arg0': None})
    check('remote-process-started', 'result' in started)
    output = ''
    if 'result' in started:
        cursor = None
        for _ in range(20):
            response = rpc('process/read', {'processId': 'probe', 'afterSeq': cursor,
                                           'maxBytes': 65536, 'waitMs': 500})
            result = response.get('result', {})
            output += ''.join(base64.b64decode(c['chunk']).decode() for c in result.get('chunks', []))
            if result.get('chunks'): cursor = result['chunks'][-1]['seq']
            if result.get('closed'):
                check('remote-process-exit-zero', result.get('exitCode') == 0)
                break
        report['processOutput'] = output
        for k,v in json.loads(output).items(): check(k, v)
    fsresult = rpc('fs/readFile', {'path': 'file:///work/result.txt', 'sandbox': None})
    check('remote-filesystem-read', base64.b64decode(fsresult.get('result', {}).get('dataBase64', '')).decode() == 'tool execution works')
    denied = rpc('fs/readFile', {'path': fake.as_uri(), 'sandbox': None})
    check('rpc-host-controller-denied', 'error' in denied)
    inspect = json.loads(run(D + ['inspect', name]).stdout)[0]
    check('no-host-bind-mounts', all(m['Type'] != 'bind' for m in inspect['Mounts']))
    check('container-network-none', inspect['HostConfig']['NetworkMode'] == 'none')
    check('container-capabilities-dropped', inspect['HostConfig']['CapDrop'] == ['ALL'])
    if options.mock_controller:
        mock = run([shutil.which('node') or 'node', str(pathlib.Path(__file__).with_suffix('.mjs')), name, str(root), codex])
        report['mockController'] = json.loads(mock.stdout)
        marker = rpc('fs/readFile', {'path': 'file:///work/model-tool.txt', 'sandbox': None})
        check('mock-controller-tool-executed-remotely', base64.b64decode(marker.get('result', {}).get('dataBase64', '')).decode() == 'REMOTE_CODEX_TOOL')
        check('mock-controller-no-host-write', not (root / 'unexpected-host-write').exists())
        controller = json.loads((root / 'mock-controller-report.json').read_text())
        check('mock-controller-explicit-local-denied', not (root / 'forbidden-local-fallback').exists() and 'unknown turn environment id `local`' in controller['stderr'])
        check('mock-controller-exit-zero', controller['exit'] == {'code': 0, 'signal': None})
        patch = rpc('fs/readFile', {'path': 'file:///work/patched.txt', 'sandbox': None})
        check('mock-controller-patch-executed-remotely', base64.b64decode(patch.get('result', {}).get('dataBase64', '')).decode() == 'REMOTE_CODEX_PATCH\n')
except Exception as error:
    report['errors'].append(str(error))
finally:
    for item in reversed(created):
        try: run(D + ['rm', '--force', item])
        except Exception as error: report['errors'].append('cleanup: ' + str(error))
    if child:
        try: child.wait(timeout=5)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
    if volume_created:
        try: run(D + ['volume', 'rm', volume])
        except Exception as error: report['errors'].append('volume cleanup: ' + str(error))
    (root / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'report': str(root / 'report.json'), 'checks': report['checks'], 'errors': report['errors']}))

sys.exit(1 if report['errors'] or not report['checks'] or not all(c['passed'] for c in report['checks']) else 0)
