# Gesti reply formatting, live notices, notices card and modal redesign

Locator: `odd/tasks/gesti-replies-notices-live-redesign.md` (Engram mirror: `odd/gesti-replies-notices-live-redesign/tasks`)

## Objective

1. Gesti replies read as well structured as the reference reply the user got from Sonnet 5.5 directly.
2. Two people looking at Avisos at the same time never contact a client who was already marked as notified or paid, without refetching the whole list on every change.
3. Notice cards and the notice detail modal show the contact data prominently and let the user mark notified / paid from the modal.

## Problem and evidence

- Gesti already runs on `claude-sonnet-5-5` (`server/modules/gesti/config.ts:8`). The difference with the reference reply is ours: `MAIN_SYSTEM_PROMPT` (`server/modules/gesti/prompts.ts:20-25`) forbids headings and asks for plain text with "•" bullets, and the renderer (`components/ui/streaming-text.tsx`) has no heading support.
- Realtime already exists for notices: Postgres triggers broadcast `policy_notice` / `notice_note` changes (`supabase/migrations/20260803120000_realtime_org_broadcast.sql:190-200`), `lib/use-realtime-sync.ts` listens on `org:<id>` and `lib/realtime.ts:114-121` invalidates `["notices", slug]`. Two gaps:
  - `components/views/notices-view.tsx:80` calls `useDeferRealtime(...)` while any notice modal or confirmation is open, so the person who is about to contact a client is exactly the one who does not see the change.
  - Every event invalidates the whole `/notices` list (full refetch per change).
- Contact data (phone, email) is only rendered inside the modal (`notices-view.tsx:443-460`), small; the cards do not show it. The detail modal has no notified / paid actions.

## Scope

In: Gesti main system prompt formatting rules, Gesti reply renderer, notices realtime client pipeline, one single-notice read endpoint if needed, notices cards, notice detail modal.
Out: database migrations and RPC bodies (parent repo `supabase/`), any remote operation, Gesti tools and sub-agent prompts, other views, commits.

## Constraints

- Gesti keeps the formal "usted" register, the `show_chart` rules, the `:::borrador` blocks, refs rules and `MAX_REPLY_CHARS`.
- UI copy stays in the project's Spanish (voseo in the app UI). Code, comments in new code, tests and this document in English unless the surrounding file is Spanish.
- No new dependencies (no react-markdown, no shadcn). Custom `Modal` primitive, Tailwind 4, DESIGN.md tokens.
- TDD mode: off (source: no project or session configuration found). Runner: Vitest (`pnpm test`, specs under `test/**/*.spec.ts`, node environment). Ordinary functional checks apply.
- About 400 changed lines per task is a planning heuristic only, never a cap or a reason to split, minify or drop tests.

## Tasks

- [ ] T1 Gesti reply formatting
  - Prompt (`FORMA DE RESPONDER`): open with a one or two sentence verdict; for reviews and analyses with several findings use up to four short `## ` section headings; findings as a numbered list where each item starts with a **bold label** followed by the explanation in one to three sentences; plain "-" bullets for simple enumerations; close with at most one offer or question; short answers stay as plain paragraphs with no headings. Still no markdown tables, no code blocks.
  - Renderer: `## ` and `### ` headings in `streaming-text.tsx`, safe while streaming (a partial marker at line start must not flash as text), "-" bullets if not already supported, styles in `app/gesti.css`.
  - Every place that consumes reply text as plain text (history preview, titles, copy, drafts) must not leak `##`.
  - Acceptance: the pasted claim-review example renders with headings, numbered bold-label findings and a closing question; existing specs pass; new specs cover headings and the streaming partial case.
- [ ] T2 Live notices without list refetch
  - Notices data stays live while a notice modal or confirmation is open (stop deferring for this view).
  - Confirmation dialogs work on fresh data: if the target was already marked by someone else, the dialog says who and when and offers only to close (notify), or reflects the new state (pay, revert). The detail modal reflects changes in place.
  - A `policy_notice` / `notice_note` event patches the cached list (payload, or one single-notice read batched inside the existing debounce window) instead of invalidating the whole list. Full invalidation remains for reconnect catch-up, for inserts and deletes that cannot be patched, and above a small batch threshold.
  - Verify whether `mark_notice_as_notified` and `process_policy_notice_payment` reject or tolerate an already-changed notice; handle the server answer gracefully in the UI and report the finding. Do not change the database.
  - Acceptance: with two sessions, marking notified or paid in one shows in the other within the debounce window, including with the modal open, with no `/notices` list request; specs cover the cache patching and the fallback.
