# Architecture Map

Generated at: 2026-02-18T03:50:20.460Z

## How to Regenerate

```bash
npm run arch:map
```

## System Overview

```mermaid
flowchart LR
  subgraph Frontend
    F1["src/main.tsx"] --> F2["src/App.tsx"]
    F2 --> F3["src/components/*"]
    F2 --> F4["src/api.ts"]
    F2 --> F5["src/hooks/*"]
  end

  subgraph Backend
    B1["server/index.ts"] --> B2["Express REST API"]
    B1 --> B3["WebSocket Server"]
    B1 --> B4["SQLite (claw-empire.sqlite)"]
    B1 --> B5["Git Worktree + CLI Process"]
  end

  F4 <-->|"HTTP /api/*"| B2
  F5 <-->|"ws://"| B3
```

## Project Tree

```text
climpire
├── docs/
│   ├── architecture/
│   │   ├── architecture.json
│   │   ├── backend-dependencies.mmd
│   │   ├── CEO-STRUCTURE-MAP.md
│   │   ├── frontend-imports.mmd
│   │   ├── org-chart.mmd
│   │   ├── README.md
│   │   └── source-tree.txt
│   └── DESIGN.md
├── public/
│   ├── public/sprites/ (61 sprite files)
│   └── climpire.svg
├── scripts/
│   └── generate-architecture-report.mjs
├── server/
│   └── index.ts
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── AgentAvatar.tsx
│   │   ├── AgentDetail.tsx
│   │   ├── AgentSelect.tsx
│   │   ├── ChatPanel.tsx
│   │   ├── Dashboard.tsx
│   │   ├── MessageContent.tsx
│   │   ├── OfficeView.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── Sidebar.tsx
│   │   ├── TaskBoard.tsx
│   │   └── TerminalPanel.tsx
│   ├── game/
│   ├── hooks/
│   │   ├── usePolling.ts
│   │   └── useWebSocket.ts
│   ├── pages/
│   ├── types/
│   │   └── index.ts
│   ├── api.ts
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .env
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── pnpm-lock.yaml
├── tsconfig.app.json
├── tsconfig.app.tsbuildinfo
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.node.tsbuildinfo
└── vite.config.ts
```

## Frontend Import Graph

```mermaid
flowchart LR
  N1["src/App.tsx"]
  N2["src/api.ts"]
  N3["src/components/AgentAvatar.tsx"]
  N4["src/components/AgentDetail.tsx"]
  N5["src/components/AgentSelect.tsx"]
  N6["src/components/ChatPanel.tsx"]
  N7["src/components/Dashboard.tsx"]
  N8["src/components/MessageContent.tsx"]
  N9["src/components/OfficeView.tsx"]
  N10["src/components/SettingsPanel.tsx"]
  N11["src/components/Sidebar.tsx"]
  N12["src/components/TaskBoard.tsx"]
  N13["src/components/TerminalPanel.tsx"]
  N14["src/hooks/usePolling.ts"]
  N15["src/hooks/useWebSocket.ts"]
  N16["src/main.tsx"]
  N17["src/types/index.ts"]
  N1 --> N2
  N1 --> N4
  N1 --> N6
  N1 --> N7
  N1 --> N9
  N1 --> N10
  N1 --> N11
  N1 --> N12
  N1 --> N13
  N1 --> N15
  N1 --> N17
  N2 --> N17
  N3 --> N17
  N4 --> N2
  N4 --> N3
  N4 --> N17
  N5 --> N3
  N5 --> N17
  N6 --> N3
  N6 --> N8
  N6 --> N17
  N7 --> N3
  N7 --> N17
  N9 --> N2
  N9 --> N17
  N10 --> N1
  N10 --> N2
  N10 --> N17
  N11 --> N17
  N12 --> N2
  N12 --> N3
  N12 --> N5
  N12 --> N17
  N13 --> N2
  N13 --> N3
  N13 --> N17
  N15 --> N17
  N16 --> N1
```

## Backend Dependency Graph

