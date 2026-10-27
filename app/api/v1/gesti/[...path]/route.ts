import { handleApiRequest } from "@/server/api";

// Gesti entra por su propia carpeta para poder tener un maxDuration más largo
// que el resto de la API (una respuesta con herramientas y búsqueda web tarda).
// Es la misma tabla de rutas: el ruteo real está en server/routes.ts. No se
// exporta DELETE a propósito: los chats no se borran.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PATCH = handleApiRequest;
