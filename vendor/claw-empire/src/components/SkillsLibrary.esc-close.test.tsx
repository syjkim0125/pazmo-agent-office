import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SkillsLibrary from "./SkillsLibrary";
import type { Agent } from "../types";
import { getAvailableLearnedSkills, getCustomSkills, startSkillLearning, unlearnSkill } from "../api";

vi.mock("../api", () => ({
  getSkills: vi.fn().mockResolvedValue([
    {
      rank: 1,
      name: "superpowers:using-superpowers",
      repo: "superpowers/using-superpowers",
      installs: 1000,
      skillId: "superpowers:using-superpowers",
    },
  ]),
  getAvailableLearnedSkills: vi.fn().mockResolvedValue([]),
  getCustomSkills: vi.fn().mockResolvedValue([]),
  uploadCustomSkill: vi.fn(),
  deleteCustomSkill: vi.fn(),
  getSkillDetail: vi.fn(),
  getSkillLearningJob: vi.fn(),
  startSkillLearning: vi.fn(),
  unlearnSkill: vi.fn(),
}));

const startSkillLearningMock = vi.mocked(startSkillLearning);
const getAvailableLearnedSkillsMock = vi.mocked(getAvailableLearnedSkills);
const getCustomSkillsMock = vi.mocked(getCustomSkills);
const unlearnSkillMock = vi.mocked(unlearnSkill);
const LANGUAGE_STORAGE_KEY = "climpire.language";
type TestLocale = "ko" | "en" | "ja" | "zh";

const UI_TEXT: Record<
  TestLocale,
  {
    learn: string;
    modalHeading: string;
    startLearning: string;
    running: string;
  }
> = {
  ko: {
    learn: "학습",
    modalHeading: "스킬 학습 스쿼드",
    startLearning: "학습 시작",
    running: "학습중",
  },
  en: {
    learn: "Learn",
    modalHeading: "Skill Learning Squad",
    startLearning: "Start Learning",
    running: "Running",
  },
  ja: {
    learn: "学習",
    modalHeading: "スキル学習スクワッド",
    startLearning: "学習開始",
    running: "実行中",
  },
  zh: {
    learn: "学习",
    modalHeading: "技能学习小队",
    startLearning: "开始学习",
    running: "进行中",
  },
};

function exactText(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`);
}

function createStorageMock(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

const originalLocalStorage = window.localStorage;

const TEST_AGENT: Agent = {
  id: "a1",
  name: "Atlas",
  name_ko: "아틀라스",
  department_id: "dep-1",
  role: "team_leader",
  cli_provider: "claude",
  avatar_emoji: "🤖",
  personality: null,
  status: "idle",
  current_task_id: null,
  stats_tasks_done: 0,
  stats_xp: 0,
  created_at: Date.now(),
};

describe("SkillsLibrary learning modal ESC close", () => {
  let currentLocale: TestLocale = "en";

  beforeEach(() => {
    getCustomSkillsMock.mockResolvedValue([]);
    Object.defineProperty(window, "localStorage", {
      value: createStorageMock({ [LANGUAGE_STORAGE_KEY]: currentLocale }),
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  for (const locale of ["ko", "en", "ja", "zh"] as const) {
    it(`closes the learning modal when Escape is pressed (${locale})`, async () => {
      currentLocale = locale;
      Object.defineProperty(window, "localStorage", {
        value: createStorageMock({ [LANGUAGE_STORAGE_KEY]: currentLocale }),
        configurable: true,
      });
      const text = UI_TEXT[locale];
      render(<SkillsLibrary agents={[TEST_AGENT]} />);

      await screen.findByRole("button", { name: exactText(text.learn) });

      fireEvent.click(screen.getByRole("button", { name: exactText(text.learn) }));

      expect(screen.getByRole("heading", { name: exactText(text.modalHeading) })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: exactText(text.modalHeading) })).not.toBeInTheDocument();
      });
    });
  }

  for (const locale of ["ko", "en", "ja", "zh"] as const) {
    it(`keeps the learning modal open on Escape while learning is running (${locale})`, async () => {
      currentLocale = locale;
      Object.defineProperty(window, "localStorage", {
        value: createStorageMock({ [LANGUAGE_STORAGE_KEY]: currentLocale }),
        configurable: true,
      });
      const text = UI_TEXT[locale];

      startSkillLearningMock.mockResolvedValueOnce({
        id: "job-1",
        repo: "superpowers/using-superpowers",
        skillId: "superpowers:using-superpowers",
        providers: ["claude"],
        agents: ["a1"],
        status: "running",
        command: "npx skills add superpowers/using-superpowers",
        createdAt: Date.now(),
        startedAt: Date.now(),
        completedAt: null,
        updatedAt: Date.now(),
        exitCode: null,
        logTail: [],
        error: null,
      });

      render(<SkillsLibrary agents={[TEST_AGENT]} />);

      await screen.findByRole("button", { name: exactText(text.learn) });

      fireEvent.click(screen.getByRole("button", { name: exactText(text.learn) }));
      fireEvent.click(screen.getByRole("button", { name: exactText(text.startLearning) }));

      await screen.findByRole("button", { name: exactText(text.running) });

      fireEvent.keyDown(window, { key: "Escape" });

      expect(screen.getByRole("heading", { name: exactText(text.modalHeading) })).toBeInTheDocument();
    });
  }

  it("shows learned state and unlearn action in the modal when already learned", async () => {
    currentLocale = "ko";
    Object.defineProperty(window, "localStorage", {
      value: createStorageMock({ [LANGUAGE_STORAGE_KEY]: currentLocale }),
      configurable: true,
    });
    getAvailableLearnedSkillsMock
      .mockResolvedValueOnce([
        {
          provider: "claude",
          repo: "superpowers/using-superpowers",
          skill_id: "superpowers:using-superpowers",
          skill_label: "superpowers:using-superpowers",
          learned_at: Date.now(),
        },
      ])
      .mockResolvedValue([]);
    unlearnSkillMock.mockResolvedValueOnce({
      ok: true,
      provider: "claude",
      repo: "superpowers/using-superpowers",
      skill_id: "superpowers:using-superpowers",
      removed: 1,
    });

    render(<SkillsLibrary agents={[TEST_AGENT]} />);
    await screen.findByRole("button", { name: exactText(UI_TEXT.ko.learn) });
    fireEvent.click(screen.getByRole("button", { name: exactText(UI_TEXT.ko.learn) }));

    await screen.findByText(/^학습됨$/);
    expect(screen.getByText(/^0명 선택됨$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "학습 취소" }));

    await waitFor(() => {
      expect(unlearnSkillMock).toHaveBeenCalledWith({
        provider: "claude",
        repo: "superpowers/using-superpowers",
        skillId: "superpowers:using-superpowers",
      });
    });
  });
});
