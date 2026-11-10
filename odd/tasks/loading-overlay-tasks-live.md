# Single overlaid loader and live tasks

Locator: `odd/tasks/loading-overlay-tasks-live.md` (Engram mirror: `odd/loading-overlay-tasks-live/tasks`). Follows `odd/tasks/gesti-replies-notices-live-redesign.md`, whose changes are in the same uncommitted working tree.

## Objective

1. One loading indicator per page, overlaid on top of the content with a slightly more opaque backdrop, never several mascot loaders stacked between modules with the UI visible underneath.
2. Tasks update live with the same approach as notices: no full list refetch per change.
3. Confirm the database side of realtime (triggers, channel policy) against the real project.

## Problem and evidence

- `LoadingState` (`components/ui/states.tsx:16`, `.sp-loading` at `app/globals.css:2909`) is an in-flow block with no position, z-index or backdrop, so it sits between real content.
- Dashboard: `dashboard-view.tsx:100` renders a loader above `BalanceCard`, `QuickActions` and `TaskFeed`, which render unconditionally, and `task-feed.tsx:66` renders a second loader. The first one waits on `notices.isLoading || clients.isLoading || policies.isLoading` (`app-shell.tsx:751`), three unfiltered lists, so it lingers until the slowest finishes. The `dynamic()` fallback (`app-shell.tsx:72`) adds a third loader in sequence.
- Other uses: tasks-view:398, archived-tasks-panel:162, notices-view:199, policies:128, clients:104, companies:41, team:190, clubplaza:381, client-detail-screen:501.
- Tasks realtime exists (`lib/realtime.ts:89-138`): every `task`, `task_message`, `task_attachment` event invalidates `["tasks", slug]` (full `GET /tasks`), plus `task-stats` and `tasks-archived`. `["tasks", slug]` is shared by the tasks view, the dashboard and the alerts bell. The global `useDeferRealtime` is held by `task-form-modal.tsx:55` for as long as the form is open (also pausing every other entity), by `task-detail-modal.tsx:360` while saving and by `task-board.tsx:46` while dragging.
- Server: `GET /tasks/:id` exists, no read by ids (`server/modules/tasks/schemas.ts:101`). Notices already has `?ids=` and `lib/notices-realtime.ts` as the pattern.
- Database per migration files: `tasks`, `task_messages`, `task_attachments` all have broadcast triggers (`20260803120000_realtime_org_broadcast.sql`), grants tightened in `20260804010000`. No task table lacks a trigger. Whether both are applied in production is NOT verified: the Supabase connector answered "You do not have permission to perform this action" for project `xhqttlldvawsntrqifib`.

## Scope

In: loading component and its uses, dashboard loading condition, tasks realtime client pipeline, `ids` filter on the tasks list endpoint.
Out: database changes (none needed per the files), commits, remote operations by workers, Gesti chat spinner (`GestiLoader`), skeletons inside the task detail modal.

## Constraints

- Same as the previous document: UI copy Spanish (voseo), code and tests English, no new dependencies, TDD off (no configuration found), Vitest via `pnpm test`, checks `pnpm test`, `pnpm typecheck`, `pnpm lint` (base: 0 errors, 143 warnings).
- About 400 changed lines per task is a planning heuristic only.
- Production database: read-only checks only; nothing is dropped or deleted; any migration is shown to the user before it is applied.

## Tasks

- [ ] T5 Single overlaid loader
  - A page shows at most one mascot loader at a time, overlaid on the view content area (not the navigation rail or header), centred, above the content, with a backdrop of the app background at high opacity so the content underneath does not compete. Several modules loading at once still produce one loader. Loaders inside modals and side panels stay local to that surface and compact.
  - Dashboard: loading depends only on the data the dashboard actually renders; the task feed does not add a second mascot loader.
  - The `dynamic()` fallback uses the same overlay so the chunk load and the data load read as one continuous loader, without a jump in position.
  - Accessible: `role="status"`, content underneath not interactive while covered, respects reduced motion.
  - Acceptance: no page renders two `.sp-loading` mascots at once; specs cover whatever pure logic decides visibility.
