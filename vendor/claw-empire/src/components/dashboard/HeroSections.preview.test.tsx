import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardHeroHeader } from "./HeroSections";

describe("Pazmo locked preview", () => {
  it("does not claim agents are executing or enable task creation", () => {
    render(
      <DashboardHeroHeader
        companyName="Office"
        time="12:00"
        date="Today"
        briefing="Preview"
        reviewQueue={0}
        numberFormatter={new Intl.NumberFormat("en")}
        primaryCtaEyebrow="Quick start"
        primaryCtaDescription="Create a task"
        primaryCtaLabel="Start mission"
        onPrimaryCtaClick={() => {
          throw new Error("Must not execute");
        }}
        readOnly={true}
        t={(messages) => messages.en}
      />,
    );
    expect(screen.getByText("PREVIEW")).toBeInTheDocument();
    expect(screen.queryByText("Agents are executing missions in real time")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
