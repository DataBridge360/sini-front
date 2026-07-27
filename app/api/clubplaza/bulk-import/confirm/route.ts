import {
  clubplazaFetch,
  getClubplazaClubId,
  passthrough,
  proxyErrorResponse,
  requireSiniproSession
} from "../../_lib/server";

// Proxy del confirm de carga masiva. Inyecta productor_id (de la sesión
// cacheada de Club Plaza) y club_id (del .env): el navegador nunca los maneja.
// Solo se reenvían los campos del DTO de Club Plaza — su ValidationPipe usa
// forbidNonWhitelisted y rechaza cualquier campo extra.
export async function POST(request: Request) {
  try {
    await requireSiniproSession(request);

    const body = (await request.json().catch(() => null)) as {
      preview_token?: string;
      overwrite_existing?: boolean;
      accepted_conflict_ids?: unknown;
      test_mode?: boolean;
    } | null;

    if (!body?.preview_token || typeof body.preview_token !== "string") {
      return Response.json({ message: "Falta preview_token" }, { status: 400 });
    }

    const acceptedConflictIds = Array.isArray(body.accepted_conflict_ids)
      ? body.accepted_conflict_ids.filter((id): id is string => typeof id === "string")
      : [];

    const clubId = getClubplazaClubId();

    const response = await clubplazaFetch("/bulk-import/confirm", (session) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preview_token: body.preview_token,
        productor_id: session.productorId,
        club_id: clubId,
        overwrite_existing: Boolean(body.overwrite_existing),
        accepted_conflict_ids: acceptedConflictIds,
        test_mode: Boolean(body.test_mode)
      })
    }));

    return passthrough(response);
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