```mermaid
flowchart TB
  N1["pkg:cors"]
  N2["pkg:express"]
  N3["pkg:node:child_process"]
  N4["pkg:node:crypto"]
  N5["pkg:node:fs"]
  N6["pkg:node:http"]
  N7["pkg:node:os"]
  N8["pkg:node:sqlite"]
  N9["pkg:node:url"]
  N10["pkg:path"]
  N11["pkg:ws"]
  N12["server/index.ts"]
  N12 --> N1
  N12 --> N2
  N12 --> N3
  N12 --> N4
  N12 --> N5
  N12 --> N6
  N12 --> N7
  N12 --> N8
  N12 --> N9
  N12 --> N10
  N12 --> N11
```

## API Routes (Server)

| Method | Route |
| --- | --- |
| GET | `/{*splat}` |
| GET | `/api/agents` |
| GET | `/api/agents/:id` |
| PATCH | `/api/agents/:id` |
| POST | `/api/agents/:id/spawn` |
| POST | `/api/announcements` |
| GET | `/api/cli-status` |
| GET | `/api/cli-usage` |
| POST | `/api/cli-usage/refresh` |
| GET | `/api/departments` |
| GET | `/api/departments/:id` |
| GET | `/api/health` |
| DELETE | `/api/messages` |
| GET | `/api/messages` |
| POST | `/api/messages` |
| GET | `/api/oauth/callback/antigravity` |
| GET | `/api/oauth/callback/github-copilot` |
| POST | `/api/oauth/disconnect` |
| POST | `/api/oauth/github-copilot/device-poll` |
| POST | `/api/oauth/github-copilot/device-start` |
| GET | `/api/oauth/models` |
| GET | `/api/oauth/start` |
| GET | `/api/oauth/status` |
| GET | `/api/settings` |
| PUT | `/api/settings` |
| GET | `/api/stats` |
| GET | `/api/subtasks` |
| PATCH | `/api/subtasks/:id` |
| GET | `/api/tasks` |
| POST | `/api/tasks` |
| DELETE | `/api/tasks/:id` |
| GET | `/api/tasks/:id` |
| PATCH | `/api/tasks/:id` |
| POST | `/api/tasks/:id/assign` |
| GET | `/api/tasks/:id/diff` |
| POST | `/api/tasks/:id/discard` |
| POST | `/api/tasks/:id/merge` |
| POST | `/api/tasks/:id/resume` |
| POST | `/api/tasks/:id/run` |
| POST | `/api/tasks/:id/stop` |
| POST | `/api/tasks/:id/subtasks` |
| GET | `/api/tasks/:id/terminal` |
| GET | `/api/worktrees` |
| GET | `/api/api-providers` |
| POST | `/api/api-providers` |
| GET | `/api/api-providers/presets` |
| PUT | `/api/api-providers/:id` |
| DELETE | `/api/api-providers/:id` |
| POST | `/api/api-providers/:id/test` |
| GET | `/api/api-providers/:id/models` |
| GET | `/api/cli-models` |
| POST | `/api/oauth/refresh` |
| POST | `/api/oauth/accounts/activate` |
| PUT | `/api/oauth/accounts/:id` |
| GET | `/api/skills` |
| GET | `/api/skills/detail` |
| POST | `/api/skills/learn` |
| GET | `/api/skills/learn/:jobId` |
| GET | `/health` |
| GET | `/healthz` |

## API Calls (Frontend)

