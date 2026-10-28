# Security hardening

Fixes from the 2026-10-28 security review of the Next API and Supabase.
Branch `fix/security-hardening`, stacked on `feat/gesti-ai`.

## Specs

- S1. "si vamos a actualizar entonces con el tema del punto 1": upgrade `next` (16.1.6, critical advisories incl. unauthenticated RCE in the image optimizer) to a patched release (>=16.4.1, latest 16.4.3) together with `eslint-config-next`, and `zod` (4.2.1) to >=4.6.6. Build, typecheck, tests and lint must stay green.
- S2. "arreglemos eso, de momento la cuenta de productor y organizaciones, va a ser solo una organizacion": a producer must not be able to take over an account that does not belong to their organization. Adding a team member with an email that already exists is allowed only when that user already has a membership (active or inactive) in this organization; otherwise "Ya existe un usuario con ese correo." Platform admins can never be added, edited or have their password changed from Equipo. Editing email or changing the password is refused if the user has any membership (active or not) in another organization.
- S3. "Agrega headers de seguridad": security headers on every response (pages, `/api/clubplaza/*`, `/api/v1/*`), not only `/api/v1`. Pages must keep working (Next inline scripts, Supabase realtime, images).
- S4. "los ids los puedes validar": every id path parameter in clients, policies, notices and team routes is validated as a UUID (400 "Validation failed (uuid is expected)"), like tasks and Gesti already do.

Out of scope (user decision): Club Plaza authorization (later), Gesti budget atomicity (the API key holds USD 100), asesor deletes (intended).

## Tasks

- T1 (S1) upgrade next, eslint-config-next, zod — inline — commit: c53ad46
- T2 (S2) team member takeover fix + tests — inline — commit: pending
- T3 (S4) uuid validation on id params + tests — inline — commit: pending
- T4 (S3) security headers for all routes + test — inline — commit: pending
- T5 verify (high risk: security, dependencies) — gentle-ai-verify

## Log

- L1 (user, verbatim): "Punto 1: si vamos a actualizar entonces con el tema del punto 1
Punto 2: arreglemos eso, de momento la cuenta de productor y organizaciones, va a ser solo una organizacion.
Punto 3: esta bien eso, lo vamos a arreglar mas adelante.

Agrega headers de seguridad, la decision de negocio esta bien, los ids los puedes validar. El tema del presupuesto es 100usd por mes, no va a ser mas que eso, la api tiene cargados 100usd y no va a gastar mas de eso."
- L2 (evidence T1): next 16.4.3, eslint-config-next 16.4.3, zod 4.6.7; tiptap ^3.32.0 (prosemirror-view paste XSS, @tiptap/core ReDoS); pnpm.overrides for brace-expansion, browserslist, source-map-js, baseline-browser-mapping. `pnpm audit --prod`: 68 -> 1 moderate (uuid <11.1.1 inside exceljs, v3/v5/v6 with buf, not used; major bump not forced). typecheck clean, 429 tests, lint 0 errors, build OK. next-env.d.ts is generated and left out.
