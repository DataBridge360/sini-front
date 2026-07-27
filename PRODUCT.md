# Product

<!-- impeccable:product-schema 1 -->
<!-- Bootstrap: generado automáticamente desde el código el 2026-07-24; los hechos marcados (inferido) no fueron confirmados por el usuario. -->

## Platform

web

## Users

Personal de organizaciones de productores/brokers de seguros en Argentina (inferido del dominio: DNI, patente, ramas, pólizas). Usan la app a diario como herramienta interna para gestionar cobranzas y cartera: cargar y seguir avisos de pago, consultar pólizas y asegurados, y coordinar tareas del equipo. Es multi-organización: cada organización tiene su propia marca (logo y color primario propio).

## Product Purpose

CRM interno de gestión de seguros. Centraliza avisos de pago (cobranzas), pólizas, asegurados, compañías aseguradoras, tareas de equipo y configuración, para que nada se venza sin gestionarse. El éxito es operativo: escanear rápido qué está al día, por vencer o vencido, y actuar (avisar, cobrar, registrar).

## Operating Context

- Herramienta interna de uso diario en escritorio; UI completamente en español.
- Frontend Next.js (App Router) consumiendo un backend propio en `http://localhost:4000` en desarrollo; sin claves de terceros en el cliente.
- Flujos principales: dashboard ejecutivo → tablero/lista de avisos (kanban con drag) → detalle de aviso (agrupado por asegurado, todas las pólizas juntas) → confirmaciones con mensaje copiable; ABM de asegurados y pólizas; tareas en kanban con notas enriquecidas (Tiptap).
- Terminología del dominio (usar siempre): aviso, póliza, asegurado, compañía, rama, patente, vencimiento, "Avisó / Cobró", "Al día / Por vencer / Vencido / Pagado".

## Capabilities and Constraints

- Vistas existentes: Dashboard, Avisos, Tareas, Pólizas, Asegurados, Compañías, Equipo, Configuración, Perfil, Login.
- Theming por organización en runtime: `--org-primary` (+ variantes soft/muted) se inyecta vía `lib/colors.ts`; el color de marca nunca se hardcodea.
- Datos reales únicamente: no inventar métricas, campos ni registros de ejemplo en las vistas (compromiso explícito del usuario).
- Rutas, endpoints, payloads y lógica de negocio se preservan en trabajos visuales (constraint del rediseño previo).

## Brand Commitments

- Estética confirmada por el usuario: SaaS interno minimalista tipo Linear / Notion / Vercel; lectura operativa por encima de impacto visual.
- Sin sombras; jerarquía por tamaño/peso, no por color; color reservado para estado semántico (verde=ok, ámbar=por vencer, rojo=vencido).
- Nombre del producto: Sinipro (Sinipro2 en metadata).

## Evidence on Hand

- La app real con datos reales del backend es la única evidencia; no existen testimonios, métricas de marketing ni sitio público. No fabricar ninguno.

## Product Principles

1. Escaneabilidad primero: el estado de cobranza se lee de un vistazo.
2. Sobriedad de herramienta interna: nada de patrones de landing/hero.
3. Consistencia entre vistas: mismos patrones de card, filtro, modal y botón en todas partes.
4. El color comunica estado, no decoración.
5. La marca de cada organización vive en su acento (`--org-primary`), no en la estructura.
