import {
  clubplazaFetch,
  proxyErrorResponse,
  requireSiniproSession
} from "../../_lib/server";

type BuscarPorDniItem = {
  id: string;
  nombre: string;
  apellido: string;
  dni: string;
  pagado: boolean;
};

type JugadorDetalle = {
  id: string;
  nombre: string;
  apellido: string;
  dni: string;
  nombre_completo: string;
  fecha_nacimiento: string | null;
  pagado: boolean;
};

// Autocompletado del alta de la planilla: busca el jugador por DNI exacto en
// Club Plaza y devuelve nombre + fecha de nacimiento. La búsqueda de Club
// Plaza no incluye fecha de nacimiento, así que ante un match se pide el
// detalle del jugador en un segundo paso (ambos con el token del productor).
export async function GET(request: Request) {
  try {
    await requireSiniproSession(request);

    const dni = new URL(request.url).searchParams.get("dni")?.trim() ?? "";
    if (!/^\d{3,10}$/.test(dni)) {
      return Response.json({ message: "DNI inválido (mínimo 3 dígitos)" }, { status: 400 });
    }

    const searchRes = await clubplazaFetch(`/jugadores/buscar-por-dni/${dni}`, () => ({
      method: "GET"
    }));
    if (!searchRes.ok) {
      const payload = (await searchRes.json().catch(() => null)) as { message?: string } | null;
      return Response.json(
        { message: payload?.message ?? "No se pudo buscar el jugador en Club Plaza" },
        { status: searchRes.status }
      );
    }

    const search = (await searchRes.json()) as { data?: BuscarPorDniItem[] };
    const match = (search.data ?? []).find((item) => item.dni === dni);
    if (!match) {
      return Response.json({ found: false });
    }

    const detalleRes = await clubplazaFetch(`/jugadores/${match.id}`, () => ({ method: "GET" }));
    if (!detalleRes.ok) {
      // El detalle es solo para la fecha de nacimiento: si falla, se devuelve
      // igual el match de la búsqueda.
      return Response.json({
        found: true,
        nombre: match.nombre,
        apellido: match.apellido,
        nombre_completo: `${match.nombre} ${match.apellido}`.trim(),
        fecha_nacimiento: null,
        pagado: match.pagado
      });
    }

    const detalle = (await detalleRes.json()) as { data?: JugadorDetalle };
    const jugador = detalle.data;

    return Response.json({
      found: true,
      nombre: jugador?.nombre ?? match.nombre,
      apellido: jugador?.apellido ?? match.apellido,
      nombre_completo:
        jugador?.nombre_completo ?? `${match.nombre} ${match.apellido}`.trim(),
      fecha_nacimiento: jugador?.fecha_nacimiento?.slice(0, 10) ?? null,
      pagado: jugador?.pagado ?? match.pagado
    });
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