| Endpoint Pattern |
| --- |
| `/api/agents` |
| `/api/agents/:param` |
| `/api/announcements` |
| `/api/api-providers` |
| `/api/api-providers/:param` |
| `/api/api-providers/:param/test` |
| `/api/api-providers/:param/models` |
| `/api/api-providers/presets` |
| `/api/cli-models` |
| `/api/cli-status` |
| `/api/cli-usage` |
| `/api/cli-usage/refresh` |
| `/api/departments` |
| `/api/departments/:param` |
| `/api/messages` |
| `/api/oauth/disconnect` |
| `/api/oauth/github-copilot/device-poll` |
| `/api/oauth/github-copilot/device-start` |
| `/api/oauth/models` |
| `/api/oauth/refresh` |
| `/api/oauth/accounts/activate` |
| `/api/oauth/accounts/:param` |
| `/api/oauth/start` |
| `/api/oauth/status` |
| `/api/settings` |
| `/api/skills` |
| `/api/skills/detail` |
| `/api/skills/learn` |
| `/api/skills/learn/:param` |
| `/api/stats` |
| `/api/subtasks` |
| `/api/subtasks/:param` |
| `/api/tasks` |
| `/api/tasks/:param` |
| `/api/tasks/:param/assign` |
| `/api/tasks/:param/diff` |
| `/api/tasks/:param/discard` |
| `/api/tasks/:param/merge` |
| `/api/tasks/:param/resume` |
| `/api/tasks/:param/run` |
| `/api/tasks/:param/stop` |
| `/api/tasks/:param/subtasks` |
| `/api/tasks/:param/terminal` |
| `/api/worktrees` |

## WebSocket Event Matrix

| Event | Server Broadcast | Frontend Listen |
| --- | --- | --- |
| agent_status | yes | yes |
| announcement | yes | yes |
| chat_stream | yes | yes |
| cli_output | yes | yes |
| cli_usage_update | yes |  |
| cross_dept_delivery | yes | yes |
| messages_cleared | yes |  |
| new_message | yes | yes |
| pointerdown |  | yes |
| subtask_update | yes | yes |
| task_update | yes | yes |

## DB Tables

| Table |
| --- |
| `agents` |
| `api_providers` |
| `cli_usage_cache` |
| `departments` |
| `messages` |
| `oauth_credentials` |
| `oauth_states` |
| `settings` |
| `subtasks` |
| `task_logs` |
| `tasks` |

## Sub-Agent Organization (from SQLite)

```mermaid
flowchart TD
  CEO["CEO"]
  D1["Planning"]
  CEO --> D1
  A1["Sage (team_leader/codex)"]
  D1 --> A1
  A2["Clio (senior/claude)"]
  D1 --> A2
  D2["Development"]
  CEO --> D2
  A3["Aria (team_leader/claude)"]
  D2 --> A3
  A4["Bolt (senior/codex)"]
  D2 --> A4
  A5["Nova (junior/claude)"]
  D2 --> A5
  D3["Design"]
  CEO --> D3
  A6["Pixel (team_leader/claude)"]
  D3 --> A6
  A7["Luna (junior/gemini)"]
  D3 --> A7
  D4["QA/QC"]
  CEO --> D4
  A8["Hawk (team_leader/claude)"]
  D4 --> A8
  A9["Lint (senior/codex)"]
  D4 --> A9
  D5["DevSecOps"]
  CEO --> D5
  A10["Vault (team_leader/claude)"]
  D5 --> A10
  A11["Pipe (senior/codex)"]
  D5 --> A11
  D6["Operations"]
  CEO --> D6
  A12["Atlas (team_leader/claude)"]
  D6 --> A12
  A13["Turbo (senior/codex)"]
  D6 --> A13
```

| Department | Agent | Role | CLI Provider |
| --- | --- | --- | --- |
| Planning | Sage | team_leader | codex |
| Planning | Clio | senior | claude |
| Development | Aria | team_leader | claude |
| Development | Bolt | senior | codex |
| Development | Nova | junior | claude |
| Design | Pixel | team_leader | claude |
| Design | Luna | junior | gemini |
| QA/QC | Hawk | team_leader | claude |
| QA/QC | Lint | senior | codex |
| DevSecOps | Vault | team_leader | claude |
| DevSecOps | Pipe | senior | codex |
| Operations | Atlas | team_leader | claude |
| Operations | Turbo | senior | codex |

> **CLI Provider types**: `claude`, `codex`, `gemini`, `copilot` (GitHub Copilot OAuth), `antigravity` (Google Antigravity OAuth), `api` (external API provider)
