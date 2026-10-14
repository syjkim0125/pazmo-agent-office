import { render } from "@testing-library/react";
import type { RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { DialogProvider } from "../components/common/DialogProvider";

/** Components call useDialog(), which throws without a provider; tests mount it through this wrapper. */
export function DialogWrapper({ children }: { children: ReactNode }) {
  return <DialogProvider>{children}</DialogProvider>;
}

export function renderWithDialogs(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: DialogWrapper, ...options });
}
