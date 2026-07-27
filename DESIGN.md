---
name: Sinipro
description: CRM interno de seguros — SaaS minimalista, sin sombras, color solo para estado
colors:
  shell-bg: "#f7f9ff"
  surface: "#ffffff"
  surface-low: "#f8fafc"
  surface-lowest: "#eef2f6"
  border: "#e1e7ef"
  border-strong: "#cbd5e1"
  text: "#181c20"
  text-muted: "#5b6575"
  text-faint: "#8a94a6"
  org-primary: "#176e64"
  sidebar-bg: "#f1f4fa"
  sidebar-text: "#434656"
  state-green: "#067647"
  state-green-soft: "#ecfdf3"
  state-amber: "#b54708"
  state-amber-soft: "#fffaeb"
  state-red: "#b42318"
  state-red-soft: "#fef3f2"
typography:
  body:
    fontFamily: "'Plus Jakarta Sans', Inter, 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "'Plus Jakarta Sans', Inter, 'Segoe UI', system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "'Plus Jakarta Sans', Inter, 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.02em"
  display:
    fontFamily: "'Plus Jakarta Sans', Inter, 'Segoe UI', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.2
rounded:
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.org-primary}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "0 24px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "0 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "12px"
---

# Design System: Sinipro

<!-- Bootstrap: extraído automáticamente del código el 2026-07-24 (app/globals.css bloque autoritativo ~línea 4076 + :root activo ~línea 1784, y utilidades Tailwind en components/views). El lenguaje cualitativo es inferido; refinar con /impeccable document cuando se quiera. -->

## Overview

**Creative North Star: "El escritorio ordenado del productor"**