- [ ] T3 Design proposal for notice cards and detail modal (mockup, user approval required before T4)
  - Contact (phone, email) readable and actionable on the card and at the top of the modal; notified / paid actions inside the modal, per notice; "already notified by X" state visible.
- [ ] T4 Implement the approved design in `components/views/notices-view.tsx` and `components/notices/shared.tsx`

## Checks

`pnpm test`, `pnpm typecheck`, `pnpm lint` after each task. T2 and T4 also need a manual two-session check in the running app.

## Progress and evidence

- 2026-11-10: document created after exploration.
- 2026-11-10: T1 implemented. Prompt formatting rules rewritten (`server/modules/gesti/prompts.ts`), heading blocks in `lib/gesti-stream-text.ts` and `components/ui/streaming-text.tsx`, styles in `app/gesti.css`, specs added. Left unchecked: no real model reply was tested against the new prompt and the heading styling was not looked at in the app.
- 2026-11-10: T2 implemented. `GET /notices?ids=` (max 20, same select and organization scope), `lib/notices-realtime.ts` batches events inside the existing 300 ms flush and patches the cached list; full invalidation remains for events without id, more than 15 notices per flush, a failed read and reconnect catch-up. `useDeferRealtime` removed from the notices view only. Dialogs decide on live data and show who already handled the notice. Local mutations patch the cache from the response. Left unchecked: the two-session behaviour and the "no list request" claim were not observed in a running app.
- 2026-11-10: T3 mockup published (three artboards: card states, modal pending, modal already notified by someone else with two policies). Waiting for user approval.
- Checks observed after T2 (writer, then re-run by the parent for `pnpm test`): `pnpm test` 39 files, 627 tests passed; `pnpm typecheck` no errors; `pnpm lint` 0 errors, 143 pre-existing warnings.

- 2026-11-10: T4 implemented. Contact block (copy only, plain text) on cards, list row (phone only) and modal; per-policy status pill and actions in the modal; "handled by someone else in the last two minutes" banner (`lib/notices.ts`, `lib/use-recent-handling-clock.ts`); `components/ui/modal.tsx` now stacks modals (z-index by depth), traps Tab, restores focus and supports opt-in `closeOnEscape` (the focus and Tab changes apply to every modal in the app). Checks after T4: `pnpm test` 40 files, 643 passed (re-run by the parent); `pnpm typecheck` clean; `pnpm lint` 0 errors, 143 warnings. Left unchecked: nothing was seen in a browser (layout, 390px, stacking, clipboard).
- Open copy points from T4 for the user: banner copy for "paid by someone else" ("<Nombre> registró el pago recién"), short "Pagar" / "Revertir" labels on grouped card rows, list row shows phone only.
- 2026-11-10: native review preflight ran; it asks for the selection of intended untracked files and the review was not started. The user then extended the session scope (`odd/tasks/loading-overlay-tasks-live.md`), so the review is deferred to one candidate covering both documents.

## Findings that need a decision (database, out of scope here)

- `mark_notice_as_notified` overwrites `notified_by` / `notified_at` when the notice is already "avisado" and succeeds, so the server does not stop a double notify; only the UI guard does. A race between two clicks in the same instant remains.
- `revert_policy_notice_status` acts on the current status, not on the caller's intent: a stale "revert payment" click after someone else already reverted turns "avisado" into "avisar".
- `process_policy_notice_payment` rejects an already paid notice (safe).
- Closing both races needs a migration that passes the expected current status to the RPCs.

## Accepted design decisions (user, 2026-11-10)

- The T3 mockup is approved with one change: contact rows keep only the copy action. No "Llamar", no "WhatsApp", no "Escribir"; phone and email are plain text, not `tel:` / `mailto:` links. Applied to the email row by consistency with the user's "only copy stays"; confirm with the user in the close report.
- 2026-11-10, second change: notifying is one action for all the policies of the detail. The per-policy "Marcar avisado" button is removed from the modal (`MODAL_OMITTED_ACTIONS` in `components/views/notices-view.tsx`); the footer button stays as the only notify action. Per-policy "Volver a avisar", "Registrar pago" and "Revertir pago" stay. Cards and list rows are unchanged. Checks: `pnpm typecheck` clean, eslint on the file clean. Not seen in a browser.
- Mockup sources (scratch, not in the repository, still show the removed buttons): `Main.dc.html` (card states), `Modal.dc.html` (pending), `ModalLive.dc.html` (already notified by someone else, two policies).

## Review

Receipt-driven development is on (global). The native review runs once, at the deliverable boundary after T4, not per task.

## Next step

User approval of the T3 mockup, then T4. Manual two-session check and a real Gesti reply check are pending for T2 and T1.
