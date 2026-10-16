import { handleApiRequest } from "@/server/api";

// Toda la API (ex backend Nest) entra por acá; el ruteo real está en
// server/routes.ts. Node runtime: supabase-js y los uploads necesitan Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
