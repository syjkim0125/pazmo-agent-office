import { post, request } from "./core";

export type HubStatus = {
  linked: boolean;
  legacy: boolean;
  hub: string | null;
  member: string | null;
  repoName: string | null;
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
};
export const getHubStatus = () => request<HubStatus>("/api/hub/status");
export const getHubRepos = () => request<{ repos: HubRepo[] }>("/api/hub/repos");
export const getHubOutgoing = () => request<{ linked: boolean; items: HubOutgoingItem[] }>("/api/hub/outgoing");
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
  post<{ linked: true; member: string; repoName: string; hub: string; created: boolean }>("/api/hub/link", {
    connection,
  });
export const unlinkHub = () => post<{ linked: false }>("/api/hub/unlink", {});
