import "server-only";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import {
  clampPage,
  PAGE_SIZE_DEFAULT,
  pageRange,
  type Paginated
} from "@/server/core/pagination";
import { escapeLikePattern, pgrstQuote } from "@/server/core/postgrest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import type {
  ApplyCorrectionsDto,
  BulkCreateRegistrationsDto,
  CreateRegistrationDto,
  ListPayersQueryDto,
  ListRegistrationsQueryDto,
  UpdateRegistrationDto
} from "./schemas";

// Planilla de pagos de jugadores de Club Plaza. Los datos del jugador son un
// snapshot del sistema remoto (siempre vienen de Club Plaza por DNI);
// "pagador" es la persona que pagó esos seguros (texto libre).
export type RegistrationRow = {
  id: string;
  registered_on: string;
  player_full_name: string;
  player_dni: string;
  player_birth_date: string | null;
  payer_name: string | null;
  payment_method: "efectivo" | "debito" | "mp" | null;
  attended_by_user_id: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  attended_by: { id: string; full_name: string } | null;
};

// Hay dos FKs a user_profiles (atendido y creador): el embed necesita el
// nombre del constraint para desambiguar.
const REGISTRATION_SELECT =
  "id,registered_on,player_full_name,player_dni,player_birth_date," +
  "payer_name,payment_method," +
  "attended_by_user_id,created_by_user_id,created_at,updated_at," +
  "attended_by:user_profiles!club_plaza_registrations_attended_by_user_id_fkey(id,full_name)";

// Sugerencias de pagador: PostgREST no expone DISTINCT, así que se escanean
// las filas más recientes y se deduplica en memoria. Alcanza para alimentar un
// autocompletado sin agregar una función SQL dedicada.
const PAYER_SCAN_LIMIT = 1000;
const PAYER_SUGGESTION_LIMIT = 50;

function registrationSearchOrFilter(search: string) {
  const pattern = pgrstQuote(`%${escapeLikePattern(search)}%`);
  return ["player_full_name", "player_dni"].map((column) => `${column}.ilike.${pattern}`).join(",");
}

export class ClubPlazaRegistrationsService {
  private readonly logger = new Logger(ClubPlazaRegistrationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async findPage(
    organizationId: string,
    options: ListRegistrationsQueryDto
  ): Promise<Paginated<RegistrationRow>> {
    const pageSize = options.pageSize ?? PAGE_SIZE_DEFAULT;

    let countQuery = this.supabase.admin
      .from("club_plaza_registrations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    countQuery = this.applyFilters(countQuery, options);

    const { count, error: countError } = await countQuery;
    if (countError) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.findPage.count",
        countError,
        "No se pudieron obtener los registros."
      );
    }

    const total = count ?? 0;
    const page = clampPage(options.page ?? 1, pageSize, total);
    const { from, to } = pageRange(page, pageSize);

    let query = this.supabase.admin
      .from("club_plaza_registrations")
      .select(REGISTRATION_SELECT)
      .eq("organization_id", organizationId)
      .order("registered_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    query = this.applyFilters(query, options);

    const { data, error } = await query;
    if (error) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.findPage",
        error,
        "No se pudieron obtener los registros."
      );
    }

