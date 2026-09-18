# v3 문서 묶음 검증 기록

검증일: 2026-09-17. **문서·원본 서식·Git 가져오기 기법의 검증이며 제품 구현 완료 보고가 아니다.**

## 실제 확인한 항목

- 원본 Story/Task와 kit MIT license의 Git blob SHA를 계산해 원격에서 읽은 값과 일치함을 확인했다. 서식 내용은 변경하지 않았다.
- 모든 문서의 UTF-8·코드 fence와 JSON 구문을 검사했다.
- README 영문/한국어와 license 안내의 로컬 문서 링크 22개를 대상 repo 배치 모형에서 확인했다. 기존 root LICENSE는 해당 모형의 링크 목적지로만 사용했고 실제 대상 파일을 수정하지 않았다.
- remote target의 contents를 마지막에 다시 읽었으며 기존 LICENSE만 확인했다. 두 번의 write는 403이었고 remote import/README 반영을 완료하지 못했다.
- lock에는 source import `pending`, 실제 build/tests/Codex/npm 시험 `not_run`을 유지했다.
- SHA256SUMS는 묶음 파일의 sha256 목록이며 자기 자신은 제외한다. ZIP CRC 검사와 별도 HANDOFF 파일의 동일성도 최종 패키징에서 확인한다.

## 오프라인 Git 시험 — 9/9

원격 Claw-Empire가 아닌 임시 합성 Git repository에서 실제 Git 명령을 실행했다. source에는 일반 텍스트·바이너리·실행 파일·symlink·외부 gitlink를 넣었다. source tag를 로컬 file transport로 fetch한 뒤 문서의 read-tree 방식으로 prefix import했다.

| # | 검증 | 결과 |
|---|---|---|
| 1 | Fetched synthetic tag resolves to exact commit and tree | PASS |
| 2 | Wrong expected commit rejected with unchanged destination | PASS |
| 3 | Imported vendor subtree equals exact source tree | PASS |
| 4 | Destination MIT file and blob remain unchanged | PASS |
| 5 | Binary bytes, executable mode and symlink preserved | PASS |
| 6 | External submodule retained as gitlink without source initialization | PASS |
| 7 | Root submodule mapping and import commit preserve upstream tree | PASS |
| 8 | Existing vendor precondition blocks accidental repeated import | PASS |
| 9 | Dirty user work precondition blocks import without deleting work | PASS |

## 하지 못한 것

Claw-Empire 전체 source 다운로드·실제 대상 push, 실제 upstream build/test, GitHub 화면에서 README 렌더링 확인, live Codex 로그인·역할 협업·sandbox canary, npm pack/게시·설치 시험은 하지 않았다. 브라우저의 remote screenshot 로딩과 badge 서버 가용성도 보장하지 않는다. 공개된 소스/공식 문서 확인과 위 fixture 시험을 그러한 실행의 대체 증거로 쓰지 않는다.

다음 구현자는 HANDOFF-v3의 T01–T18을 실제 제품에 수행해야 한다. 이 문서에서 PASS인 것은 위 시험뿐이다.
