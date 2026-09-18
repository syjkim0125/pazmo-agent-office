# Claw-Empire UI/UX Design Guide

> **Theme:** "Cute but Efficient Empire"
> **Goal:** Manage a chaotic AI empire with a smile.

---

## 1. Design Philosophy

Claw-Empire combines the **seriousness of a CLI dashboard** with the **charm of a pixel-art simulation**.
The interface should feel like a powerful command center ("The CEO's Desk") but populated by lively, autonomous agents.

-   **Dark & Glassy:** Deep slate backgrounds (`slate-950`) with translucent glass panels (`backdrop-blur`).
-   **Pixel Perfect:** Agents are rendered with `image-rendering: pixelated` to maintain their retro charm.
-   **Alive:** The UI breathes with subtle animations (`agent-bounce`, `pulse-ring`) to show the system is active.

---

## 2. Color System

We use Tailwind v4 with a custom `empire` palette.

### Primary Interface
| Color Name | Hex | Usage |
| :--- | :--- | :--- |
| `empire-900` | `#0f172a` | Main Background (Deep Space) |
| `empire-800` | `#1e293b` | Card Backgrounds |
| `empire-700` | `#334155` | Borders, Separators |
| `empire-500` | `#64748b` | Secondary Text |
| `empire-300` | `#cbd5e1` | Primary Text |

### Task Status (Semantic)
| Status | Color | Visual Meaning |
| :--- | :--- | :--- |
| **Inbox** | `Slate` | Unsorted, raw input. |
| **Planned** | `Blue` | Scheduled, ready to start. |
| **In Progress** | `Amber` | Active work, high energy. |
| **Review** | `Purple` | Needs wisdom/checking. |
| **Done** | `Green` | Success, profit. |
| **Pending** | `Orange` | Blocked, waiting. |
| **Cancelled** | `Red` | Dead end. |

### Department Coding
Departments are color-coded to allow quick scanning of the board.
-   **Development**: Cyan/Blue
-   **Design**: Pink
-   **Analysis**: Indigo
-   **Presentation**: Orange
-   **Documentation**: Teal

---

## 3. Components

### Glass Panels (`.game-panel`)
Used for the main game view and high-level dashboards.
-   **Background**: `rgba(255, 255, 255, 0.03)`
-   **Border**: `1px solid rgba(255, 255, 255, 0.06)`
-   **Effect**: `backdrop-filter: blur(12px)`
-   **Shadow**: Deep drop shadow for depth.

### Task Cards (`.dash-card` variant)
The core unit of work.
-   **Layout**: Header (Title + Priority), Badges, Status, Footer (Agent + Time).
-   **Interactivity**: Hover effects (`border-slate-600`), expand for details.
-   **Progress**: Subtask bars use a **Green-to-Emerald gradient**.

### Agent Avatars
-   **Source**: `/public/sprites/{id}-D-1.png`
-   **Rendering**: Always `pixelated` to prevent blur.
-   **Animation**: Agents in the office view must `bounce` when walking or working.
-   **Fallback**: Robot Emoji 🤖 if sprite missing.

---

## 4. Typography

We use a system font stack for maximum legibility and "native" feel.
```css
font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
```
-   **Headings**: Bold, often uppercase or tracked (letter-spacing) for "Dashboard" feel.
-   **Code/Logs**: Monospace (for Terminal panels).

---

## 5. Animation & Motion

Animations are critical for the "Alive" feel.

| Animation | Usage | Description |
| :--- | :--- | :--- |
| `agent-bounce` | Agents | Gentle up/down float. |
| `kpi-pop` | Metrics | Scale up/down when numbers change. |
| `sparkle-spin` | Awards/Shiny | Rotating sparkle effect. |
| `shimmer` | Loading | Skeleton loading state. |
| `xp-shine` | Progress | Shiny sweep across XP bars. |

---

## 6. Icons & Assets

-   **Icons**: [Lucide React](https://lucide.dev/) (v0.469+). Use thin strokes (1.5px or 2px) to match the UI.
-   **Sprites**: 12 unique agent sprites, 3 directions (Down, Left, Right).
-   **CEO**: `ceo-lobster.png` (The Boss).

---

## 7. Tone of Voice

-   **System Messages**: "Command accepted", "Deployment ready."
-   **Agent Dialogue**: Cute, slightly subservient but independent. "On it, Boss!", "Taking a coffee break."
-   **Error Messages**: Helpful but distinct. "Mission Failed" rather than "Error 500".

---

## 8. Layout Structure

The application uses a **Shell Layout** with a persistent sidebar and dynamic content area.

### Sidebar (`Sidebar.tsx`)
-   **Fixed Left**: Navigation and status summary.
-   **Theme**: Darker contrast (`slate-950` or `slate-900`).
-   **Function**: Context switching (Office -> Dashboard -> Tasks).

### Header (`App.tsx`)
-   **Sticky Top**: Always visible context.
-   **Style**: Glassmorphism (`bg-slate-900/80 backdrop-blur-sm`) to let content scroll "underneath".
-   **Elements**: Page Title, Global Actions (Announcements), Connectivity Status.

### Panels & Modals
-   **ChatPanel**: Slide-in from right. Dedicated communication channel.
-   **TerminalPanel**: Slide-in overlay for technical logs and output.
-   **AgentDetail**: Center modal for focused information.
