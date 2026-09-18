import { useMemo } from "react";
import type * as api from "../api";
import { normalizeLanguage, pickLang } from "../i18n";
import type { CompanySettings, Department } from "../types";
import type { RuntimeOs, View } from "./types";

interface UseAppLabelsParams {
  view: View;
  settings: CompanySettings;
  departments: Department[];
  theme: "light" | "dark";
  runtimeOs: RuntimeOs;
  forceUpdateBanner: boolean;
  updateStatus: api.UpdateStatus | null;
  dismissedUpdateVersion: string;
}

export function useAppLabels({
  view,
  settings,
  departments,
  theme,
  runtimeOs,
  forceUpdateBanner,
  updateStatus,
  dismissedUpdateVersion,
}: UseAppLabelsParams) {
  const uiLanguage = normalizeLanguage(settings.language);
  const loadingTitle = pickLang(uiLanguage, {
    ko: "Claw-Empire 로딩 중...",
    en: "Loading Claw-Empire...",
    ja: "Claw-Empireを読み込み中...",
    zh: "Claw-Empire 加载中...",
  });
  const loadingSubtitle = pickLang(uiLanguage, {
    ko: "AI 에이전트 제국을 준비하고 있습니다",
    en: "Preparing your AI agent empire",
    ja: "AIエージェント帝国を準備しています",
    zh: "正在准备你的 AI 代理帝国",
  });
  const viewTitle = (() => {
    switch (view) {
      case "office":
        return `🏢 ${pickLang(uiLanguage, {
          ko: "오피스",
          en: "Office",
          ja: "オフィス",
          zh: "办公室",
        })}`;
      case "dashboard":
        return `📊 ${pickLang(uiLanguage, {
          ko: "대시보드",
          en: "Dashboard",
          ja: "ダッシュボード",
          zh: "仪表盘",
        })}`;
      case "tasks":
        return `📋 ${pickLang(uiLanguage, {
          ko: "업무 관리",
          en: "Tasks",
          ja: "タスク管理",
          zh: "任务管理",
        })}`;
      case "agents":
        return `${pickLang(uiLanguage, {
          ko: "직원관리",
          en: "Agents",
          ja: "社員管理",
          zh: "员工管理",
        })}`;
      case "skills":
        return `📚 ${pickLang(uiLanguage, {
          ko: "문서고",
          en: "Skills",
          ja: "スキル資料室",
          zh: "技能库",
        })}`;
      case "settings":
        return `⚙️ ${pickLang(uiLanguage, {
          ko: "설정",
          en: "Settings",
          ja: "設定",
          zh: "设置",
        })}`;
      default:
        return "";
    }
  })();
  const announcementLabel = `📢 ${pickLang(uiLanguage, {
    ko: "전사 공지",
    en: "Announcement",
    ja: "全社告知",
    zh: "全员公告",
  })}`;
  const roomManagerLabel = `🏢 ${pickLang(uiLanguage, {
    ko: "사무실 관리",
    en: "Office Manager",
    ja: "オフィス管理",
    zh: "办公室管理",
  })}`;
  const roomManagerDepartments = useMemo(
    () => [
      {
        id: "ceoOffice",
        name: pickLang(uiLanguage, {
          ko: "CEO 오피스",
          en: "CEO Office",
          ja: "CEOオフィス",
          zh: "CEO办公室",
        }),
      },
      ...departments,
      {
        id: "breakRoom",
        name: pickLang(uiLanguage, {
          ko: "휴게실",
          en: "Break Room",
          ja: "休憩室",
          zh: "休息室",
        }),
      },
    ],
    [departments, uiLanguage],
  );
  const reportLabel = `📋 ${pickLang(uiLanguage, {
    ko: "보고서",
    en: "Reports",
    ja: "レポート",
    zh: "报告",
  })}`;
  const tasksPrimaryLabel = pickLang(uiLanguage, {
    ko: "업무",
    en: "Tasks",
    ja: "タスク",
    zh: "任务",
  });
  const agentStatusLabel = pickLang(uiLanguage, {
    ko: "에이전트",
    en: "Agents",
    ja: "エージェント",
    zh: "代理",
  });
  const decisionLabel = pickLang(uiLanguage, {
    ko: "의사결정",
    en: "Decisions",
    ja: "意思決定",
    zh: "决策",
  });
  const effectiveUpdateStatus = forceUpdateBanner
    ? {
        current_version: updateStatus?.current_version ?? "1.1.0",
        latest_version: updateStatus?.latest_version ?? "1.1.1-test",
        update_available: true,
        release_url: updateStatus?.release_url ?? "https://github.com/GreenSheep01201/claw-empire/releases/latest",
        checked_at: Date.now(),
        enabled: true,
        repo: updateStatus?.repo ?? "GreenSheep01201/claw-empire",
        error: null,
      }
    : updateStatus;
  const updateBannerVisible = Boolean(
    effectiveUpdateStatus?.enabled &&
    effectiveUpdateStatus.update_available &&
    effectiveUpdateStatus.latest_version &&
    (forceUpdateBanner || effectiveUpdateStatus.latest_version !== dismissedUpdateVersion),
  );
  const updateReleaseUrl =
    effectiveUpdateStatus?.release_url ??
    `https://github.com/${effectiveUpdateStatus?.repo ?? "GreenSheep01201/claw-empire"}/releases/latest`;
  const updateTitle = updateBannerVisible
    ? pickLang(uiLanguage, {
        ko: `새 버전 v${effectiveUpdateStatus?.latest_version} 사용 가능 (현재 v${effectiveUpdateStatus?.current_version}).`,
        en: `New version v${effectiveUpdateStatus?.latest_version} is available (current v${effectiveUpdateStatus?.current_version}).`,
        ja: `新しいバージョン v${effectiveUpdateStatus?.latest_version} が利用可能です（現在 v${effectiveUpdateStatus?.current_version}）。`,
        zh: `发现新版本 v${effectiveUpdateStatus?.latest_version}（当前 v${effectiveUpdateStatus?.current_version}）。`,
      })
    : "";
  const updateHint =
    runtimeOs === "windows"
      ? pickLang(uiLanguage, {
          ko: "Windows PowerShell에서 `git pull; pnpm install` 실행 후 서버를 재시작하세요.",
          en: "In Windows PowerShell, run `git pull; pnpm install`, then restart the server.",
          ja: "Windows PowerShell で `git pull; pnpm install` を実行し、サーバーを再起動してください。",
          zh: "在 Windows PowerShell 中执行 `git pull; pnpm install`，然后重启服务。",
        })
      : pickLang(uiLanguage, {
          ko: "macOS/Linux에서 `git pull && pnpm install` 실행 후 서버를 재시작하세요.",
          en: "On macOS/Linux, run `git pull && pnpm install`, then restart the server.",
          ja: "macOS/Linux で `git pull && pnpm install` を実行し、サーバーを再起動してください。",
          zh: "在 macOS/Linux 上执行 `git pull && pnpm install`，然后重启服务。",
        });
  const updateReleaseLabel = pickLang(uiLanguage, {
    ko: "릴리즈 노트",
    en: "Release Notes",
    ja: "リリースノート",
    zh: "发布说明",
  });
  const updateDismissLabel = pickLang(uiLanguage, {
    ko: "나중에",
    en: "Dismiss",
    ja: "後で",
    zh: "稍后",
  });
  const autoUpdateNoticeVisible = Boolean(settings.autoUpdateNoticePending);
  const autoUpdateNoticeTitle = pickLang(uiLanguage, {
    ko: "업데이트 안내: 자동 업데이트 토글이 추가되었습니다.",
    en: "Update notice: Auto Update toggle has been added.",
    ja: "更新のお知らせ: Auto Update トグルが追加されました。",
    zh: "更新提示：已新增 Auto Update 开关。",
  });
  const autoUpdateNoticeHint = pickLang(uiLanguage, {
    ko: "기존 설치(1.1.3 이하)에서는 기본값이 OFF입니다. Settings > General에서 필요 시 ON으로 전환할 수 있습니다.",
    en: "For existing installs (v1.1.3 and below), the default remains OFF. You can enable it in Settings > General when needed.",
    ja: "既存インストール（v1.1.3 以下）では既定値は OFF のままです。必要に応じて Settings > General で ON にできます。",
    zh: "对于现有安装（v1.1.3 及以下），默认仍为 OFF。可在 Settings > General 中按需开启。",
  });
  const autoUpdateNoticeActionLabel = pickLang(uiLanguage, {
    ko: "확인",
    en: "Got it",
    ja: "確認",
    zh: "知道了",
  });
  const autoUpdateNoticeContainerClass =
    theme === "light"
      ? "border-b border-sky-200 bg-sky-50 px-3 py-2.5 sm:px-4 lg:px-6"
      : "border-b border-sky-500/30 bg-sky-500/10 px-3 py-2.5 sm:px-4 lg:px-6";
  const autoUpdateNoticeTextClass = theme === "light" ? "min-w-0 text-xs text-sky-900" : "min-w-0 text-xs text-sky-100";
  const autoUpdateNoticeHintClass =
    theme === "light" ? "mt-0.5 text-[11px] text-sky-800" : "mt-0.5 text-[11px] text-sky-200/90";
  const autoUpdateNoticeButtonClass =
    theme === "light"
      ? "rounded-md border border-sky-300 bg-white px-2.5 py-1 text-[11px] text-sky-900 transition hover:bg-sky-100"
      : "rounded-md border border-sky-300/40 bg-sky-200/10 px-2.5 py-1 text-[11px] text-sky-100 transition hover:bg-sky-200/20";
  const updateTestModeHint = forceUpdateBanner
    ? pickLang(uiLanguage, {
        ko: "테스트 표시 모드입니다. `?force_update_banner=1`을 제거하면 원래 상태로 돌아갑니다.",
        en: "Test display mode is on. Remove `?force_update_banner=1` to return to normal behavior.",
        ja: "テスト表示モードです。`?force_update_banner=1` を外すと通常動作に戻ります。",
        zh: "当前为测试显示模式。移除 `?force_update_banner=1` 即可恢复正常行为。",
      })
    : "";

  return {
    uiLanguage,
    loadingTitle,
    loadingSubtitle,
    viewTitle,
    announcementLabel,
    roomManagerLabel,
    roomManagerDepartments,
    reportLabel,
    tasksPrimaryLabel,
    agentStatusLabel,
    decisionLabel,
    effectiveUpdateStatus,
    updateBannerVisible,
    updateReleaseUrl,
    updateTitle,
    updateHint,
    updateReleaseLabel,
    updateDismissLabel,
    autoUpdateNoticeVisible,
    autoUpdateNoticeTitle,
    autoUpdateNoticeHint,
    autoUpdateNoticeActionLabel,
    autoUpdateNoticeContainerClass,
    autoUpdateNoticeTextClass,
    autoUpdateNoticeHintClass,
    autoUpdateNoticeButtonClass,
    updateTestModeHint,
  };
}
