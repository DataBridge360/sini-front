# Sinipro

Sinipro2 en una sola app de Next.js: la interfaz (TanStack Query) y la API
(`app/api/v1`, que reemplaza al backend NestJS separado) se despliegan juntas.

## Requisitos

- Node.js 24+
- pnpm 10+

## Configuracion

```bash
cp .env.example .env.local
```

Variables:

```env
NEXT_PUBLIC_BASE_DOMAIN=localhost

# API: SOLO de servidor (sin NEXT_PUBLIC_). Nunca llegan al navegador.
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BASE_DOMAIN=sinipro.com

# Tiempo real (opcional): sin esto la app funciona, pero sin actualización en vivo.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

`NEXT_PUBLIC_API_URL` ya no se usa: el navegador llama siempre a `/api/v1` en el
mismo origen.

Las dos variables `NEXT_PUBLIC_SUPABASE_*` se usan únicamente para abrir por
WebSocket el canal privado `org:<id>`, que avisa qué cambió para que las tareas y
los avisos se actualicen solos. Por ese canal no viaja ningún dato de negocio.

## API

Toda la API entra por `app/api/v1/[...path]/route.ts` y se rutea con la tabla de
`server/routes.ts`. Cada ruta declara su nivel de acceso:

| Acceso | Qué exige |
|---|---|
| `public` | Nada (login, refresh y branding por slug). |
| `user` | Bearer token válido y perfil activo. |
| `organization` | Lo anterior más una membresía activa (o admin de plataforma) en una organización activa, resuelta por subdominio o `X-Organization-Slug`. |

- Cada módulo vive en `server/modules/<modulo>/{schemas,service,routes}.ts`.
- La validación es con Zod. Los errores devuelven el mismo cuerpo que devolvía Nest: `message`, `error`, `statusCode` y `code` cuando aplica.
- Límites de body: 256 KB por defecto y 1 MB en `/profile`. El logo va en multipart, hasta 2 MB.
- Rate limit en memoria por instancia: 300/min por ruta e IP, login 10/min, refresh 30/min. En Vercel cada instancia cuenta por separado. Para un límite global, agregar una regla del Firewall de Vercel sobre `/api/v1/auth/*`.
- Las respuestas de `/api/v1` llevan los headers de seguridad que antes ponía Helmet (ver `next.config.ts`).

### Adjuntos de tareas

Vercel corta los bodies en 4.5 MB, así que los archivos no pasan por la API:

1. `POST /api/v1/tasks/:id/attachments/uploads` con `{ files: [{ name, type, size }] }`. El server valida cantidad (máx. 10), tamaño (máx. 5 MB) y formato, y devuelve una URL firmada de subida por archivo, dentro de la carpeta de la organización y la tarea.
2. El navegador sube cada archivo directo a Supabase Storage (`PUT` a la URL firmada).
3. `POST /api/v1/tasks/:id/messages` con `{ message, attachments: [{ path, name }] }`. Antes de guardar, el server verifica cada objeto en Storage: que sea de la tarea, que exista, su tamaño y su formato. Si algo falla, borra los objetos y no se guarda nada.

Los archivos se suben recién cuando la persona envía la actividad, y las imágenes
viajan comprimidas (WEBP, máx. 1920 px, ver `lib/media.ts`). No quedan huérfanos:

- Si falla una subida o la confirmación, el navegador llama a
  `POST /api/v1/tasks/:id/attachments/discard` con los paths. El server borra solo
  los de esa tarea que ninguna actividad vincula.
- Si se cierra la pestaña en el medio, el Cron de Vercel (`vercel.json`, todos los
  días 07:00 UTC) llama a `/api/cron/task-attachments-cleanup`. Ahí se borran los
  objetos del bucket sin fila en `task_attachments` que tengan más de 3 horas (la
  URL firmada de subida dura 2). Si no puede consultar la base, no borra nada.

## Desarrollo

```bash
pnpm install
pnpm dev
```

La app queda disponible en:

```text
http://localhost:3001
```

## Scripts

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

## Deploy (Vercel)

1. Cargar en el proyecto de Vercel `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BASE_DOMAIN` y `CRON_SECRET` (un valor aleatorio largo), sin prefijo `NEXT_PUBLIC_`. Sin `CRON_SECRET`, el barrido de huérfanos responde 503 y no corre.
2. Borrar `NEXT_PUBLIC_API_URL`, que ya no se usa.
3. Verificar login, tareas con adjuntos y el logo de la organización en el preview.
4. Recién después dar de baja el servicio `sinipro-backend` de Cloud Run.

## Seguridad

- No subir `.env` ni `.env.local`.
- No subir `.next/`, `node_modules/`, caches ni reportes locales.
- Todo lo que está bajo `server/` importa `server-only`: si algo de ahí termina importado desde un componente de cliente, el build falla.
- El acceso operativo se resuelve por organización y rol en cada request de `/api/v1`.
