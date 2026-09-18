# Skill Learning History & Prompt Display Design

## 1. Overview
This document outlines the design specifications for the "Skill Learning History" feature, covering both the **CLI Prompt** (Text UI) and the **Web Dashboard** (Graphical UI).

**Goal:**
-   **CLI:** Provide immediate, unobtrusive visibility of active skills.
-   **Web:** Provide a comprehensive history of what each agent has learned, reinforcing the "memory" aspect.

---

## 2. CLI Prompt Design
The CLI prompt sits at the top of the user's interaction. It must be concise.

### 2.1 Format
```text
[Skills: <Skill-1> <Skill-2> ... <Skill-M>][+N more]
```

### 2.2 Visual Specification (ANSI Colors)

| Element | Text | Color (Tailwind approx) | ANSI Code (Approx) |
| :--- | :--- | :--- | :--- |
| **Label** | `[Skills:` | Slate-500 (`#64748b`) | `\x1b[90m` (Bright Black) |
| **Skill** | `react-native` | Emerald-400 (`#34d399`) | `\x1b[32m` (Green) or `\x1b[36m` (Cyan) |
| **Separator** | ` ` (space) | N/A | N/A |
| **Overflow** | `][+3 more]` | Slate-600 (`#475569`) | `\x1b[90m` (Dim) |
| **Closer** | `]` | Slate-500 | `\x1b[90m` |

### 2.3 Behavior
-   **Ordering:** Most recently learned/used first.
-   **Limit:** Show max 3-4 skills inline to prevent wrapping on standard terminals (80 cols).
-   **Empty State:** If no skills, do not show the bracket at all, or show `[Skills: None]` in dim grey (preference: hidden to reduce noise).

### 2.4 Mockup
```
> [Skills: web-design-guidelines vercel-react-best-practices][+2 more]
> User: Update the button component.
```

---

## 3. Web Dashboard Design
A new view or panel to inspect the "Brain" of the agents.

### 3.1 Location
-   **Primary:** A new tab in the `SkillsLibrary` or `AgentDetail` modal.
-   **Secondary:** A dedicated "Learning History" widget on the main Dashboard.

### 3.2 UI Components

#### **History Card (The "Memory Chip")**
Each learned skill is represented as a "Memory Chip" card.

-   **Container:** `bg-slate-800/50 border-slate-700/50` (Glass).
-   **Icon:** Category icon (e.g., 🎨 for Design).
-   **Title:** Skill Name (e.g., `web-design-guidelines`).
-   **Meta:**
    -   "Learned": Relative time (e.g., "2 days ago").
    -   "Provider": The CLI agent (e.g., Gemini, Claude).
-   **Status Indicator:**
    -   🟢 **Active:** Ready to use.
    -   🟡 **Learning:** Currently processing.
    -   ⚪ **Archived:** Learned but not loaded in context.

#### **Layout**
-   **Group By Agent:**
    -   **Gemini (Team Leader):** List of skills...
    -   **Claude (Senior):** List of skills...
-   **Sort:** Date Descending (Newest memories first).

### 3.3 Visual Style (CSS)
Refers to `src/index.css` variables.

```css
.memory-chip {
  @apply flex items-center gap-3 p-3 rounded-xl border transition-all;
  background: rgba(30, 41, 59, 0.4); /* empire-800 low opacity */
  border-color: rgba(51, 65, 85, 0.4); /* empire-700 */
}

.memory-chip:hover {
  background: rgba(30, 41, 59, 0.8);
  border-color: rgba(52, 211, 153, 0.4); /* empire-green */
  transform: translateY(-1px);
}

.memory-chip-active {
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.1); /* Subtle glow */
}
```

---

## 4. Animation "Brain Upload"
When a skill is just learned, show a specific animation in the Web UI.

-   **Animation:** `data-stream`
-   **Description:** Binary numbers or small icons streaming from the "Book" to the "Agent Head".
-   **CSS Keyframes:**
    ```css
    @keyframes upload-stream {
      0% { transform: translateY(10px); opacity: 0; }
      50% { opacity: 1; }
      100% { transform: translateY(-20px); opacity: 0; }
    }
    ```

## 5. Assets
-   **Skill Icons:** Use existing Emoji mapping from `SkillsLibrary.tsx` (Categories).
-   **Agent Avatars:** Use `AgentAvatar` component.
