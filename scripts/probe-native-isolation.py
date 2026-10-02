"""Diagnostic only; never grants permission or enables model execution.

All targets are disposable fixtures owned by this probe, not user credentials.
Usage: python3 scripts/probe-native-isolation.py ABSOLUTE_CODEX ABSOLUTE_NODE [FIXTURE_PARENT]
"""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile

if sys.platform != "darwin" or len(sys.argv) not in (3, 4):
    raise SystemExit(__doc__)
codex, node = (str(Path(p).resolve(strict=True)) for p in sys.argv[1:3])
parent = str(Path(sys.argv[3]).resolve(strict=True)) if len(sys.argv) == 4 else "/private/tmp"
root = Path(tempfile.mkdtemp(prefix="pazmo-isolation-", dir=parent))
work, config = root / "work", root / "codex-config"
for path in [work, config, root / "fake-home", root / "controller", root / "other-project"]:
    path.mkdir(mode=0o700)
targets = [root / p for p in [
    "controller/approval.sqlite", "controller/operator-token", "controller/policy.json",
    "fake-home/auth.json", "other-project/source.txt"
]]
for path in targets:
    path.write_text("DISPOSABLE CANARY")
    path.chmod(0o600)
(work / "outside-link").symlink_to(root / "controller")
filesystem = {":minimal": "read", "/System/Library/OpenSSL": "read",
              str(Path(node).parent.parent): "read", str(work): "write",
              str(root / "controller"): "deny", str(root / "fake-home"): "deny",
              str(root / "other-project"): "deny"}
(config / "config.toml").write_text(
    "[permissions.pazmo.filesystem]\n"
    + "\n".join(json.dumps(k) + " = " + json.dumps(v) for k, v in filesystem.items())
    + "\n[permissions.pazmo.network]\nenabled = false\n"
)
signals = []
signal.signal(signal.SIGUSR1, lambda *_: signals.append("SIGUSR1"))
tcp = socket.socket()
tcp.bind(("127.0.0.1", 0))
tcp.listen()
unix = socket.socket(socket.AF_UNIX)
socket_path = str(root / "controller/socket")
if len(socket_path.encode()) >= 100:
    socket_path = str(Path(tempfile.mkdtemp(prefix="pazmo-socket-", dir="/private/tmp")) / "socket")
unix.bind(socket_path)
unix.listen()
parameters = {
    "work": str(work), "targets": [str(p) for p in targets], "pid": os.getpid(),
    "port": tcp.getsockname()[1], "socket": socket_path, "codex": codex,
}
payload = "const p = " + json.dumps(parameters) + ";\n" + """
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {connect} from 'node:net';
const out=[];
const probe=(name,fn,expect)=>{
  try{fn();out.push({name,actual:'allowed',expect})}
  catch(e){out.push({name,actual:e.code==='EPERM'||e.code==='EACCES'?'denied':'error',code:e.code,expect})}
};
probe('workspace-write',()=>writeFileSync(p.work+'/own.txt','ok'),'allowed');
for(const target of p.targets) {
  probe('read:'+target,()=>readFileSync(target),'denied');
  probe('write:'+target,()=>writeFileSync(target,'CHANGED'),'denied');
}
probe('symlink-escape',()=>readFileSync(p.work+'/outside-link/operator-token'),'denied');
probe('controller-signal',()=>process.kill(p.pid,'SIGUSR1'),'denied');
const child=spawnSync(process.execPath,['-e',"require('node:fs').readFileSync("+JSON.stringify(p.targets[1])+")"],{encoding:'utf8'});
out.push({name:'child-read',actual:child.status===0?'allowed':/EPERM|EACCES/.test(child.stderr||'')?'denied':'error',expect:'denied'});
const nested=spawnSync(p.codex,['--version'],{encoding:'utf8',timeout:3000});
out.push({name:'new-codex-child',actual:nested.status===0?'allowed':nested.error?.code==='EPERM'||nested.error?.code==='EACCES'?'denied':'error',expect:'denied',code:nested.error?.code,status:nested.status,signal:nested.signal,stderr:nested.stderr});
for(const [name,target] of [['controller-tcp',{host:'127.0.0.1',port:p.port}],['controller-unix',{path:p.socket}]]) {
  const result=await new Promise(resolve=>{
    const s=connect(target);s.setTimeout(2000);
    s.once('connect',()=>{s.destroy();resolve('allowed')});
    s.once('error',e=>resolve(e.code==='EPERM'||e.code==='EACCES'?'denied':'error:'+e.code));
    s.once('timeout',()=>{s.destroy();resolve('timeout')})
  });
  out.push({name,actual:result,expect:'denied'});
}
console.log(JSON.stringify(out));
"""
(work / "probe.mjs").write_text(payload)
try:
    result = subprocess.run(
        [codex, "sandbox", "-P", "pazmo", "-C", str(work), node, str(work / "probe.mjs")],
        env={"PATH": str(Path(node).parent)+":/usr/bin:/bin", "HOME": str(root / "fake-home"),
             "CODEX_HOME": str(config), "TMPDIR": str(work), "LANG": "en_US.UTF-8"},
        capture_output=True, text=True, timeout=25,
    )
finally:
    tcp.close()
    unix.close()
try:
    checks = json.loads(result.stdout.strip())
except ValueError:
    checks = []
report = {
    "version": 1, "platform": sys.platform, "root": str(root),
    "exitCode": result.returncode, "checks": checks,
    "controllerSignalsReceived": len(signals), "stderr": result.stderr,
    "execution": "locked", "completeProof": False,
    "unverified": ["browser/Apple Events", "Codex built-in tools and authenticated model traffic",
                   "full runner/tool allowlist"],
}
(root / "report.json").write_text(json.dumps(report, indent=2)+"\n")
print(json.dumps(report, indent=2))
sys.exit(1 if result.returncode or not checks or signals or any(c["actual"] != c["expect"] for c in checks) else 0)
