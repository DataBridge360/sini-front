# Policy renewal: new number, previous numbers kept

Locator: `odd/tasks/policy-renewal-previous-numbers.md` (Engram mirror: `odd/policy-renewal-previous-numbers/tasks`). Same uncommitted working tree as the two earlier documents in `odd/tasks/`.

## Objective

From the notice detail, a policy can be marked as renewed with a new policy number. The old number is kept on the policy (one or many previous numbers), stays findable by search, and anything created under the old number (tasks today, claims later) keeps showing the number that was in force when it was created.

## Problem and evidence

- `policies.policy_number` is the only place the number lives. `tasks`, `policy_notices` and every other table hold only `policy_id` and read the number through a join (`server/modules/tasks/service.ts:78`, `server/modules/notices/service.ts:15`). A plain renumber would silently change the number on old tasks.
- Unique constraint `policies_unique_number_per_org (organization_id, insurance_company_id, policy_number)` (`estructura_base.sql:138`), soft-deleted policies included: a new number already used in that company is rejected (23505).
- Policy edit is a direct `.update()` (`server/modules/policies/service.ts:219-271`), no RPC, no history table.
- Search: server `policySearchOrFilter` (`policies/service.ts:141-161`) matches the current number only; notices and tasks filter in memory (`lib/notices.ts:87-95`, `lib/tasks.ts:212-218`); Gesti `listarPolizas` (`server/modules/gesti/data-tools.ts:318-350`).
- No realtime trigger on `policies`: other open sessions see the new number only after a refetch.
- No dropdown primitive in `components/ui`; `components/tasks/task-detail-menu.tsx` is the hand-rolled three-dots template. No generated database types; `Policy` and joined shapes are hand-written in `lib/api.ts`.

## Decisions

- One new column, as the user asked: `policies.previous_policy_numbers jsonb not null default '[]'`, an array of `{ number, replaced_at, replaced_by_user_id }`. The date is what lets a task show the number in force when it was created, with no column on `tasks` and no backfill.
- The renewal is atomic in the database (one RPC appends the old number and sets the new one), because append is a read-modify-write.
- Correcting a typo through the normal policy edit stays as it is and records no history.
- "Copiar" copies the policy number (assumption, told to the user).
- No realtime trigger on `policies` in this change.

## Scope

In: one migration file (written locally, NOT applied), renew endpoint, policy selects, search (policies server search, notices and tasks in-memory filters, Gesti policy lookup), three-dots menu and renew dialog in the notice detail, number-at-date display on tasks, previous numbers visible on the policy.
Out: applying the migration (parent, after the user sees it, production), claims, realtime for policies, commits.

## Constraints

- UI copy Spanish (voseo), code, comments in new code and tests English unless the surrounding file is Spanish. No new dependencies. TDD off (no configuration found); Vitest via `pnpm test`; checks `pnpm test`, `pnpm typecheck`, `pnpm lint` (base: 0 errors, 143 warnings).
- About 400 changed lines per task is a planning heuristic only, never a cap or a reason to split, minify or drop tests.
- The migration only adds: no drop, no delete, no rewrite of existing rows beyond the column default.
- The application code selects the new column, so it must not be deployed before the migration is applied.

## Tasks

- [ ] T8 Migration file `supabase/migrations/<timestamp>_policy_previous_numbers.sql`: column with array check, RPC `renew_policy_number` following the conventions of the existing notice RPCs (security, grants, organization scoping, active policy only, rejects an empty or unchanged number, lets the unique violation surface), and whatever the previous-number search needs.
- [ ] T9 Server: `POST /policies/:id/renew-number`, friendly errors for duplicate and unchanged number; previous numbers returned in the policy, notice and task selects; policies search and Gesti lookup match previous numbers and say which current policy they belong to.
- [ ] T10 Client: three-dots menu on each policy of the notice detail ("Copiar número", "Renovó póliza"), renew dialog (new number, Aceptar), caches refreshed (policies, notices, tasks); pure helper for the number in force at a date, used wherever a task shows its policy number; in-memory notice and task filters match previous numbers; previous numbers shown on the policy.
- [ ] T11 Apply the migration in production (parent, after user review, needs working Supabase access).

