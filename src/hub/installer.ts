import { fail } from "../cli/project.ts";

/** The public Office the installer clones when the operator names no other. */
export const DEFAULT_OFFICE_REPO = "https://github.com/syjkim0125/pazmo-agent-office.git";
export const DEFAULT_OFFICE_REF = "main";

export type InstallerConfig = { officeRepo: string; officeRef: string };

// Every value below goes into the script inside single quotes, so each must be unable to hold a quote, a space,
// a backslash or any shell syntax. These patterns are the only gate; nothing else in the hub vets them.
const REPO = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._-]+)+$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
// The hub's own origin: https, a plain host name, at most a port. (parsePublicUrl alone lets a quote through a host.)
const HUB = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;

/** Checks the Office repository and ref the installer will fetch; no value means the default. */
export function installerConfig(o: { officeRepo?: string; officeRef?: string }): InstallerConfig {
  const officeRepo = o.officeRepo ?? DEFAULT_OFFICE_REPO;
  const officeRef = o.officeRef ?? DEFAULT_OFFICE_REF;
  if (!REPO.test(officeRepo) || officeRepo.includes(".."))
    fail("ARGUMENT", "The Office repository must be an https URL such as https://github.com/<owner>/<repo>.git (PAZMO_OFFICE_REPO).");
  if (!REF.test(officeRef) || officeRef.includes(".."))
    fail("ARGUMENT", "The Office ref must be a branch or tag name of letters, digits and . _ / - (at most 100, no ..) (PAZMO_OFFICE_REF).");
  return { officeRepo, officeRef };
}

// POSIX sh. A person runs it as `curl -fsSL '<hub>/install.sh' | sh`, so the script is the shell's standard input:
// everything is one function called on the last line (a download that stops early defines nothing runnable), and every
// command that could read input gets /dev/null or the terminal instead of the script. It never asks for administrator rights.
const SCRIPT = `#!/bin/sh
# Installs the Pazmo Office on an Apple Silicon Mac and connects it to the team hub.
#   curl -fsSL '@HUB@/install.sh' | sh
# It needs no administrator rights. Everything is inside main, which is called on the last line.
set -eu

main() {
  HUB='@HUB@'
  REPO='@REPO@'
  REF='@REF@'
  RERUN="curl -fsSL '$HUB/install.sh' | sh"
  OFFICE="$HOME/.pazmo/office"
  BREW="\${PAZMO_BREW_PREFIX:-/opt/homebrew}"
  # Dialogs read the terminal, because standard input is this script. With no terminal they read nothing.
  TTY=/dev/tty
  (exec </dev/tty) 2>/dev/null || TTY=/dev/null

  # One named step. When it fails, say which step and how to start over, and stop.
  run_step() {
    STEP="$1"
    shift
    echo "==> $STEP"
    if ! "$@"; then
      echo "" >&2
      echo "[$STEP] 단계에서 멈췄습니다. 위의 메시지를 확인한 뒤 아래 명령으로 다시 실행하세요." >&2
      echo "  $RERUN" >&2
      exit 1
    fi
  }

  # Chained with && on purpose: inside run_step the shell ignores set -e.
  install_office() {
    cd "$OFFICE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  }

  echo "Pazmo Office를 설치하고 이 Mac을 팀 허브에 연결합니다. 몇 분 걸릴 수 있습니다."

  OS="$(uname -s)"
  ARCH="$(uname -m)"
  # A terminal under Rosetta says x86_64 on an Apple Silicon Mac, whose hardware still answers 1 here (an Intel Mac answers
  # 0 or nothing). Homebrew refuses to install into /opt/homebrew from such a shell, so every brew then runs as arm64.
  NATIVE=""
  if [ "$OS" = Darwin ] && [ "$ARCH" = x86_64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then
    ARCH=arm64
    NATIVE="arch -arm64"
  fi
  if [ "$OS" != Darwin ] || [ "$ARCH" != arm64 ]; then
    echo "Apple Silicon Mac에서만 설치할 수 있습니다. (이 컴퓨터: $OS $ARCH)" >&2
    exit 1
  fi

  if [ ! -x "$BREW/bin/brew" ]; then
    echo "Homebrew가 아직 없습니다. 아래 명령을 터미널에 붙여넣어 Homebrew를 먼저 설치하세요." >&2
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' >&2
    echo "설치한 뒤 이 명령을 다시 실행하세요." >&2
    echo "  $RERUN" >&2
    exit 1
  fi

  PATH="$BREW/opt/node@24/bin:$BREW/bin:$PATH"
  export PATH

  MISSING=""
  for f in node@24 git gh colima docker; do
    if ! $NATIVE "$BREW/bin/brew" list --versions "$f" >/dev/null 2>&1 </dev/null; then
      MISSING="$MISSING $f"
    fi
  done
  if [ -n "$MISSING" ]; then
    run_step "필요한 프로그램 설치" $NATIVE "$BREW/bin/brew" install $MISSING </dev/null
  else
    echo "필요한 프로그램이 이미 설치되어 있습니다."
  fi

  if ! command -v claude >/dev/null 2>&1; then
    run_step "Claude Code 설치" $NATIVE "$BREW/bin/brew" install --cask claude-code </dev/null
  fi

  # An existing Office fetches the served repository by URL, not its stored origin, so a moved PAZMO_OFFICE_REPO reaches it.
  if [ -e "$OFFICE/.git" ]; then
    run_step "Office 새 버전 받기" env GIT_TERMINAL_PROMPT=0 git -C "$OFFICE" fetch --depth 1 "$REPO" "$REF" </dev/null
    run_step "Office 새 버전 받기" git -C "$OFFICE" checkout --detach FETCH_HEAD </dev/null
  else
    run_step "Office 내려받기" env GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$REF" "$REPO" "$OFFICE" </dev/null
  fi
  run_step "Office 준비" install_office </dev/null

  if ! gh auth status --hostname github.com >/dev/null 2>&1 </dev/null; then
    run_step "GitHub 로그인" gh auth login --hostname github.com --web --git-protocol https <"$TTY"
  fi

  if ! claude auth status 2>/dev/null </dev/null | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*true'; then
    run_step "Claude 로그인" claude auth login <"$TTY"
  fi

  run_step "내 Mac 연결" "$BREW/opt/node@24/bin/node" "$OFFICE/bin/pazmo-office.mjs" mac connect --hub "$HUB" <"$TTY"
}

main "$@"
`;

/** The installer for one hub. Its three values are checked again here, so the script never carries an unvetted one. */
export function installScript(o: { hub: string; officeRepo: string; officeRef: string }): string {
  const { officeRepo, officeRef } = installerConfig(o);
  if (!HUB.test(o.hub)) fail("ARGUMENT", "The hub origin cannot go into the installer: it must be https://<host>[:<port>] with letters, digits, . and - only.");
  // Function replacers: a value is never read as a replacement pattern.
  return SCRIPT.replaceAll("@HUB@", () => o.hub).replaceAll("@REPO@", () => officeRepo).replaceAll("@REF@", () => officeRef);
}
