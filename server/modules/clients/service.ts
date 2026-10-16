import "server-only";
import { ConflictException, NotFoundException } from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import {
  clampPage,
  PAGE_SIZE_DEFAULT,
  pageRange,
  type Paginated
} from "@/server/core/pagination";
import { escapeLikePattern, isUuid, pgrstQuote } from "@/server/core/postgrest";
import {
  CLIENT_DUPLICATE_DNI,
  CLIENT_DUPLICATE_NAME,
  type CreateClientDto,
  type ListClientsQueryDto,
  type UpdateClientDto
} from "./schemas";

type ClientRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  locality: string | null;
  dni: string | null;
  address: string | null;
  birth_date: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

type ClientCursor = { full_name: string; id: string };

type ClientPageRow = ClientRow & { policies: Array<{ count: number }> };

const CLIENT_SELECT =
  "id,full_name,phone,email,locality,dni,address,birth_date,notes,is_active,created_at";

// Búsqueda multi-columna para .or() de PostgREST: el patrón va entre comillas
// (pgrstQuote) para que comas o paréntesis del término no rompan el filtro.
function clientSearchOrFilter(search: string) {
  const pattern = pgrstQuote(`%${escapeLikePattern(search)}%`);
  return ["full_name", "email", "phone", "dni"].map((column) => `${column}.ilike.${pattern}`).join(",");
}

