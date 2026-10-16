import { post, request } from "./core";

export type HubStatus = {
  linked: boolean;
  legacy: boolean;
  hub: string | null;
  member: string | null;
  repoName: string | null;
  /** Hub-originated tasks not yet done/cancelled; a different-origin relink cancels them. */
  activeHubTasks: number;
};
export type HubRepo = { id: string; name: string; owners: string[] };
export type HubOutgoingItem = {
  requestId: string;
  taskId: string | null;
  repoName: string;
  source: string;
  sentAt: number;
  state: string;
  status: string | null;
  assignee: string | null;
  summary: string | null;
  updatedAt: number;
  url: string;
  declined: boolean;
  declineNote: string | null;
};
export type IncomingItem = {
  requestId: string;
  requester: string;
  originRepoName: string | null;
  source: string | null;
  body: string;
  risk: "normal" | "high";
  createdAt: number;
};
export const getHubStatus = () => request<HubStatus>("/api/hub/status");
export const getHubRepos = () => request<{ repos: HubRepo[] }>("/api/hub/repos");
export const getHubOutgoing = () => request<{ linked: boolean; items: HubOutgoingItem[] }>("/api/hub/outgoing");
export const getHubIncoming = () =>
  request<{ linked: boolean; upgradeRequired: boolean; items: IncomingItem[] }>("/api/hub/incoming");
export const acceptHubIncoming = (requestId: string) =>
  post<{ ok: true; requestId: string }>(`/api/hub/incoming/${encodeURIComponent(requestId)}/accept`, {});
export const declineHubIncoming = (requestId: string, reason: string) =>
  post<{ ok: true; requestId: string }>(`/api/hub/incoming/${encodeURIComponent(requestId)}/decline`, { reason });
export const sendHubRequest = (input: {
  repoId: string;
  body: string;
  risk: "normal" | "high";
  key: string;
  taskId: string | null;
}) => post<{ requestId: string; created: boolean; url: string }>("/api/hub/requests", input);
export const cancelHubRequest = (requestId: string) =>
  post<{ ok: true; requestId: string }>(`/api/hub/outgoing/${encodeURIComponent(requestId)}/cancel`, {});
export const linkHub = (connection: string) =>
  post<{ linked: true; member: string; repoName: string; hub: string; created: boolean; cancelledTasks?: number }>(
    "/api/hub/link",
    {
      connection,
    },
  );
export const unlinkHub = () => post<{ linked: false }>("/api/hub/unlink", {});
