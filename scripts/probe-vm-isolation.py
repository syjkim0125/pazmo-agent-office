"""Disposable, unauthenticated VM/container diagnostic; never enables live execution.

Usage: python3 scripts/probe-vm-isolation.py
Requires the approved, running Colima profile pazmo-office and the pinned image.
No host bind mounts, credential reads, model calls, image builds or automatic pulls.
The report/fixtures remain in /private/tmp; only this run's containers/volume are removed.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import uuid


IMAGE = "node@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df"
DOCKER = ["/opt/homebrew/bin/docker", "--host", f"unix://{Path.home()}/.colima/pazmo-office/docker.sock"]
COLIMA = ["/opt/homebrew/bin/colima", "ssh", "--profile", "pazmo-office", "--"]
ENV = {"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "HOME": str(Path.home()), "LANG": "C.UTF-8"}


def run(args, timeout=30, check=True):
    result = subprocess.run(args, env=ENV, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {args[0:3]}\n{result.stderr}")
    return result


def main():
    if run(DOCKER + ["info", "--format", "{{.Name}}"]).stdout.strip() != "colima-pazmo-office":
        raise RuntimeError("Refusing a daemon other than the dedicated Pazmo VM")
    root = Path(tempfile.mkdtemp(prefix="pazmo-vm-canary-", dir="/private/tmp"))
    name = "pazmo-canary-" + uuid.uuid4().hex
    report = {"scope": "VM/container substrate only", "execution": "locked", "completeProof": False,
              "image": IMAGE, "fixtureRoot": str(root), "checks": [], "errors": []}
    tcp, unix = socket.socket(), socket.socket(socket.AF_UNIX)
    received_signals = []
    old_signal = signal.signal(signal.SIGUSR1, lambda *_: received_signals.append("SIGUSR1"))
    created = []
    volume_created = False
    volume = name + "-candidate"
    try:
        targets = [root / p for p in ["controller/approval.sqlite", "controller/operator-token",
                   "controller/policy.json", "fake-home/auth.json", "other-project/source.txt"]]
        for target in targets:
            target.parent.mkdir(exist_ok=True, mode=0o700)
            target.write_text("DISPOSABLE CANARY\n")
            target.chmod(0o600)
        initial = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in targets}
        tcp.bind(("127.0.0.1", 0))
        tcp.listen()
        socket_path = str(root / "controller/socket")
        unix.bind(socket_path)
        unix.listen()
        for address in [tcp.getsockname(), socket_path]:
            family = socket.AF_UNIX if isinstance(address, str) else socket.AF_INET
            with socket.socket(family) as positive:
                positive.settimeout(2)
                positive.connect(address)
        candidate = root / "candidate"
        candidate.mkdir()
        (candidate / "source.txt").write_text("FROZEN CANDIDATE\n")
        # Ensure denial comes from the mount, not ownership or file mode.
        (candidate / "source.txt").chmod(0o666)
        parameters = {"targets": [str(p) for p in targets], "port": tcp.getsockname()[1],
                      "socket": socket_path, "pid": os.getpid()}
        payload = "const p = " + json.dumps(parameters) + ";\n" + Path(__file__).with_suffix(".mjs").read_text()
        (candidate / "probe.mjs").write_text(payload)
        report["sourceHashes"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                  for p in [Path(__file__), Path(__file__).with_suffix(".mjs")]}
        report["versions"] = json.loads(run(DOCKER + ["version", "--format", "{{json .}}"] ).stdout)
        report["vmMounts"] = run(COLIMA + ["findmnt", "-rn", "-o", "TARGET,SOURCE,FSTYPE"]).stdout
        report["checks"].append({"name": "vm-no-host-filesystem-mounts", "passed":
                                not any(x in report["vmMounts"] for x in ["virtiofs", "9p", "sshfs", "/Users/"])})
        flags = ["--name", name, "--label", "pazmo.probe=" + name, "--pull", "never",
                 "--network", "none", "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
                 "--security-opt", "no-new-privileges:true", "--pids-limit", "64",
                 "--memory", "256m", "--memory-swap", "256m", "--cpus", "1",
                 "--tmpfs", "/work:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000,mode=700",
                 "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000,mode=700",
                 "--env", "HOME=/work", "--workdir", "/work", "--entrypoint", "node"]
        run(DOCKER + ["volume", "create", "--label", "pazmo.probe=" + name, volume])
        volume_created = True
        seed = name + "-seed"
        # The copy receiver is never started. The verifier only sees this volume read-only.
        run(DOCKER + ["create", "--name", seed, "--pull", "never", "--network", "none",
                      "--mount", f"type=volume,src={volume},dst=/candidate", IMAGE, "true"])
        created.append(seed)
        run(DOCKER + ["cp", str(candidate) + "/.", seed + ":/candidate"])
        flags += ["--mount", f"type=volume,src={volume},dst=/candidate,readonly,volume-nocopy"]
        report["createFlags"] = flags
        run(DOCKER + ["create"] + flags + [IMAGE, "/candidate/probe.mjs"])
        created.append(name)
        run(DOCKER + ["start", name])
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            logs = run(DOCKER + ["logs", name]).stdout.strip()
            if logs:
                report["container"] = json.loads(logs)
                break
            state = json.loads(run(DOCKER + ["inspect", name, "--format", "{{json .State}}"] ).stdout)
            if not state["Running"]:
                raise RuntimeError("Probe exited before reporting: " + run(DOCKER + ["logs", name]).stderr)
            time.sleep(0.2)
        else:
            raise RuntimeError("Probe did not report before deadline")
        before = json.loads(run(DOCKER + ["inspect", name]).stdout)[0]
        report["hostConfig"] = before["HostConfig"]
        report["containerMounts"] = before["Mounts"]
        report["processesBeforeCancellation"] = run(DOCKER + ["top", name, "-eo", "pid,args"]).stdout
        report["checks"] += report["container"]["checks"]
        mounts = before["Mounts"]
        report["checks"].append({"name": "only-owned-readonly-candidate-volume", "passed": len(mounts) == 1
                                and mounts[0]["Type"] == "volume" and mounts[0]["Name"] == volume
                                and mounts[0]["Destination"] == "/candidate" and not mounts[0]["RW"]})
        # Kill the container boundary, not merely the docker CLI or a saved host PID.
        run(DOCKER + ["kill", name])
        run(DOCKER + ["wait", name])
        after = json.loads(run(DOCKER + ["inspect", name, "--format", "{{json .State}}"] ).stdout)
        report["stateAfterCancellation"] = after
        report["checks"].append({"name": "container-cancellation", "passed":
                                not after["Running"] and after["Pid"] == 0 and after["ExitCode"] == 137})
        pids = [line.split()[0] for line in report["processesBeforeCancellation"].splitlines()[1:]]
        if not pids or not all(pid.isdigit() for pid in pids):
            raise RuntimeError("Unexpected Docker process list")
        remaining = run(COLIMA + ["ps", "-p", ",".join(pids), "-o", "pid=,args="], check=False)
        report["vmProcessesAfterCancellation"] = remaining.stdout
        report["checks"].append({"name": "parent-and-descendant-absent-in-vm", "passed":
                                remaining.returncode == 1 and not remaining.stdout.strip()})
        report["checks"].append({"name": "host-fixtures-unchanged", "passed": all(
            hashlib.sha256(p.read_bytes()).hexdigest() == initial[str(p)] for p in targets)})
        report["checks"].append({"name": "host-process-not-signalled", "passed": not received_signals})
    except Exception as error:
        report["errors"].append(str(error))
    finally:
        for container in reversed(created):
            try:
                cleanup = run(DOCKER + ["rm", "--force", container], check=False)
                report["checks"].append({"name": "removed:" + container, "passed": cleanup.returncode == 0})
            except Exception as error:
                report["errors"].append("cleanup: " + str(error))
        if volume_created:
            try:
                cleanup = run(DOCKER + ["volume", "rm", volume], check=False)
                report["checks"].append({"name": "owned-volume-removed", "passed": cleanup.returncode == 0})
            except Exception as error:
                report["errors"].append("volume cleanup: " + str(error))
        tcp.close()
        unix.close()
        signal.signal(signal.SIGUSR1, old_signal)
    report["probeExitCode"] = int(bool(report["errors"]) or not report["checks"] or
                                  not all(item["passed"] for item in report["checks"]))
    report["notProven"] = ["authenticated Codex tool boundary", "credential isolation inside model harness",
                            "downloaded/copied model executables", "controller candidate/approval guards",
                            "browser sessions and Apple Events with a live runner", "kernel/VM escape resistance"]
    (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(root / "report.json"), "exitCode": report["probeExitCode"],
                      "checks": len(report["checks"]), "execution": "locked"}))
    return report["probeExitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
