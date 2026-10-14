import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DepartmentFormModal from "./DepartmentFormModal";
import { ApiRequestError } from "../../api";
import { renderWithDialogs } from "../../test/renderWithDialogs";
import { forbidNativeDialogs } from "../../test/forbidNativeDialogs";
import type { Department } from "../../types";

forbidNativeDialogs();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rejection(code: string) {
  return new ApiRequestError(code, { status: 409, code, url: "/api/departments" });
}

const department = {
  id: "dev",
  name: "Dev",
  name_ko: "개발",
  icon: "💻",
  color: "#3b82f6",
  sort_order: 1,
} as Department;

it("shows a department-save conflict in the page instead of a native alert", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onSaveDepartment = vi.fn().mockRejectedValue(rejection("department_id_exists"));
  renderWithDialogs(
    <DepartmentFormModal
      locale="en"
      tr={(_ko, en) => en}
      department={null}
      departments={[]}
      onSave={vi.fn()}
      onClose={vi.fn()}
      onSaveDepartment={onSaveDepartment}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Development"), { target: { value: "Design" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Department" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Department ID already exists.");
  expect(onSaveDepartment).toHaveBeenCalledTimes(1);
});

it("shows why a department cannot be deleted in the page", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onDeleteDepartment = vi.fn().mockRejectedValue(rejection("department_has_agents"));
  const onClose = vi.fn();
  renderWithDialogs(
    <DepartmentFormModal
      locale="en"
      tr={(_ko, en) => en}
      department={department}
      departments={[department]}
      onSave={vi.fn()}
      onClose={onClose}
      onDeleteDepartment={onDeleteDepartment}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Cannot delete: department has agents."));
  expect(onClose).not.toHaveBeenCalled();
});
