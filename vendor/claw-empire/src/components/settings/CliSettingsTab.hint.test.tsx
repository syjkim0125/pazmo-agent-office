import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CliSettingsTab from "./CliSettingsTab";

const t = (m: Record<string, string>) => m.ko;

describe("CliSettingsTab install and login guidance", () => {
  it("shows what to install or log into for runners that are not ready", () => {
    render(
      <CliSettingsTab
        t={t as never}
        cliStatus={
          {
            codex: { installed: true, version: "0.160.0", authenticated: true, authHint: "준비됨" },
            claude: { installed: true, version: "2.1.280", authenticated: false, authHint: "터미널에서 claude auth login을 실행하세요." },
          } as never
        }
        cliModels={{}}
        cliModelsLoading={false}
        form={{ providerModelConfig: {} } as never}
        setForm={() => {}}
        persistSettings={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText("터미널에서 claude auth login을 실행하세요.")).toBeTruthy();
    expect(screen.queryByText("준비됨")).toBeNull();
  });
});
