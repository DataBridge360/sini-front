# Rediseño UX/UI Sinipro2

## Problemas detectados

- La interfaz mezclaba patrones de landing/hero con una herramienta interna: gradientes fuertes, sombras grandes, tipografías muy pesadas y pantallas de bienvenida animadas.
- El dashboard priorizaba impacto visual por encima de lectura operativa.
- Las listas funcionaban como filas sueltas sin encabezados claros, lo que hacía difícil escanear avisos, pólizas y asegurados.
- Los estados vacíos eran demasiado genéricos y no orientaban la siguiente acción.
- Había poca consistencia entre botones, filtros, formularios, cards, modales y controles.
- Los formularios tenían agrupación básica, pero necesitaban una presentación más sobria y compacta.
- El sistema de colores tenía acentos demasiado llamativos para un CRM interno.

## Cambios realizados

- Se aplicó una capa visual global de CRM/SaaS interno: fondo gris claro, superficies blancas, bordes suaves, radios contenidos y sombras mínimas.
- Se rediseñaron login, shell, sidebar, header, dashboard, kanban, cards, modales, formularios, filtros, listas y estados.
- Se bajó el peso visual del dashboard y se eliminó la pantalla de bienvenida animada posterior al login.
- Se rehizo el dashboard completo como panel ejecutivo empresarial: KPIs, seguimiento de avisos, prioridad, agenda inmediata y accesos rápidos.
- Se corrigió el comportamiento de modales para que queden centrados en viewport y el scroll ocurra dentro del modal, sin modificar la altura de la página.
- Se corrigió el campo de localidad en alta de asegurados, que quedaba oculto por una regla global de combobox.
- Se agregaron estados reutilizables de loading y error.
- Se mejoraron estados vacíos con título y texto de ayuda.
- Se agregaron encabezados de lista para avisos, asegurados y pólizas.
- Se normalizaron botones primarios/secundarios, toggles, inputs, selects, focus y hover.
- Se mantuvieron rutas, endpoints, payloads, modelos y lógica de negocio.

## Componentes modificados

- `AppShell`
- `DashboardView`
- `NoticesView`
- `ClientsView`
- `PoliciesView`
- `CompaniesView`
- `SettingsView`
- `Modal`
- `LocalityCombobox`
- `EmptyState`
- Nuevos estados visuales: `LoadingState` y `ErrorState`

## Archivos tocados

- `components/app-shell.tsx`
- `app/globals.css`
- `UX_UI_REDESIGN_SUMMARY.md`

## Cómo probar

```bash
cd frontend
pnpm typecheck
pnpm lint
pnpm build
pnpm exec next start -p 3001
```

Abrir:

```text
http://localhost:3001
```

Notas de verificación: `typecheck`, `lint` y `build` pasan correctamente. También se verificó respuesta HTTP `200 OK` del build servido en `localhost:3001`.

## Mejoras futuras recomendadas

- Separar `components/app-shell.tsx` en módulos por vista para reducir el componente monolítico.
- Convertir listas operativas en componentes de tabla reutilizables con ordenamiento y columnas configurables.
- Agregar estados skeleton por entidad cuando el backend tarde más.
- Añadir edición/detalle de asegurado, póliza y compañía si el flujo operativo lo requiere.
- Incorporar tests de interacción para filtros, modales y acciones principales de avisos.
