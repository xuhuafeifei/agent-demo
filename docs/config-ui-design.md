<!-- Technical design for the new fgbg.json configuration UI -->

# `fgbg.json` Web Configuration Interface

## 1. Goals

- Provide a dedicated HTML/JS view for inspecting and mutating the `fgbg.json` definition without exposing raw files or bypassing existing backend validations and defaults.
- Reuse the current static bundle (`src/public/index.html` + `app.js`) by adding an extra view that can route-switch next to the existing chat experience.
- Provider API keys are edited in the settings UI; there is no separate OAuth login flow for Qwen.

## 2. Backend contract

### Data in-flight
- The backend continues to expose only `FgbgUserConfig` payloads (i.e., the resolved/sanitized config after `resolveFgbgUserConfig` runs). No raw text or internal-only fields leak to the UI.
- Every response includes:
  - `meta`: timestamps so the UI can show “last touched”.
  - `sourceHints`: metadata describing which sections are defaults (`isDefault: true`) and which can be edited (`canEdit: true`). Sensitive fields may add `protected: true`.
  - `values`: the actual config tree plus optional `notes` per branch so UI can surface validation hints or required ranges.

### API endpoints
| Route | Method | Purpose | Payload | Notes |
| --- | --- | --- | --- | --- |
| `/api/config/fgbg` | `GET` | Fetch the latest merged config + metadata | Query `?refresh=true` to bypass cache | Returns full `FgbgUserConfig` + metadata described above |
| `/api/config/fgbg` | `PATCH` | Update only the changed sub-tree | `DeepPartial<FgbgUserConfig>` | Backend merges, validates, writes via `writeFgbgUserConfig`, then evicts cache and echoes the fresh snapshot |
| `/api/config/fgbg/reset` | `POST` | Restore defaults | `{ reason?: string }` | Writes `{}` to disk so `resolveFgbgUserConfig` recomputes defaults |

## 3. UI structure

### Entry shell
- Add a global nav bar next to the header containing two pill buttons: `聊天` and `配置`. Tracking the hash (`#chat`, `#config`) determines which view is mounted.
- Both views share the existing layout (app shell, global styles, asset loading). Only one `<main>` is visible at a time.

### Config view layout
1. **Hero area**
   - Title: `配置中心` + subtitle `控制 fgbg.json`
   - Metadata chips: `最后更新时间` from `meta.lastTouchedAt`, `缓存状态` (live/expired).
   - Action buttons:
     - `刷新` (`GET ?refresh=true`)
     - `恢复默认` (`POST /api/config/fgbg/reset`, shows confirm modal)

2. **Default indicator strip**
   - Inline badges or tags that explain what “系统默认” means and show the number of default-only sections (`isDefault: true`) returned.
   - Each badge comes with tooltip text: “此内容由后端默认值补齐，即便清空也会被自动恢复。”

3. **Config cards**
   - Split by top-level modules (`Models`, `Agents`, `Logging`, `Heartbeat`, `Channels`).
   - Each card shows:
     - Collapsible header with module name + quick summary (e.g., memory search mode).
     - Key/value rows: label, input (text/number/toggle), default hint, `来源` tag (default/override).
     - Inputs respect `sourceHints`: if `canEdit` is false or `protected` true, render as read-only or substitute with a `copy` button + hint.
     - Validation rules mirrored from backend (e.g., `logging.cacheTimeSecond` between 60-300). Inline error hints (red text) appear before submission.
     - Fields that are defaults but user can override include a “设为自定义” link that adds the field to the PATCH payload with a new value.

4. **Provider detail**
   - `qwen-portal` uses the same form as other providers: Base URL, API Key, model, and test connection.

5. **Save toolbar**
   - “保存变更” button disabled until diff detected. On click, collects only dirty fields + sends to `PATCH`.
   - “重置变更” clears local form state to match last fetched snapshot.
   - Inline toast area for success/failure messages returned by backend.

## 4. Routing behavior

- Use a lightweight hash router because the project currently ships a single `index.html`.
  - `window.location.hash === "#config"` reveals `<section id="config-view">`.
  - `#chat` (or empty hash) shows the existing chat module.
  - Clicking header nav buttons updates the hash and calls `renderRoute`.
- `app.js` already wires DOM elements; extend it with `initConfigView()` invoked on first navigation to `#config`.
  - Avoid re-fetching the config until necessary (`lazy init + refresh button`).
  - Keep `chat-view` helpers untouched; the router simply toggles CSS classes (`hidden`) and resets focus.

## 5. Data flow & UX notes

- On load, `initConfigView`:
  1. Fetch config snapshot.
  2. Normalize metadata into per-field descriptors (`sourceHints`).
  3. Render UI (cards, tooltips).
  4. Hook inputs to update a `dirty` tree that tracks modifications.

- On save, send only fields that changed to minimize write contention; backend still merges the partial patch.
- After successful patch, refresh the in-memory snapshot and clear dirty flags.
- If backend replies with `protected` or validation errors, display them under inputs and keep `Save` disabled until corrected.
- For defaults, display `默认值` chip next to the control; clicking “恢复默认” on a field sets it back to `undefined` and relies on backend to reapply fallback on next fetch.

## 6. Next steps

1. Implement the router shell toggling in `src/public/app.js` and add the `config` section markup to `index.html`.
2. Build the `ConfigView` module (plain JS) that handles fetching, diffing, form generation, and submission.
3. Add backend handlers in `src/middleware` (or equivalent) for the new API routes.
4. Document the qwen API key script in README for new users.

需要我同步分支/文件准备好接口再开始编码？***
