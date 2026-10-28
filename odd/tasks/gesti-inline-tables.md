# Gesti inline, interactive tables

Branch `feat/gesti-inline-tables` (from `develop` at 8a9739b). Tables and charts render inside Gesti's reply, where Gesti showed them, and table rows open the record they list (task, policy, client, notice, company).
Builds on `odd/tasks/gesti-ai.md` (S2 there still holds: the model never sees internal ids).

## Specs

- S1 (verbatim): "prefiero que la tabla este dentro de la respuesta" — today `GestiCharts` renders after `StreamingText`, i.e. below the copy/like/sources action row (screenshot: table card under "2 fuentes"). Charts and tables must render inside the reply body: at the point of the text where Gesti called `show_chart` (text written before the call above it, text written after the call below it), snapped to a block boundary (never splitting a paragraph, list or draft), and always above the action row. Old stored messages without a position render their charts after the text, still above the action row. While streaming, a chart appears once the revealed text reaches its position.
- S2 (verbatim): "tambien con tareas y demas que sea interactio como ir a la tarea y demas" — rows of a `show_chart` table that list portfolio records are clickable and open that record in the CRM: task → opens the task (app-shell `openTask`); policy → the client's detail with that policy open (`clientDetailId` + `openPolicyId`); client → the client detail; notice (aviso de pago) → its policy (as policy); company → the companies tab. Rows are keyboard accessible (focusable, Enter/Space) with a visible affordance (pointer, hover, chevron or similar) and an accessible label. Rows without a record, the public demo (`/demo/gesti`, no navigation) and non-table charts stay non-interactive. Sorting a table keeps each row's link.
- S3 (security, from gesti-ai S2: "no podra ... dar informacion sensible como tipo de datos, endpoints, contraseñas, hashes y demas") — the models (Sonnet and the Haiku data agent) never see internal UUIDs. The data tools give each returned record an opaque per-turn reference (e.g. `#R3`) registered server-side for the current turn and organization; the data agent keeps the reference on each listed line; `show_chart` accepts an optional per-row reference list; the server resolves each reference against that turn's registry only (unknown, malformed or other-turn references are dropped silently, never an error to the user and never a link) and stores/emits the resolved `{ kind, id }` links with the chart. A link can only point to a record the caller's organization tools returned in this turn. Stored history replayed to the model never includes ids or links.
- S4 — "luego de esto subelo a develop tambien": after verification, merge to `develop` and push (parent does this).

## Tasks

- T1 [S1-S3] worker: server references + chart links (data-tools, agents/chat turn state, show_chart schema, prompts) and frontend inline placement + clickable rows (gesti-parts, ai-assistant-interface, streaming-text, gesti-chart(.css), gesti-view, app-shell). Tests + docs alongside. — done; commits: a5c9a26 (server + contract), next commit (frontend)
- T2 [S1-S3] verify: independent check (security S3). — done: S1/S2/S3 pass; defect 1 (other-turn #R numbers reused) fixed by parent with a random per-turn tag + real two-turn test; dead GestiCharts removed
- T3 [S4] parent: commit, merge to develop, push. — in progress

## Log

- L1 (user, verbatim): "prefiero que la tabla este dentro de la respuesta, tambien con tareas y demas que sea interactio como ir a la tarea y demas. lueg de esto subelo a develop tambien" (with screenshot: table card rendered below the reply's action row).
- L2 (parent decision): opaque per-turn references instead of ids for the model, to keep gesti-ai S2 and make hallucinated or foreign links impossible.
- L3 (verify): S1-S3 pass; low defects: other-turn reference numbers reused (fixed), row aria-label uses first cell (kept), streaming slot may briefly sit one block off (kept). Pre-existing: file UUIDs visible to the model via file_id (gesti-ai design, out of scope).
- L4 (checks): tsc, eslint, vitest 551/551, next build green.