- [ ] T6 Live tasks without list refetch
  - `GET /tasks?ids=` with the list select, same scoping and access as the list, capped like notices.
  - Task, message and attachment events patch `["tasks", slug]` from one batched read inside the existing flush; hard deletes remove without a request; archived or deleted tasks leave the active list. `task-stats` and `tasks-archived` are invalidated only when the event can change them. The open task detail keeps its current per-task invalidation. Full invalidation remains for events without id, large batches, a failed read and reconnect catch-up.
  - The task form modal stops holding the global realtime deferral; dragging and saving keep it. The form must not lose what the user typed when the list updates underneath.
  - Local task mutations stop triggering a full list refetch where the response already carries the task.
  - Acceptance: with two sessions, a task created, moved, reassigned, commented or deleted in one appears in the other's board, dashboard feed and alerts bell without a `GET /tasks` list request; specs cover patching and fallbacks.
- [ ] T7 Database verification (parent, needs working Supabase access): applied migrations include `20260803120000` and `20260804010000`; the five broadcast triggers exist and are enabled; the `realtime.messages` select policy exists. Apply the missing migration files unchanged if absent (authorized by the user, production, no destructive statements).

## Progress and evidence

- 2026-11-10: document created after exploration. T7 blocked on connector permission.
- 2026-11-10: T5 implemented. `lib/page-loading.ts` is a registry of page-level loaders; `LoadingState` (`components/ui/states.tsx`) registers instead of drawing, and `PageLoadingHost` in `components/app-shell.tsx` draws the only mascot, over `.sp-workspace` (z-index 20, below the header), background `color-mix(in srgb, var(--sp-bg) 90%, transparent)`, shown after 120 ms and hidden after 100 ms so the chunk fallback and the view loader read as one. Content is `inert` while covered. Dashboard loads on `notices.isLoading || tasksQuery.isLoading` only; the task feed loader is gone. `client-detail-screen` and `archived-tasks-panel` use `variant="local"`. Left unchecked: not seen in a browser.
- 2026-11-10: T6 implemented. `GET /tasks?ids=` (max 20, same scope and board filter as the list); `lib/tasks-realtime.ts` batches events in the 300 ms flush and patches `["tasks", slug]`; `task-stats` invalidated on insert, delete, status or assignee change; `tasks-archived` on status or archive change or for tasks not on the cached board; full invalidation for events without id, more than 15 tasks, failed read, reconnect. In-flight optimistic moves hold realtime patches for that task and re-read it once on settle; rollback reverts only that card. Form modal no longer defers realtime. Left unchecked: two sessions not observed.
- Checks after T6 (writer, `pnpm test` re-run by the parent): `pnpm test` 43 files, 682 passed; `pnpm typecheck` clean; `pnpm lint` 0 errors, 143 warnings.

## Known caveats (not verified in a browser)

- `Modal` is not portalled, so a modal opened while the page loader is visible would be inert until the loader hides. The loader only shows on first load, so the window is short.
- `.sp-workspace` is now `position: relative`; absolutely positioned descendants that relied on a higher ancestor were not audited.
- The overlay's sticky centring assumes a 4rem header; on mobile the mascot may sit slightly off centre.
- A failed ids read during an in-flight optimistic move can flash the card back briefly.

## Review outcome

- 2026-11-10: the user granted the review for the combined candidate (40 files, 3728 lines, medium risk). START refused with `lens_context_budget_exceeded`: no review authority was created and nothing was reviewed. The tool requires smaller candidates (a chained sequence of smaller commits, each under the budget). Deferring the review to one combined candidate was the parent's choice and made it too large. Pending user decision: split into commits per task and review each, or deliver unreviewed under ordinary repository policy.

- 2026-11-10: correction. The user's "no quiero" referred to the duplicated notify button, not to the review. The review split question is still unanswered; nothing was declined.

## Next step

T7 when the user fixes Supabase access. Manual checks in the running app: loader on each view, two sessions for tasks and notices.

- 2026-11-10: T7 read-only check on production (project xhqttlldvawsntrqifib): the five broadcast triggers exist and are enabled (`trg_policy_notices_broadcast`, `trg_notice_notes_broadcast`, `trg_tasks_broadcast`, `trg_task_messages_broadcast`, `trg_task_attachments_broadcast`), `broadcast_organization_change()` exists, and the `realtime_messages_org_broadcast_select` policy exists on `realtime.messages`. They are not in the recorded migration list (which ends at `gesti_ai`), so they were applied outside the migration history. Not checked: the grants of `20260804010000_realtime_tighten_grants.sql`.
