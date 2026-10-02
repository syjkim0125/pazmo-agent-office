# 전용 VM 격리 검증 — 2026-09-18

범위: 승인된 [VM G3](../understanding/native-runner-isolation-decision.md)의 설치·기초 격리 검증. U4 전체, 인증된 runner, U3–U8 또는 G4 완료를 의미하지 않는다. 제품 실행 상태는 `locked`다. Jira/실제 로그인/모델 호출/사용자 인증파일 복사/기존 DB migration/게시를 수행하지 않았다.

## 설치와 실제 환경

- Homebrew: Colima **0.10.3**, Lima **2.2.0**, Docker CLI **29.7.2**. VM 서버 Docker **29.5.2**, Linux **6.8.0-117-generic**, ARM64.
- `pazmo-office` profile: VZ, CPU 2, RAM 4 GiB, 데이터 디스크 20 GiB + root 디스크 20 GiB. 디스크의 실제 파일 사용량과 두 가상 디스크의 합은 다르다.
- `--mount none`, `--activate=false`, `--ssh-config=false`, `--ssh-agent=false`, `--port-forwarder none`, Kubernetes 비활성. 실제 `findmnt`에 virtiofs/9p/sshfs나 `/Users/` mount 없음.
- 실제 저장 위치는 `~/.colima/pazmo-office`와 `~/.colima/_lima/colima-pazmo-office`다. 최초 호출에서 지정한 `COLIMA_HOME` 경로는 적용되지 않았다. 로그/생성 파일로 실제 경로를 확인했고 이후 socket을 명시했다.
- 기존 `~/.ssh/config` SHA-256 동일. 없던 `~/.docker/config.json`은 그대로 없음. Colima 전용 Docker context는 추가됐지만 기본 선택은 `default`다. Homebrew service 자동 시작을 등록하지 않았다.
- VM 자체는 이미지 다운로드용 네트워크와 호스트 제어용 SSH/socket 전달이 있다. `portForwarder: none`만으로 VM 네트워크가 격리됐다고 주장하지 않는다. 실제 작업 컨테이너는 `network=none`이며 관리 socket을 받지 않는다.

공식 Node `24.19.0-bookworm-slim`을 내려받고 이후 검사는 digest로 고정했다:
`node@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`.

## 실제 canary 결과

[`vm-canary.json`](vm-canary.json): 최종 소스 hash, 명령 flag, Docker/VM 정보, 개별 **46개 검사 통과, exit 0**, `completeProof:false`, `execution:locked`를 보존했다.

| 확인한 경계                                | 관찰                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 작업/임시 파일 쓰기와 후보 읽기            | 성공하는 대조군 확인                                                                                       |
| 후보 쓰기                                  | file mode 0666에서도 `EROFS`; 별도 복사한 VM volume을 읽기 전용으로 장착                                   |
| 가짜 승인 DB·token·정책·auth·다른 프로젝트 | 호스트에서는 존재하지만 컨테이너에서는 마운트되지 않아 읽기/쓰기 불가                                      |
| symlink와 중첩 Node                        | 호스트 가짜 파일 접근 불가                                                                                 |
| 호스트 TCP/Unix, Docker socket, 외부 경로  | 연결 불가; 호스트 TCP/Unix 양성 대조군은 연결 성공                                                         |
| 프로세스/권한                              | UID 1000, capabilities 0, no-new-privileges, seccomp 필터; 호스트 probe 신호 전달 안 됨                    |
| 자원 설정                                  | cgroup PID 64, memory 256 MiB, CPU 1 확인; 부하 한계 시험은 아님                                           |
| 취소/정리                                  | 실제 Node 자식 생성 후 container kill; exit 137/PID 0, VM `ps`에서 부모·자식 없음; 소유 컨테이너/볼륨 제거 |
| 이미지에 없는 명령                         | codex/docker/osascript/open 실행은 ENOENT; 복사·다운로드한 모델 바이너리를 금지한다는 증거는 아님          |

**음성 대조군:** 최종 canary에서 종료 후 VM `ps` 확인을 추가하기 직전 소스를 임시 폴더에 복사하고, 후보 volume의 `readonly`만 제거했다. 후보 쓰기 성공·후보 변경·잘못된 mount 설정 3건을 감지해 **exit 1**. [`vm-canary-negative-control.json`](vm-canary-negative-control.json)에 45개 당시 검사와 실패 3건을 기록했다. 공유 작업 트리는 변조하지 않았다.

최초 시도는 읽기 전용 rootfs에 `docker cp`하는 단계에서 실패하여 접근 검사가 시작되지 않았다. 중지 상태의 임시 준비 컨테이너로 후보를 전용 volume에 복사하고, 실제 검증 컨테이너에는 해당 volume을 read-only로 붙여 수정했다. 준비 컨테이너는 실행하지 않는다.