    return { items: (data ?? []) as unknown as RegistrationRow[], total, page, pageSize };
  }

  // Pagadores ya usados en la organización, más recientes primero. El front lo
  // pide una sola vez y filtra en memoria mientras se tipea, así el
  // autocompletado de la planilla no dispara una request por fila.
  async findPayers(organizationId: string, options: ListPayersQueryDto): Promise<string[]> {
    let query = this.supabase.admin
      .from("club_plaza_registrations")
      .select("payer_name,created_at")
      .eq("organization_id", organizationId)
      .not("payer_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(PAYER_SCAN_LIMIT);

    if (options.search) {
      query = query.ilike("payer_name", `%${escapeLikePattern(options.search)}%`);
    }

    const { data, error } = await query;
    if (error) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.findPayers",
        error,
        "No se pudieron obtener los pagadores."
      );
    }

    const seen = new Set<string>();
    const payers: string[] = [];
    for (const row of data ?? []) {
      const name = (row.payer_name ?? "").trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase("es");
      if (seen.has(key)) continue;
      seen.add(key);
      payers.push(name);
      if (payers.length >= PAYER_SUGGESTION_LIMIT) break;
    }

    return payers;
  }

  // Los filtros se comparten entre el head-count y la página (mismo criterio).
  private applyFilters<T extends { or: any; eq: any; not: any; gte: any; lte: any; ilike: any }>(
    query: T,
    options: ListRegistrationsQueryDto
  ): T {
    let result = query;
    if (options.search) {
      result = result.or(registrationSearchOrFilter(options.search));
    }
    if (options.dni) {
      result = result.ilike("player_dni", `${escapeLikePattern(options.dni)}%`);
    }
    if (options.pagador) {
      result = result.ilike("payer_name", `%${escapeLikePattern(options.pagador)}%`);
    }
    if (options.paymentMethod) {
      result = result.eq("payment_method", options.paymentMethod);
    }
    if (options.attendedBy) {
      result = result.eq("attended_by_user_id", options.attendedBy);
    }
    if (options.birthDate) {
      result = result.eq("player_birth_date", options.birthDate);
    }
    if (options.dateFrom) {
      result = result.gte("registered_on", options.dateFrom);
    }
    if (options.dateTo) {
      result = result.lte("registered_on", options.dateTo);
    }
    // Pendiente = le falta pagador, pago o atendido (las filas que crea la
    // carga masiva entran así y se completan después).
    if (options.status === "pendiente") {
      result = result.or("payment_method.is.null,attended_by_user_id.is.null,payer_name.is.null");
    }
    if (options.status === "completo") {
      result = result
        .not("payment_method", "is", null)
        .not("attended_by_user_id", "is", null)
        .not("payer_name", "is", null);
    }
    return result;
  }

  async create(organization: OrganizationContext, user: AuthUser, dto: CreateRegistrationDto) {
    if (dto.attendedByUserId) {
      await this.ensureMemberInOrganization(organization.id, dto.attendedByUserId);
    }

    const { data, error } = await this.supabase.admin
      .from("club_plaza_registrations")
      .insert({
        organization_id: organization.id,
        registered_on: dto.registeredOn,
        player_full_name: dto.playerFullName,
        player_dni: dto.playerDni,
        player_birth_date: dto.playerBirthDate ?? null,
        payer_name: dto.payerName ?? null,
        payment_method: dto.paymentMethod ?? null,
        attended_by_user_id: dto.attendedByUserId ?? null,
        created_by_user_id: user.id
      })
      .select(REGISTRATION_SELECT)
      .single();

    if (error) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.create",
        error,
        "No se pudo crear el registro."
      );
    }

    return data;
  }

  // Alta masiva post-wizard: inserta cada jugador nuevo como fila pendiente.
  // Si el jugador ya tiene una fila pendiente con el mismo DNI se omite, para
  // que repetir una carga masiva no duplique la planilla.
  async bulkCreate(organization: OrganizationContext, user: AuthUser, dto: BulkCreateRegistrationsDto) {
    const dnis = dto.players.map((player) => player.dni);

    const { data: existing, error: existingError } = await this.supabase.admin
      .from("club_plaza_registrations")
      .select("player_dni")
      .eq("organization_id", organization.id)
      .is("payment_method", null)
      .in("player_dni", dnis);

    if (existingError) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.bulkCreate.existing",
        existingError,
        "No se pudieron crear los registros."
      );
    }

    const pendingDnis = new Set((existing ?? []).map((row) => row.player_dni));
    const toInsert = dto.players.filter((player) => !pendingDnis.has(player.dni));

    if (toInsert.length === 0) {
      return { inserted: 0, skipped: dto.players.length };
    }

    const registeredOn = dto.registeredOn ?? new Date().toISOString().slice(0, 10);
    const { error } = await this.supabase.admin.from("club_plaza_registrations").insert(
      toInsert.map((player) => ({
        organization_id: organization.id,
        registered_on: registeredOn,
        player_full_name: player.fullName,
        player_dni: player.dni,
        player_birth_date: player.birthDate ?? null,
        created_by_user_id: user.id
      }))
    );

    if (error) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.bulkCreate",
        error,
        "No se pudieron crear los registros."
      );
    }

    return { inserted: toInsert.length, skipped: dto.players.length - toInsert.length };
  }

  async update(organization: OrganizationContext, registrationId: string, dto: UpdateRegistrationDto) {
    if (dto.attendedByUserId) {
      await this.ensureMemberInOrganization(organization.id, dto.attendedByUserId);
    }

    // Los datos del jugador (nombre/DNI/fecha nac.) no se editan acá: solo se
    // corrigen vía applyCorrections cuando la carga masiva los corrige.
    const patch: Record<string, unknown> = {};
    if (dto.registeredOn !== undefined) patch.registered_on = dto.registeredOn;
    if (dto.payerName !== undefined) patch.payer_name = dto.payerName;
    if (dto.paymentMethod !== undefined) patch.payment_method = dto.paymentMethod;
    if (dto.attendedByUserId !== undefined) patch.attended_by_user_id = dto.attendedByUserId;

    const { data, error } = await this.supabase.admin
      .from("club_plaza_registrations")
      .update(patch)
      .eq("organization_id", organization.id)
      .eq("id", registrationId)
      .select(REGISTRATION_SELECT)
      .maybeSingle();

    if (error) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.update",
        error,
        "No se pudo actualizar el registro."
      );
    }
    if (!data) {
      throw new NotFoundException("Registration not found");
    }

    return data;
  }

  // Replica en la planilla las correcciones que la carga masiva aplicó en
  // Club Plaza (nombre, DNI o fecha de nacimiento corregidos): actualiza
  // todas las filas de la organización que tengan ese DNI.
  async applyCorrections(organizationId: string, dto: ApplyCorrectionsDto) {
    let updated = 0;

    for (const correction of dto.corrections) {
      const patch: Record<string, unknown> = {};
      if (correction.fullName !== undefined) patch.player_full_name = correction.fullName;
      if (correction.birthDate !== undefined) patch.player_birth_date = correction.birthDate;
      if (correction.newDni !== undefined) patch.player_dni = correction.newDni;
      if (Object.keys(patch).length === 0) continue;

      const { data, error } = await this.supabase.admin
        .from("club_plaza_registrations")
        .update(patch)
        .eq("organization_id", organizationId)
        .eq("player_dni", correction.dni)
        .select("id");

      if (error) {
        throw supabaseError(
          this.logger,
          "clubPlazaRegistrations.applyCorrections",
          error,
          "No se pudieron aplicar las correcciones."
        );
      }
      updated += (data ?? []).length;
    }

    return { updated };
  }

  // Igual que tasks: borra quien creó la fila o un productor.
  async remove(organization: OrganizationContext, user: AuthUser, registrationId: string) {
    const { data: registration, error: findError } = await this.supabase.admin
      .from("club_plaza_registrations")
      .select("id,created_by_user_id")
      .eq("organization_id", organization.id)
      .eq("id", registrationId)
      .maybeSingle();

    if (findError) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.remove",
        findError,
        "No se pudo eliminar el registro."
      );
    }
    if (!registration) {
      throw new NotFoundException("Registration not found");
    }
    if (registration.created_by_user_id !== user.id && !this.canModerate(organization)) {
      throw new ForbiddenException("Solo quien creó el registro o un productor puede eliminarlo.");
    }

    const { error } = await this.supabase.admin
      .from("club_plaza_registrations")
      .delete()
      .eq("organization_id", organization.id)
      .eq("id", registrationId);

    if (error) {
      throw supabaseError(
        this.logger,
        "clubPlazaRegistrations.remove",
        error,
        "No se pudo eliminar el registro."
      );
    }

    return { ok: true };
  }

  private canModerate(organization: OrganizationContext) {
    return organization.role === "productor" || organization.role === "platform_admin";
  }

  private async ensureMemberInOrganization(organizationId: string, userId: string) {
    const { data, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "clubPlazaRegistrations.ensureMemberInOrganization", error);
    }
    if (!data) {
      throw new BadRequestException("El usuario seleccionado no pertenece a la organización.");
    }
  }
}
