# VM의 Codex sandbox 시작 권한

Status: Awaiting approval
Understanding gate (G3): pending
Related: native-runner-isolation-decision.md; Story M3/M4, V3/V4

## 확인된 문제

Colima VM에서 Docker를 거치지 않고 실행한 Codex 0.154.0 sandbox도 시작 단계에서 멈췄다. VM kernel audit에 `unprivileged_userns`가 `setpcap`과 `net_admin`을 거부한 기록이 있으며, bwrap은 `loopback: Failed RTM_NEWADDR: Operation not permitted`를 반환했다. 아직 작업 payload와 모델은 실행되지 않았다.

## 승인할 구체적인 변경

전용 `pazmo-office` VM 안에만 공식 Linux Codex 0.154.0을 `/opt/pazmo/codex-0.154.0`으로 복사하고 root 소유·일반 사용자 쓰기 금지로 둔다. 호스트에 다운로드한 tarball은 npm registry SHA-512와 대조했다. VM의 `/etc/apparmor.d/pazmo-codex-bwrap`에 아래 profile을 설치하고 로드한다.

```text
abi <abi/4.0>,
include <tunables/global>
profile pazmo-codex-bwrap /opt/pazmo/codex-0.154.0/codex-resources/bwrap flags=(unconfined) {
  userns,
}
```

이 profile은 위 고정 bwrap 실행 파일이 비특권 user namespace를 만들 수 있게 한다. `flags=(unconfined)`는 이 프로그램을 추가 AppArmor 접근 제한으로 감싸지 않는다는 뜻이며, bwrap이 설치할 파일·네트워크·프로세스 sandbox는 별도로 검증해야 한다. VM kernel의 공격 표면이 늘어나므로, 단순한 문서 수정이나 기존 VM 설치와 같은 승인으로 취급하지 않는다. macOS 설정과 VM 전역 `apparmor_restrict_unprivileged_userns=1`은 유지한다. 호스트 공유 폴더는 계속 없고 실제 인증 파일은 시험에 쓰지 않는다.

근거: [Ubuntu의 프로그램별 user namespace 허용 설명](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces), 공식 Codex `rust-v0.154.0`의 `linux-sandbox/src/bundled_bwrap.rs`와 실제 VM audit 기록.

## 통과 기준과 복구

허용된 작업 파일 쓰기를 먼저 확인하고, 가짜 auth/controller 파일·중첩 Codex·호스트/VM 소켓·프로세스·네트워크 접근을 실제로 차단하는지 검사한다. 하나라도 불충분하면 live 모델을 실행하지 않는다. 실패 시 profile을 `apparmor_parser -R`로 해제하고 이번에 만든 profile 파일과 고정 바이너리 디렉터리만 제거한 뒤 VM을 중지한다. 사용자 데이터/다른 profile은 건드리지 않는다.

## 승인 경계

자동 승인 검토가 위 변경을 거절했다. 이유는 기존 VM 시험 승인보다 범위가 큰 AppArmor 예외 및 지속되는 root 소유 바이너리 설치라는 점이다. 실제 명령은 실행되지 않았다. 정확한 profile과 VM 내 영향 범위에 대한 사용자 승인을 기다린다. 승인·candidate 구현은 이 결정과 독립적으로 진행한다.
