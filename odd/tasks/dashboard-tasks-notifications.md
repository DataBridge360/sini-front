# Task-centric dashboard, task notifications, nav polish

Branch `feat/gesti-dashboard`. Front-only: no migrations, no new endpoints.
Follows `odd/tasks/gesti-module.md` (Gesti chat + hover-rail sidebar, already committed).

## Specs

- S1 (verbatim): "en el sidebar fijate que la cantidad de aviso de cuantos hay por avisar y demas que actualmente es 68 esta cortado" — the count badge must be fully visible in the collapsed rail, the expanded sidebar and the mobile bar.
- S2 (verbatim): "luego mejoralo para mobile el navbar." — redesign the mobile bottom nav (< 900px): lighter active state (no solid block), clear icons and labels, badge placement, safe-area aware.
- S3 (verbatim): "Gesti lo pondremos arriba de polizas en el side, y principal en el navbar mobile" — desktop nav order Dashboard, Avisos, Tareas, Gesti, Pólizas, Asegurados, Club Plaza; Gesti is one of the primary cells of the mobile bar (not inside "Más").
- S4 (verbatim): "Ahora vamos a hacer un rediseño del home dashboard, haciendo un Hola mas amigable y un dashboard centrado mas en las tareas por realizar."
- S5 (verbatim): "Tambien vamos a agregar notificaciones en tareas, como cuando se este acercando la fecha de una tarea y no esta terminada o cosas asi" — decided scope (user choice, L2): bell in the header with an unread count, computed in the front from the tasks already loaded: overdue, due today, due tomorrow, assigned to me, and in review awaiting approval (for moderators). Read state stored in the browser (localStorage, per user + organization). "Marcar todo leído". Clicking an item opens that task.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2, S3 | inline (parent) | |
| T2 | S4, S5 | inline (parent): `lib/task-alerts.ts` derivation + tests, shared by T3 and T4 | |
| T3 | S4 | gentle-ai-worker: dashboard redesign | |
| T4 | S5 | gentle-ai-worker: notifications bell; parent wires it into the header | |

## Log

- L1 (user, verbatim): "perfecto, en el sidebar fijate que la cantidad de aviso de cuantos hay por avisar y demas que actualmente es 68 esta cortado, luego mejoralo para mobile el navbar. Ahora vamos a hacer un rediseño del home dashboard, haciendo un Hola mas amigable y un dashboard centrado mas en las tareas por realizar. Tambien vamos a agregar notificaciones en tareas, como cuando se este acercando la fecha de una tarea y no esta terminada o cosas asi, no se si es mejor un icono de notificaciones o que, puedes aportar ideas. Gesti lo pondremos arriba de polizas en el side, y principal en el navbar mobile"
- L2 (user decision): notifications scope = "Campana calculada en el front (Recomendado)" — not persisted notifications, not push.
- L3 (evidence): badge clipped because `.sp-nav` has `overflow-y: auto` (forces x clipping) and the badge sat at left 27px inside a 48px-wide button.