export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async findAll(
    organizationId: string,
    options: ListClientsQueryDto = {}
  ): Promise<{ data: ClientRow[]; nextCursor: string | null }> {
    const { search, limit } = options;

    let query = this.supabase.admin
      .from("clients")
      .select(CLIENT_SELECT)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .order("id", { ascending: true });

    if (search) {
      query = query.ilike("full_name", `%${escapeLikePattern(search)}%`);
    }

    // Keyset pagination only kicks in when a limit is requested, otherwise the
    // legacy behaviour (full array, no cursor) is preserved exactly.
    if (limit) {
      const cursor = decodeClientCursor(options.cursor);
      if (cursor) {
        const name = pgrstQuote(cursor.full_name);
        query = query.or(
          `full_name.gt.${name},and(full_name.eq.${name},id.gt.${cursor.id})`
        );
      }
      query = query.limit(limit);
    }

    const { data, error } = await query.returns<ClientRow[]>();
    if (error) {
      throw supabaseError(this.logger, "clients.findAll", error, "No se pudieron obtener los clientes.");
    }

    const rows = data ?? [];
    const last = rows[rows.length - 1];
    const nextCursor =
      limit && last && rows.length === limit ? encodeClientCursor(last) : null;

    return { data: rows, nextCursor };
  }

  // Paginación numerada (PAGINADO.md): dos round-trips chicos y predecibles —
  // un head-count con los mismos filtros (permite acotar la página pedida a la
  // última real) y después la página con el conteo de pólizas activas embebido.
  async findPage(
    organizationId: string,
    options: ListClientsQueryDto
  ): Promise<Paginated<ClientPageRow>> {
    const pageSize = options.pageSize ?? PAGE_SIZE_DEFAULT;
    const search = options.search ?? null;
    const locality = options.locality ?? null;

    let countQuery = this.supabase.admin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    if (search) countQuery = countQuery.or(clientSearchOrFilter(search));
    if (locality) countQuery = countQuery.eq("locality", locality);

    const { count, error: countError } = await countQuery;
    if (countError) {
      throw supabaseError(this.logger, "clients.findPage.count", countError, "No se pudieron obtener los asegurados.");
    }

    const total = count ?? 0;
    const page = clampPage(options.page ?? 1, pageSize, total);
    const { from, to } = pageRange(page, pageSize);

    let query = this.supabase.admin
      .from("clients")
      .select(`${CLIENT_SELECT},policies(count)`)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      // Filtra el agregado embebido: solo cuenta pólizas activas.
      .eq("policies.is_active", true)
      .order("full_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (search) query = query.or(clientSearchOrFilter(search));
    if (locality) query = query.eq("locality", locality);

    const { data, error } = await query;
    if (error) {
      throw supabaseError(this.logger, "clients.findPage", error, "No se pudieron obtener los asegurados.");
    }

    return { items: (data ?? []) as unknown as ClientPageRow[], total, page, pageSize };
  }

  // Combobox (asignar asegurado a una tarea, etc.): devuelve lo mínimo para
  // elegir, nunca el padrón completo.
  async search(organizationId: string, term: string | null, limit: number) {
    let query = this.supabase.admin
      .from("clients")
      .select("id,full_name,phone,locality")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (term) query = query.or(clientSearchOrFilter(term));

    const { data, error } = await query;
    if (error) {
      throw supabaseError(this.logger, "clients.search", error, "No se pudieron buscar asegurados.");
    }

    return data ?? [];
  }

  // Opciones del filtro de localidad sin bajar el padrón: una sola columna.
  async localities(organizationId: string): Promise<string[]> {
    const { data, error } = await this.supabase.admin
      .from("clients")
      .select("locality")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .not("locality", "is", null);

    if (error) {
      throw supabaseError(this.logger, "clients.localities", error, "No se pudieron obtener las localidades.");
    }

    const unique = new Set<string>();
    for (const row of data ?? []) {
      if (row.locality) unique.add(row.locality);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, "es"));
  }

  async create(organizationId: string, dto: CreateClientDto) {
    await this.ensureNameIsDistinguishable(organizationId, dto.fullName, dto.dni ?? null);

    const { data, error } = await this.supabase.admin
      .from("clients")
      .insert({
        organization_id: organizationId,
        full_name: dto.fullName,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        locality: dto.locality ?? null,
        dni: dto.dni ?? null,
        address: dto.address ?? null,
        birth_date: dto.birthDate ?? null,
        notes: dto.notes ?? null
      })
      .select(CLIENT_SELECT)
      .single();

    if (error) {
      // uq_clients_dni_per_org: el DNI que se cargó para diferenciar ya es de
      // otro asegurado. Se explica cuál es el dato repetido en vez del genérico.
      if (error.code === "23505") {
        throw new ConflictException({
          statusCode: 409,
          code: CLIENT_DUPLICATE_DNI,
          message: "Ya hay un asegurado cargado con ese DNI. Revisá si no es la misma persona."
        });
      }
      throw supabaseError(this.logger, "clients.create", error, "No se pudo crear el cliente.");
    }

    return data;
  }

  // Dos asegurados con el mismo nombre y sin documento son indistinguibles en
  // el listado, en el combobox de las pólizas y en el tablero de avisos: no hay
  // forma de saber a cuál se le está cargando la póliza o el pago. Cuando el
  // nombre ya existe se exige el DNI, que es lo que los separa.
  //
  // Va en el backend y no en el formulario para que valga en todas las altas
  // (asegurados, alta desde una póliza, alta desde el análisis de un PDF).
  private async ensureNameIsDistinguishable(
    organizationId: string,
    fullName: string,
    dni: string | null
  ) {
    // Con DNI ya quedan diferenciados: el homónimo se permite.
    if (dni) {
      return;
    }

    // ilike sin comodines (los del texto se escapan) = igualdad exacta pero sin
    // distinguir mayúsculas: "juan perez" y "Juan Perez" son el mismo nombre.
    const { data, error } = await this.supabase.admin
      .from("clients")
      .select("id,full_name")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .ilike("full_name", escapeLikePattern(fullName))
      .limit(1)
      .returns<Array<{ id: string; full_name: string }>>();

    if (error) {
      throw supabaseError(this.logger, "clients.create", error, "No se pudo crear el cliente.");
    }

    const existing = data?.[0];
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        code: CLIENT_DUPLICATE_NAME,
        message: `Ya hay un asegurado llamado ${existing.full_name}. Cargá el DNI para diferenciarlos.`
      });
    }
  }

  async update(organizationId: string, clientId: string, dto: UpdateClientDto) {
    const patch: Record<string, unknown> = {};
    if (dto.fullName !== undefined) patch.full_name = dto.fullName;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.locality !== undefined) patch.locality = dto.locality;
    if (dto.dni !== undefined) patch.dni = dto.dni;
    if (dto.address !== undefined) patch.address = dto.address;
    if (dto.birthDate !== undefined) patch.birth_date = dto.birthDate;
    if (dto.notes !== undefined) patch.notes = dto.notes;

    const { data, error } = await this.supabase.admin
      .from("clients")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", clientId)
      .select(CLIENT_SELECT)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "clients.update", error, "No se pudo actualizar el cliente.");
    }
    if (!data) {
      throw new NotFoundException("Client not found");
    }

    return data;
  }

  async remove(organizationId: string, clientId: string) {
    const { data: client, error: clientError } = await this.supabase.admin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();

    if (clientError) {
      throw supabaseError(this.logger, "clients.remove", clientError, "No se pudo eliminar el asegurado.");
    }
    if (!client) {
      throw new NotFoundException("Client not found");
    }

    const { data: policies, error: policiesError } = await this.supabase.admin
      .from("policies")
      .select("id")
      .eq("client_id", clientId)
      .eq("organization_id", organizationId)
      .returns<{ id: string }[]>();

    if (policiesError) {
      throw supabaseError(this.logger, "clients.remove", policiesError, "No se pudo eliminar el asegurado.");
    }

    const policyIds = (policies ?? []).map((policy) => policy.id);

    if (policyIds.length > 0) {
      const { error: noticesError } = await this.supabase.admin
        .from("policy_notices")
        .update({ deleted_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .in("policy_id", policyIds);

      if (noticesError) {
        throw supabaseError(this.logger, "clients.remove", noticesError, "No se pudo eliminar el asegurado.");
      }

      const { error: policiesUpdateError } = await this.supabase.admin
        .from("policies")
        .update({ is_active: false })
        .eq("client_id", clientId)
        .eq("organization_id", organizationId);

      if (policiesUpdateError) {
        throw supabaseError(this.logger, "clients.remove", policiesUpdateError, "No se pudo eliminar el asegurado.");
      }
    }

    const { error: clientUpdateError } = await this.supabase.admin
      .from("clients")
      .update({ is_active: false })
      .eq("id", clientId)
      .eq("organization_id", organizationId);

    if (clientUpdateError) {
      throw supabaseError(this.logger, "clients.remove", clientUpdateError, "No se pudo eliminar el asegurado.");
    }

    return { ok: true };
  }
}

function encodeClientCursor(row: ClientCursor): string {
  return Buffer.from(JSON.stringify({ full_name: row.full_name, id: row.id })).toString("base64url");
}

function decodeClientCursor(cursor?: string | null): ClientCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ClientCursor>;
    if (typeof parsed.full_name === "string" && typeof parsed.id === "string" && isUuid(parsed.id)) {
      return { full_name: parsed.full_name, id: parsed.id };
    }
  } catch {
    // Ignore malformed cursors and fall back to the first page.
  }
  return null;
}
