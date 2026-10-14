# workflow-review attempt 1 (독립 리뷰어 subagent, 읽기 전용)

판정: With fixes — Critical 0, Important 1, Minor 5. 리뷰어 재실행: cli/lifecycle/launcher 46/46. mktemp에서 CLI 직접 실험.

- Important 1: 런타임 기록(plans/, approved-contracts/, role-runs/, planning/)이 남은 설치에서 `remove --apply`가 .gitignore만 지워 `?? .pazmo-office/manifest.json`(절대 경로 포함)과 기록이 다시 git에 노출됨. → 반영: 남는 항목이 {manifest.json, .gitignore}뿐일 때만 .gitignore를 지우고, 아니면 preserved. 테스트 추가.
- Minor 2: 기존 설치 dry-run이 .gitignore 생성 예정을 보여 주지 않음(S1 일부). → 반영
- Minor 3: 새 설치에서 .gitignore를 마지막에 써서 config.json이 잠깐 숨김 없이 존재. → 반영(mkdir 직후 생성)
- Minor 4: .gitignore 읽기 불가(EACCES) 시 remove가 중간 상태로 끝남. 기존 managed 파일과 같은 패턴, 재실행으로 이어짐. → 범위 밖, 기록
- Minor 5: .gitignore 쓰기 실패(symlink, 읽기 전용 폴더)가 start를 막음. symlink 거부는 M3대로. EACCES는 기록만. → 범위 밖, 기록
- Minor 6: Important 1 시나리오 테스트 부재 → Important 1과 함께 반영
