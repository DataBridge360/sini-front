# Task-centric dashboard, task notifications, nav polish

Branch `feat/gesti-dashboard`. Front-only: no migrations, no new endpoints.
Follows `odd/tasks/gesti-module.md` (Gesti chat + hover-rail sidebar, already committed).

## Specs

- S1 (verbatim): "en el sidebar fijate que la cantidad de aviso de cuantos hay por avisar y demas que actualmente es 68 esta cortado" — the count badge must be fully visible in the collapsed rail, the expanded sidebar and the mobile bar.
- S2 (verbatim): "luego mejoralo para mobile el navbar." — redesign the mobile bottom nav (< 900px): lighter active state (no solid block), clear icons and labels, badge placement, safe-area aware.
- S3 (verbatim): "Gesti lo pondremos arriba de polizas en el side, y principal en el navbar mobile" — desktop nav order Dashboard, Avisos, Tareas, Gesti, Pólizas, Asegurados, Club Plaza; Gesti is one of the primary cells of the mobile bar (not inside "Más").
- S4 (verbatim): "Ahora vamos a hacer un rediseño del home dashboard, haciendo un Hola mas amigable y un dashboard centrado mas en las tareas por realizar."
  - S4 revision (L7-L8): the first redesign was rejected ("no me gusto el dashboard, dame 3 propuestas de diseños"). The user chose "A · Agenda del día": implement `public/design/dashboard-a.html` in the real dashboard. Rows open the task (no completing or approving from the dashboard: that goes through the Tareas status flow and its permissions); the status circle is an indicator (empty = pendiente, half = en proceso).
  - S4 revision 2 (L9, verbatim): "perdon me gusta mas el c, pero necesito sea mejor, mas simple, sin ruido visual, bien ordenado y que se pueda ver en una sola pantalla sin hacer mucho scroll, un poco de scroll si es necesario pero en lo posible no mucho, accesos rapidos y demas" — base: `public/design/dashboard-c.html` (Briefing de Gesti), simplified; fits a 1440x900 viewport with little or no scroll; includes quick actions.
  - S4 revision 3 (L10, verbatim): "sigue sin gustarme el dashboard, que sea mas limpio y un listado en el inicio con las tareas. Que tenga un estilo billetera virtual digamos, un poco" — wallet-app home (Mercado Pago / Ualá style): balance-like hero card, circular quick actions, then the task list as the main "activity" list.
- S5 (verbatim): "Tambien vamos a agregar notificaciones en tareas, como cuando se este acercando la fecha de una tarea y no esta terminada o cosas asi" — decided scope (user choice, L2): bell in the header with an unread count, computed in the front from the tasks already loaded: overdue, due today, due tomorrow, assigned to me, and in review awaiting approval (for moderators). Read state stored in the browser (localStorage, per user + organization). "Marcar todo leído". Clicking an item opens that task.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2, S3 | inline (parent) | 38da2b6 |
| T2 | S4, S5 | inline (parent): `lib/task-alerts.ts` derivation + tests, shared by T3 and T4 | 612bc1e |
| T3 | S4 | gentle-ai-worker: dashboard redesign | 38da2b6 |
| T5 | S4 (revision) | gentle-ai-worker: dashboard as proposal A | dropped (L9) |
| T6 | S4 (revision 2) | gentle-ai-worker: dashboard as refined proposal C | 4003c16 |
| T7 | S4 (revision 3) | gentle-ai-worker: wallet-style dashboard | 0bf558f |
| T8 | S4 (revision 4) | inline: pastel visual style (prototype wallet-3) | d2bc27a |
| T4 | S5 | gentle-ai-worker: notifications bell; parent wires it into the header | 9e67e92 (bell), 38da2b6 (wiring) |

## Log

- L1 (user, verbatim): "perfecto, en el sidebar fijate que la cantidad de aviso de cuantos hay por avisar y demas que actualmente es 68 esta cortado, luego mejoralo para mobile el navbar. Ahora vamos a hacer un rediseño del home dashboard, haciendo un Hola mas amigable y un dashboard centrado mas en las tareas por realizar. Tambien vamos a agregar notificaciones en tareas, como cuando se este acercando la fecha de una tarea y no esta terminada o cosas asi, no se si es mejor un icono de notificaciones o que, puedes aportar ideas. Gesti lo pondremos arriba de polizas en el side, y principal en el navbar mobile"
- L2 (user decision): notifications scope = "Campana calculada en el front (Recomendado)" — not persisted notifications, not push.
- L3 (evidence): badge clipped because `.sp-nav` has `overflow-y: auto` (forces x clipping) and the badge sat at left 27px inside a 48px-wide button.
- L4 (evidence): typecheck clean, 192 tests pass, lint 0 errors (1 pre-existing warning `isSettingsTab`). Screenshots at 1440 and 390 px: badge "68" fully visible (rail + expanded + mobile), Gesti above Pólizas and center of mobile bar, bell panel desktop and mobile sheet, dashboard desktop and mobile, dashboard task click opens /tareas with the detail modal.
- L5 (evidence): Lightning CSS dropped `flex-direction`/`gap` when merging the mobile `.sp-header .sp-header-actions` rule; moved them to a separate `:has(.sp-bell)` rule.
- L6 (slice note): T1 and T3 share components/app-shell.tsx and app/globals.css, so they landed in one commit (38da2b6).
- L7 (user, verbatim): "no me gusto el dashboard, dame 3 propuestas de diseños con claude desing"
- L8 (user decision): "A · Agenda del día". Proposals A/B/C live as scratch prototypes in public/design/ (not committed).
- L9 (user, verbatim): "perdon me gusta mas el c, pero necesito sea mejor, mas simple, sin ruido visual, bien ordenado y que se pueda ver en una sola pantalla sin hacer mucho scroll, un poco de scroll si es necesario pero en lo posible no mucho, accesos rapidos y demas". T5 (proposal A) cancelled mid-way; its uncommitted changes discarded.
- L10 (user, verbatim): "sigue sin gustarme el dashboard, que sea mas limpio y un listado en el inicio con las tareas. Que tenga un estilo billetera virtual digamos, un poco"
- L11 (user, verbatim): "No me gusta cómo sigue estrando el dashboard, así que vamos a tratar de cambiar el diseño. Me gusta cómo está estructurado, pero no me gusta la parte del diseño." Three static prototypes (claro, oscuro, pastel); user picked "3 · Suave con color pastel". Structure kept; hero chips added via buildHeroSummary().chips (RED 3 failing → GREEN).