Sinipro es un CRM interno con estética de SaaS minimalista (referencias: Linear, Notion, Vercel). Superficies blancas sobre un fondo azulado casi imperceptible (#f7f9ff), bordes de 1px, radios contenidos y cero sombras. La jerarquía se construye con tamaño y peso tipográfico, nunca con color: el color existe solo para comunicar estado de cobranza (verde/ámbar/rojo) y para el acento de la organización.

La densidad es de herramienta operativa: tipografía pequeña (13–14px de cuerpo), cards compactas, listas con encabezados escaneables. Nada de patrones de landing: sin gradientes, sin heroes, sin animaciones de bienvenida.

**Key Characteristics:**
- Plano y sin sombras; profundidad por bordes y tonos de superficie.
- Color = estado semántico o acento de organización, nunca decoración.
- Compacto y escaneable; sentence case en todo el copy.
- Acento white-label: `--org-primary` se define por organización en runtime.

## Colors

Paleta neutra fría con un único acento themable y tres colores de estado.

### Primary
- **Acento de organización** (`--org-primary`, default #176e64): botones primarios, focus rings (`--org-primary-soft`), detalles activos. Es un token runtime — cada organización lo redefine; nunca hardcodear su hue.

### Neutral
- **Fondo de shell** (#f7f9ff): fondo general de la app.
- **Superficie** (#ffffff): cards, paneles, modales, inputs.
- **Superficie baja** (#f8fafc) y **mínima** (#eef2f6): insets, hovers, cajas grises dentro de cards.
- **Sidebar** (#f1f4fa) con texto #434656: sidebar claro, esquinas derechas redondeadas (12px).
- **Borde** (#e1e7ef) y **borde fuerte** (#cbd5e1): 1px en todo; el borde fuerte marca selección/activo.
- **Texto** (#181c20), **muted** (#5b6575), **faint** (#8a94a6).

### Tertiary (estado semántico)
- **Verde** (#067647 sobre #ecfdf3): al día, pagado, confirmaciones.
- **Ámbar** (#b54708 sobre #fffaeb): por vencer, advertencias.
- **Rojo** (#b42318 sobre #fef3f2): vencido, errores, destructivo.
- **Azul informativo** (utilidades blue-50/blue-700): acciones informativas suaves en cards de avisos.

### Named Rules
**The Semantic-Color Rule.** Un elemento solo lleva color si comunica estado o es la acción primaria. Todo lo demás es neutro.
**The Org-Accent Rule.** El hue de marca viene de `var(--org-primary)`; ningún componente fija un color de marca propio.

## Typography

**Display Font:** Plus Jakarta Sans (con Inter / Segoe UI / system-ui de fallback; no se carga webfont — hoy renderiza el fallback del sistema)
**Body Font:** la misma familia; una sola voz tipográfica.

**Character:** Sans neutra, pequeña y densa; la jerarquía sale del tamaño y del peso, con pesos contenidos (400–600; bold solo en botones primarios).

### Hierarchy
- **Display** (500, 22–28px, 1.2): números destacados de KPIs del dashboard.
- **Headline** (500–600, 16–18px): títulos de página y de modal.
- **Title** (500, 14–15px, 1.4): títulos de card y de sección.
- **Body** (400, 13–14px, 1.5): contenido general, celdas, formularios.
- **Label** (500–600, 10.5–12px, muted): metadatos, encabezados de lista, chips de acción; los chips diminutos (≤11px) admiten semibold.

### Named Rules
**The Small-Type Rule.** El cuerpo nunca supera 14px; lo grande se reserva para números de KPI.

## Layout

Shell en grid de dos columnas: sidebar fija de 256px + contenido fluido. Páginas con `sp-page padded`; grids de cards de entidades (`sp-card-grid`) y paneles de lista con encabezados (`sp-list-panel` / `sp-list-header`). Ritmo de espaciado en múltiplos de 4px, con p-3 (12px) dentro de cards y p-4 (16px) en paneles. Los tableros kanban (Avisos, Tareas) usan columnas de ancho mínimo cómodo con scroll horizontal estilo ClickUp; en mobile cada columna ocupa casi toda la pantalla y se navega deslizando. Controles (inputs, selects, search) de ~36–40px de alto.

## Elevation & Depth

Sistema plano: **sin box-shadows**. La profundidad se expresa con bordes de 1px y escalones de superficie (#ffffff → #f8fafc → #eef2f6). Los modales se separan por overlay, no por sombra.

### Named Rules
**The No-Shadow Rule.** Ninguna superficie proyecta sombra; si un elemento necesita separarse, usa borde o un tono de superficie más bajo.

## Shapes

Dos radios: **12px (`rounded-xl`)** para cards, paneles, modales y botones de acción; **8px (`rounded-lg`)** para inputs, chips de acción y cajas internas; **pill (`rounded-full`)** para badges de estado y avatares. Bordes siempre de 1px. El sidebar redondea solo sus esquinas derechas (0 12px 12px 0).

## Components

### Buttons
- **Shape:** rounded-xl (12px), min-h 40px.
- **Primary (`.sp-primary-action`):** fondo `var(--org-primary)`, texto `var(--org-on-primary)`, px-24px, font-bold 14px; hover oscurece con `color-mix` al 88%, active al 80%.
- **Secondary (`.sp-secondary-action`):** superficie blanca + borde 1px, texto oscuro.
- **Chips de acción en cards:** rounded-lg, fondo tinte suave + texto 700 (ej. `bg-emerald-50 text-emerald-700`, `bg-blue-50 text-blue-700`, neutro `bg-slate-50 text-slate-500`), 10.5–11px semibold; hover sube al tinte 100.

### Chips / Badges
- **Estado:** pill rounded-full, fondo soft + texto del estado ("Al día"=verde, "Por vencer"=ámbar, "Vencido"=rojo, "Pagado"=verde), 11–12px.

### Cards / Containers
- **Corner Style:** rounded-xl (12px).
- **Background:** blanco con borde `border-slate-200` (#e1e7ef equivalente).
- **Hover (cards clickeables):** borde slate-300 + fondo `slate-50/60`; cursor-pointer; focus-visible ring con `var(--org-primary-soft)`.
- **Shadow Strategy:** ninguna (ver Elevation).
- **Internal Padding:** 12px (p-3); cajas grises internas `bg-slate-50 rounded-xl p-3.5`.

### Inputs / Fields
- **Style:** superficie blanca, borde 1px #e1e7ef, rounded-lg (8px), ~36px de alto; search con icono a la izquierda; selects con chevron.
- **Focus:** ring 2px `var(--org-primary-soft)`; sin glow.

### Navigation (Sidebar)
- **Style:** fondo claro #f1f4fa, texto muted #434656, labels de sección uppercase muted; grupos "Principal" y "Settings" (este último anclado abajo); footer con avatar + nombre + email + logout.
- **Active:** caja blanca con borde 1px fuerte + texto oscuro (card bordeada, nunca fill de color).

## Do's and Don'ts

### Do:
- **Do** usar borde 1px + escalón de superficie para separar; profundidad sin sombras.
- **Do** derivar todo color de acción de `var(--org-primary)` y sus variantes soft/muted.
- **Do** mantener el cuerpo en 13–14px y metadatos en 10.5–12px muted.
- **Do** usar los tintes soft (emerald-50/blue-50/slate-50 + texto 700) para acciones dentro de cards.
- **Do** escribir todo en español y sentence case, con la terminología del dominio (aviso, póliza, asegurado, rama).

### Don't:
- **Don't** agregar box-shadows, gradientes ni heroes; es una herramienta interna.
- **Don't** usar color como decoración: solo estado semántico o acción primaria.
- **Don't** hardcodear el color de marca; viene de la organización en runtime.
- **Don't** inventar datos, métricas o campos en las vistas; solo datos reales del backend.
- **Don't** editar los bloques `@layer` tempranos de `globals.css` esperando efecto: el bloque bare `.sp-shell.app-redesign` (~línea 4076 en adelante) es el autoritativo.
