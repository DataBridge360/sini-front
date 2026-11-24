# Dashboard proposals: shared brief (scratch, not committed)

User request (verbatim): "no me gusto el dashboard, dame 3 propuestas de diseños con claude desing"
Previous request this replaces (verbatim): "Ahora vamos a hacer un rediseño del home dashboard, haciendo un Hola mas amigable y un dashboard centrado mas en las tareas por realizar."

Product: SiniPro, internal CRM for an insurance broker (productor asesor de seguros, Argentina). Spanish UI with voseo ("Tenés", "Revisá").
Brand: cube mark blue #0a72d1; mascot Gesti (AI assistant) avatar at /gesti/gesti-avatar.webp (also /gesti/gesti.webp full body).
Design system (frontend/DESIGN.md): app bg #f7f9ff, surfaces #ffffff, borders 1px #e1e7ef, text #181c20 / muted #5b6575 / faint #8a94a6,
radii 12px cards, 8px controls, pills for status; no heavy shadows; color only for state:
red #b42318 (overdue), amber #b54708 (today), blue #0a72d1 (tomorrow/info), violet #6941c6 (review), green #067647 (done).
Font: "Plus Jakarta Sans" (load from Google Fonts), 13-14px body.

Each mockup is ONE self-contained static HTML file (inline CSS, tiny inline JS allowed for hover/checkbox/toggle), 1440px desktop layout
that also collapses sensibly at 390px (media query). Include the real shell for context: a 72px white icon rail on the left with the
blue cube logo at top (use the inline SVG below) and nav icons (simple inline SVG or emoji-free shapes), and a 64px top header with
page title "Dashboard", a bell with badge 4 and a user pill "Lucas Segura · Productor".

Sample data to use (same in all three, so they are comparable). Today = lunes 26 de octubre, 15:30:
Tasks (mine):
- "Renovar póliza de automotor" · Ana Pérez · Pól. 7781-03 · alta · pendiente · venció hace 2 días
- "Enviar documentación del siniestro" · María López · Pól. 4581-22 Automotores · media · en proceso · vencida ayer
- "Llamar por la cotización de hogar" · Juan Gómez · media · en proceso · hoy
- "Confirmar pago de cuota" · Carlos Díaz · Pól. 1203-11 · alta · pendiente · hoy
- "Cargar endoso de comercio" · Kiosco El Sol · baja · pendiente · hoy
- "Cotizar seguro de moto" · Lucía Fernández · media · pendiente · mañana (te la asignó Sofía Ruiz hoy)
- "Revisar renovación de flota" · Transportes Sur · alta · pendiente · jueves 29
- "Armar propuesta de vida" · Pedro Ramírez · baja · pendiente · viernes 30
Awaiting my approval (review): "Alta de póliza de vida — Sofía Ruiz", "Baja de cobertura de granizo — Martín Sosa".
Done today: 3 of 8 (progress 37%).
Notices (avisos de vencimiento de cuotas): 68 to contact, 12 contacted, 41 paid this month; cobranza 34%.
Portfolio: 312 asegurados, 486 pólizas activas.
Gesti suggestion examples: "Redactá el recordatorio de pago para Carlos Díaz", "¿Qué documentación falta en el siniestro de María López?".

Cube logo SVG (viewBox -420 -420 840 840, fill #0a72d1):
<path d="M-332.6-192 0-384l200 115.5-88 50.8L0-282.4l-200.6 115.8L0-50.8l288.6-166.6 44 25.4v384L132.5 307.5V205.9l112.1-64.7V-90.4L0 50.8l-332.6-192Z"/><path d="m-332.6-32 88 50.8v122.4L88 333.2 0 384l-332.6-192Z"/>

Quality bar: this is a design pitch. It must look like a polished, opinionated, minimalist SaaS product (think Linear, Things 3, Height, Notion calendar),
with clear hierarchy, generous but disciplined spacing, real typographic rhythm, consistent 4px grid, tabular numbers, believable micro-details
(relative dates, avatars with initials, priority marks, hover states). Not a template, no lorem ipsum, no stock gradients, no emoji icons.
At the top-right corner of the page body, add a small fixed label "Propuesta X · <name>" so the user can tell them apart.