## Codex 호환성에서 남은 문제

공식 `@openai/codex@0.154.0-linux-arm64` tarball을 registry SHA-512와 대조한 뒤 별도 임시 컨테이너로 복사했다. 실제 auth 대신 `DISPOSABLE CANARY`를 사용했다. `codex --version`은 exit 0, `codex sandbox -P pazmo ...`는 다음 오류로 **exit 1**:

```text
bwrap: No permissions to create a new namespace
```

원본 명령, profile, payload, 재현용 임시 스크립트는 [`linux-codex-sandbox-startup.json`](linux-codex-sandbox-startup.json)에 있다. 이것은 **해당 컨테이너 구성에서의 시작 호환성 실패**다. kernel/user namespace/seccomp 중 어느 계층이 직접 원인인지는 좁히지 않았고, payload의 파일·중첩 Codex 검사는 시작되지 않았다. privilege 확대나 sandbox 우회로 통과 처리하지 않았다.

공식 [exec-server 문서](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/exec-server/README.md)는 프로세스/파일 RPC 경로를 제공한다. 단, 명령 존재만으로 현재 CLI가 인증 영역과 모든 도구를 안전하게 분리할 수 있다는 뜻은 아니다. 다음 U4 작업은 별도 실행 환경 연결 및 파일/프로세스 도구 전 경로 검증이다. 그 경계가 입증된 뒤 VM 전용 공식 로그인을 진행한다.

## 재현과 현재 자원 상태

전용 VM은 시험 후 중지했고 이미지·VM 디스크·진단 로그는 보존했다. 다음 명령은 기존 승인된 profile만 시작한다. 재현 시 설정과 실제 mount를 다시 확인한다.

```sh
colima start pazmo-office --mount none --activate=false --ssh-config=false --ssh-agent=false --port-forwarder none
python3 scripts/probe-vm-isolation.py
colima stop pazmo-office
```

스크립트는 현재 macOS/Homebrew 설치 경로 전용이며 다른 환경의 제품 runner가 아니다. 이미지를 자동 pull하지 않는다. 실제 재현에는 socket/VM 접근 권한이 필요하다. 실패 시 exit 1 또는 설정 오류의 nonzero로 종료하며 제품 잠금을 해제하지 않는다.

## 리뷰와 검증 범위

`ce-work`의 진단 우선 경로로 실제 OS 시험을 수행했다. 제품 동작은 바꾸지 않았으므로 이 단계의 RED/GREEN 대체 증거는 실패한 초기 준비 방식, 읽기 전용을 제거한 음성 대조군, 수정한 구성의 실제 canary다.

`ce-simplify-code`의 reuse/quality/efficiency를 순차 검토했다. native/VM의 서로 다른 경계를 공통 wrapper로 합치지 않았고 적용할 동작 보존 단순화는 없었다. `ce-code-review`의 정확성·시험·보안·실패·유지보수·프로젝트 규칙 관점에서 순차 검토했다. 사용자 AGENTS 매핑에 따른 같은 세션 리뷰이며 독립 리뷰가 아니다. 후보 소유권의 EACCES만으로 읽기 전용 mount를 입증하는 약점을 발견해 mode 0666 + EROFS로 강화했고, 취소 검증도 실제 VM process 목록까지 보강했다.

기초 진단에서 남은 수정 사항은 없지만 전체 Story는 **Not ready**다. 인증자료·모델 도구 경계, snapshot 승인/전이 guard, 실제 3역할 실행, 브라우저/Apple Events의 live runner 접근, kernel/VM escape 내성은 입증하지 않았다. 기존 U2 시험 결과는 [이전 검증 기록](2026-09-18-runtime-baseline.md)의 범위로만 유효하다.

최종 정적 검사: Python AST/JavaScript syntax, canary 보고서와 최종 소스 SHA-256 일치, root TypeScript 검사, 변경 파일 Prettier, `git diff --check` 통과. vendor lint는 exit 0, 기존 경고 40/오류 0이며 새 Python 진단용 linter는 구성되어 있지 않다. ai-workflow-kit 3.1.1 doctor와 Story checker는 모두 **exit 0**; Story가 Delivered가 아니므로 G4는 검사하지 않았다. 이번 단계는 제품 코드/화면을 바꾸지 않아 기존 웹/CLI suite와 UI 검사는 재실행하지 않았다.

Compound는 headless로 같은 세션에서 수행했다. 기존 solution과 중복 없음, [후보 volume 준비 교훈](../solutions/integration-issues/prepare-readonly-container-candidates.md) 1개 작성, frontmatter 검사 exit 0. 기존 AGENTS의 지식 저장소 안내가 충분하여 추가 수정/별도 refresh는 하지 않았다.
