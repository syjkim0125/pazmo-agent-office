import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CliUsagePanel from "./CliUsagePanel";

const t = (m: Record<string, string>) => m.ko;

describe("CliUsagePanel under Office", () => {
  it("shows neutral text instead of 'not signed in' when Office owns credentials", () => {
    const office = { windows: [], error: "office_managed" };
    render(
      <CliUsagePanel
        t={t as never}
        language="ko"
        refreshing={false}
        onRefreshUsage={() => {}}
        cliStatus={
          {
            codex: { installed: true, version: "0.160.0", authenticated: true },
            claude: { installed: true, version: "2.1.280", authenticated: true },
          } as never
        }
        cliUsage={{ codex: office, claude: office }}
      />,
    );
    expect(screen.getAllByText("Office에서는 사용량을 표시하지 않음")).toHaveLength(2);
    expect(screen.queryByText("로그인되지 않음")).toBeNull();
    expect(screen.queryByText("사용 불가")).toBeNull();
  });
});
