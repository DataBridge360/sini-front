import {
  clubplazaFetch,
  passthrough,
  proxyErrorResponse,
  requireSiniproSession
} from "../../_lib/server";

// Proxy del preview de carga masiva: recibe el Excel del navegador y lo
// reenvía a Club Plaza con el token del productor (server-side).
export async function POST(request: Request) {
  try {
    await requireSiniproSession(request);

    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof File)) {
      return Response.json({ message: "Falta el archivo (campo 'file')" }, { status: 400 });
    }

    const upstream = new FormData();
    upstream.set("file", file, file.name);

    const response = await clubplazaFetch("/bulk-import/preview", () => ({
      method: "POST",
      // Sin Content-Type manual: fetch arma el boundary del multipart.
      body: upstream
    }));

    return passthrough(response);
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
