# Unify backend into sini-front

Move the NestJS API (DataBridge360/sini-back) into this Next.js app as Route Handlers deployed on Vercel, so there is one deploy.
Branch: `feat/unify-backend` (from `develop`). The old backend lives at `../backend` and is the reference for every port.

## Specs

- **S1 — One deploy.** "la complejidad de doble deploy y el costo" → the whole API runs inside this Next app under `/api/v1/*`; the frontend calls it same-origin. Cloud Run is no longer needed.
- **S2 — Security not compromised.** "pero si la seguridad y demas no se ve comprometida, me parece bien unirlo" →
  - `SUPABASE_SERVICE_ROLE_KEY` and every secret stay server-only (`import "server-only"`, never `NEXT_PUBLIC_`).
  - Every route declares its access level (`public`, `user`, `organization`) in one route table; `user` reproduces `AuthGuard` and `organization` reproduces `AuthGuard` + `OrganizationGuard` exactly (bearer token, active profile, active membership or platform admin, active organization).
  - Same validation (Zod schemas), same error bodies and status codes, same body-size limits (JSON 256 KB, `/profile` 1 MB, logo 2 MB), same security headers as Helmet.
  - Login/refresh rate limit (10/min and 30/min per IP) kept as best-effort in-memory, documented.
- **S3 — Same contract.** Paths, methods, query params, response shapes and the `X-Next-Cursor` header stay identical to `../backend`, so the UI does not change beyond the API base URL.
- **S4 — No AI.** "no tenemos nada de IA y demas" + decision "Eliminarlo" → policy PDF analysis (`POST /policies/analyze`, `PolicyAnalysisModal`, OpenAI, `unpdf`, all `AI_*` env) is removed, not ported. `suggestNextPaymentDate` is kept if the policy form still uses it.
- **S5 — Attachments over Vercel's 4.5 MB limit.** Decision "Subida directa firmada" → task activity attachments keep 10 files × 5 MB, same MIME/extension rules. The browser asks the server for signed upload URLs (server validates session, org, task, type, size, fixed path), uploads directly to Supabase Storage, then confirms; the server verifies the objects exist under the signed paths with the declared size before creating the message and rows, and removes the objects if confirmation fails. All-or-nothing is preserved from the user's point of view.
- **S6 — Git.** "haz un git pull de develop y main" → done before starting (frontend `main` fast-forwarded 33 commits; backend up to date).

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1 S2 S3 | inline | pending | |
| T2 | S2 S3 | worker A: auth, profile, organizations, insurance-companies | pending | |
| T3 | S2 S3 | worker B: clients, policies, notices | pending | |
| T4 | S2 S3 | worker C: tasks (without attachment upload), club-plaza-registrations | pending | |
| T5 | S5 | inline | pending | |
| T6 | S1 S4 | inline: wire route table, base URL, remove AI, security headers | pending | |
| T7 | S1 S2 | inline docs/env + independent verify | pending | |

- T1: `server/` core: env, Supabase clients, HttpError family (Nest-compatible bodies), auth/org context, router with access table, body limits, validation helpers, rate limiter, `app/api/v1/[...path]/route.ts`; vitest + tests.
- T2–T4: port each module to `server/modules/<name>/{schemas,service,routes}.ts`, logic verbatim, Spanish comments kept.
- T5: signed upload flow (server routes + `lib/task-attachments.ts`/UI client).
- T6: aggregate routes, `NEXT_PUBLIC_API_URL` default `/api/v1`, delete policy-analysis UI, `next.config.ts` headers.
- T7: README, `.env.example`, deploy notes (Vercel env vars, Cloud Run shutdown is the user's step), verification.

## Log

- L1 (user): "estoy pensando seriamente en unificar el backend con el frontend, que opinas sobre este cambio? o mejor tenerlo separado"
- L2 (user): "la complejidad de doble deploy y el costo, no se si vale la pena, lo usamos solo 5 personas y no tenemos nada de IA y demas, esos commits los puedes borrar, haz un git pull de develop y main, pero si la seguridad y demas no se ve comprometida, me parece bien unirlo"
- L3 (decision): destination "En sini-front (Vercel)".
- L4 (evidence): backend still has `policy-analysis` (OpenAI) used by `components/views/policies-view.tsx:178`. Decision: "Eliminarlo".
- L5 (evidence): task activities upload up to 10 × 5 MB in one multipart request (`backend/src/tasks/tasks.controller.ts:127`); Vercel caps request bodies at 4.5 MB. Decision: "Subida directa firmada".
- L6 (note): `~/.git` (empty home repo, holds `engram-project-identity.json`) — user approved deletion, harness blocked `rm -rf`; user to run it manually.
