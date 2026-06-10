# Sinipro Frontend

Frontend de Sinipro2 construido con Next.js y TanStack Query.

## Requisitos

- Node.js 24+
- pnpm 10+
- Backend corriendo en `http://localhost:4000`

## Configuracion

```bash
cp .env.example .env.local
```

Variables:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_BASE_DOMAIN=localhost
```

No se usan claves de Supabase en el frontend. La app consume solamente la API del backend.

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
pnpm build
pnpm start
```

## Seguridad

- No subir `.env` ni `.env.local`.
- No subir `.next/`, `node_modules/`, caches ni reportes locales.
- Los tokens de sesion se reciben desde el backend despues del login.
- El acceso operativo se resuelve por organizacion y rol devuelto por la API.