## Progress and evidence

- 2026-11-10: document created after exploration.
- 2026-11-10 (writer, T8-T10 implemented, NOT applied, checkboxes left for the parent): migration `supabase/migrations/20261110120000_policy_previous_numbers.sql` (column + array check, immutable helper `policy_numbers_search_text`, stored generated column `previous_policy_numbers_text`, RPC `renew_policy_number(p_policy_id, p_new_policy_number, p_organization_id, p_actor_user_id)` security definer, service_role only, row lock, P0001 for empty/unchanged, P0002 for not found, 23505 surfaces). Server: `POST /policies/:id/renew-number`, `previous_policy_numbers` in policy/notice/task selects, search and Gesti `listar_polizas`/`ficha_asegurado` match and state previous numbers. Client: `lib/policy-numbers.ts` (+ spec), task number shown at `created_at` (task-card, archived panel, task-detail-summary with "hoy #N" hint, alert helper, dashboard helper), notice/task in-memory filters, `components/notices/policy-renew.tsx` (PolicyMenu, RenewPolicyDialog) wired through NoticesView and `renewPolicyNumber` in app-shell, "Antes: ..." line in the notice detail and "Números anteriores" in the policy detail. Checks: `pnpm test` 44 files / 700 passed, `pnpm typecheck` clean, `pnpm lint` 0 errors / 143 warnings. Not verifiable without a DB/browser: the SQL itself, the generated column, the real RPC error codes through PostgREST, the UI.

## Next step

Delegate T8 to T10 to one writer; show the migration to the user.

- 2026-11-10: the user approved the migration as written (second generated column included). T11 still blocked: the Supabase connector answered "You do not have permission to perform this action" for the project again; nothing ran against production.

- 2026-11-10: Supabase access fixed (connector re-authenticated). Read-only check on production: `previous_policy_numbers` columns and `renew_policy_number` do NOT exist yet; 179 rows in `policies`. `apply_migration` was then refused by the Claude Code permission classifier (production deploy); nothing was applied and no alternative route was tried. T11 pending: the user applies it or allows `mcp__claude_ai_Supabase__apply_migration`.

- 2026-11-10: T11 done. The user authorized applying; migration `policy_previous_numbers` applied to production and read back: `previous_policy_numbers` (jsonb), `previous_policy_numbers_text` (generated), `renew_policy_number` (security definer, execute for service_role only), 179 policies, all with an empty list. `policy_numbers_search_text` keeps the default execute grant for anon/authenticated (pure function, no table access).
- 2026-11-10: delivery. Commit `162da6f` on develop, pushed; PR #15 develop to main opened. Merging the PR was refused by the Claude Code permission classifier (merge without review); not merged, no direct push to main attempted. No native review ran on this change. Checks before the commit: lint 0 errors / 143 warnings, typecheck clean, 700 tests, `pnpm build` ok. Still unverified: UI in a browser, two sessions, the renew flow end to end.

- 2026-11-10: PR #15 merged into main by the parent on the user's instruction (merge commit `a6665cd`). Deployment and behaviour in the running app not observed.

- 2026-11-10: user decisions after the merge. (1) A policy cannot be renewed to a number it already had (other policies may share numbers): checked in `PoliciesService.renewNumber` before the RPC, case and space insensitive, message "Esta póliza ya tuvo ese número antes. No se puede volver a un número anterior."; two specs added. (2) No database guard for the double-notify race (notified is only a control). (3) "Revertir pago" must always end in "avisado": `PATCH /notices/:id/revert` accepts optional `from` (status the caller saw) and returns the notice untouched when it no longer matches; the client sends it from `components/app-shell.tsx`. No spec covers the `from` path. No migration. Checks: typecheck clean, 702 tests, lint 0 errors / 143 warnings. Uncommitted, not deployed, not seen in a browser.
