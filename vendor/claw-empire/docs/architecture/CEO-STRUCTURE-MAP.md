# CEO Structure Map

Generated from parallel architecture analysis lanes:
1. Frontend module map (`src/`)
2. Backend module map (`server/`)
3. Tooling/docs map (`scripts/`, `docs/`)
4. Build/config map (`package.json`, `tsconfig*`, `vite.config.ts`, `.env*`)
5. End-to-end runtime sequence (UI -> API -> DB/CLI -> WS -> UI)
6. Repository inventory (tree and key files)

## High-Level System Map

```mermaid
flowchart LR
  subgraph FE[Frontend]
    FE0["src/main.tsx"]
    FE1["src/App.tsx"]
    FE2["src/components/*"]
    FE3["src/api.ts"]
    FE4["src/hooks/useWebSocket.ts"]
    FE0 --> FE1
    FE1 --> FE2
    FE1 --> FE3
    FE1 --> FE4
  end

  subgraph BE[Backend]
    BE0["server/index.ts"]
    BE1["Express REST (/api/*)"]
    BE2["WebSocket broadcast"]
    BE3["SQLite (claw-empire.sqlite)"]
    BE4["CLI/HTTP agents + logs + worktrees"]
    BE0 --> BE1
    BE0 --> BE2
    BE0 --> BE3
    BE0 --> BE4
  end

  FE3 <-->|HTTP| BE1
  FE4 <-->|ws://| BE2
  BE1 --> BE3
  BE1 --> BE4
```

## Frontend Composition

```mermaid
flowchart TD
  App["src/App.tsx"] --> Sidebar["components/Sidebar.tsx"]
  App --> Office["components/OfficeView.tsx"]
  App --> Dashboard["components/Dashboard.tsx"]
  App --> TaskBoard["components/TaskBoard.tsx"]
  App --> Settings["components/SettingsPanel.tsx"]
  App --> Chat["components/ChatPanel.tsx"]
  App --> AgentDetail["components/AgentDetail.tsx"]
  App --> Terminal["components/TerminalPanel.tsx"]
  App --> API["src/api.ts"]
  App --> Types["src/types/index.ts"]
  App --> WS["hooks/useWebSocket.ts"]
```

## Backend Runtime Surface

```mermaid
flowchart LR
  UI["Browser UI"] --> REST["Express routes"]
  UI --> WS["WebSocket server"]
  REST --> DB["SQLite tables"]
  REST --> Run["Task runner"]
  Run --> Proc["CLI process / HTTP provider"]
  Proc --> Log["logs/*.log + task_logs"]
  Log --> WS
  REST --> Git[".climpire-worktrees + git ops"]
  REST --> OAuth["oauth_credentials"]
```

## Core Runtime Sequence

```mermaid
sequenceDiagram
  participant UI
  participant API as src/api.ts
  participant S as server/index.ts
  participant DB as SQLite
  participant AG as CLI/HTTP Agent
  participant WS as WebSocket

  UI->>API: initial load (departments/agents/tasks/stats/settings)
  API->>S: GET /api/*
  S->>DB: SELECT/aggregate
  DB-->>S: rows
  S-->>API: json
  API-->>UI: hydrate state

  UI->>API: POST /api/tasks/:id/run
  API->>S: run request
  S->>DB: update task/agent + append logs
  S->>AG: spawn CLI or call HTTP model
  AG-->>S: output stream
  S->>WS: broadcast task_update/cli_output/agent_status
  WS-->>UI: live updates
  UI->>API: GET /api/tasks/:id/terminal
  API->>S: read log + task_logs
  S-->>API: terminal payload
  API-->>UI: terminal refresh
```

## Key Files

- Runtime entry: `server/index.ts`, `src/main.tsx`, `src/App.tsx`
- API contract layer: `src/api.ts`
- Shared model types: `src/types/index.ts`
- Visualization generator: `scripts/generate-architecture-report.mjs`
- Generated artifacts: `docs/architecture/README.md`, `docs/architecture/*.mmd`, `docs/architecture/architecture.json`

## Refresh Commands

```bash
npm run arch:map
```
