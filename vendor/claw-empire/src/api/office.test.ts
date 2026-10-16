import { afterEach, describe, expect, it, vi } from "vitest";
import { getOfficeRoles } from "./office";
import * as api from "../api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("getOfficeRoles", () => {
  it("is part of the api aggregate", () => {
    expect(api.getOfficeRoles).toBe(getOfficeRoles);
  });

  it("returns the roles object of a well-formed response", async () => {
    const roles = { pm: "a", lead: "b", engineer: null, reviewer: "d" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ roles })) as unknown as typeof fetch);
    await expect(getOfficeRoles()).resolves.toEqual(roles);
  });

  it("rejects a 200 response without roles instead of resolving undefined", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})) as unknown as typeof fetch);
    await expect(getOfficeRoles()).rejects.toThrow();
  });

  it("treats missing or non-string role ids as null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ roles: { pm: "a", lead: 5 } })) as unknown as typeof fetch,
    );
    await expect(getOfficeRoles()).resolves.toEqual({ pm: "a", lead: null, engineer: null, reviewer: null });
  });
});
