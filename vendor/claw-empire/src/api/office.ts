import { request } from "./core";

export type OfficeRolesResponse = {
  pm: string | null;
  lead: string | null;
  engineer: string | null;
  reviewer: string | null;
};

const idOrNull = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** Which characters hold the PM/Lead/Engineer/Reviewer roles. Rejects a response that carries no roles object. */
export const getOfficeRoles = (): Promise<OfficeRolesResponse> =>
  request<{ roles?: Partial<Record<keyof OfficeRolesResponse, unknown>> | null }>("/api/office-roles").then(
    (response) => {
      const roles = response?.roles;
      if (!roles || typeof roles !== "object") throw new Error("office-roles response has no roles");
      return {
        pm: idOrNull(roles.pm),
        lead: idOrNull(roles.lead),
        engineer: idOrNull(roles.engineer),
        reviewer: idOrNull(roles.reviewer),
      };
    },
  );
