"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Clock,
  Eye,
  EyeOff,
  Edit3,
  FileText,
  Hash,
  LayoutDashboard,
  LayoutGrid,
  List,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Palette,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  UploadCloud,
  User,
  Users,
  Trash2,
  X
} from "lucide-react";
import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  apiRequest,
  apiUpload,
  authStorage,
  AUTH_CHANGED_EVENT,
  intervalLabel,
  type AuthState,
  type ChangeOrganizationTeamMemberPasswordPayload,
  type Client,
  type CreateOrganizationTeamMemberPayload,
  type DeactivateOrganizationTeamMemberPayload,
  type InsuranceCompany,
  type Notice,
  type NoticeNote,
  type OrganizationSettings,
  type OrganizationTeamMember,
  type Policy,
  type PublicOrganization,
  type UpdateOrganizationTeamMemberPayload,
  type UserProfile
} from "@/lib/api";
import { Card, Table } from "@/components/ui-system";

type Tab = "dashboard" | "notices" | "clients" | "policies" | "companies" | "team" | "settings" | "profile";
type NoticeStatus = Notice["status"];
type NoticeView = "kanban" | "list";

type NoticeNoteApi = {
  currentUserId: string;
  busyNoticeId: string | null;
  deletingNoteId: string | null;
  onAdd: (noticeId: string, note: string) => Promise<void>;
  onDelete: (noticeId: string, noteId: string) => Promise<void>;
};

type PolicyFormValues = {
  clientId: string;
  insuranceCompanyId: string;
  branch: string;
  policyNumber: string;
  vehiclePlate: string;
  paymentIntervalMonths: number;
  firstPaymentDate: string;
};

type PolicyActions = {
  clients: Client[];
  companies: InsuranceCompany[];
  isSaving: boolean;
  isDeleting: boolean;
  onUpdate: (policyId: string, values: PolicyFormValues) => Promise<unknown>;
  onDelete: (policyId: string) => Promise<unknown>;
};
type EntityView = "grid" | "list";

type NoticeFilters = {
  search: string;
  companyId: string;
  branch: string;
  status: "all" | NoticeStatus;
  dateFrom: string;
  dateTo: string;
};

type UpdateOrganizationPayload = {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
};

type UploadLogoPayload = {
  file: File;
  kind: "main" | "login";
};

type UploadLogoResponse = {
  url: string;
  organization?: OrganizationSettings;
};

type ToastMessage = {
  id: string;
  tone: "success" | "error";
  message: string;
};

const EMPTY_NOTICE_FILTERS: NoticeFilters = {
  search: "",
  companyId: "all",
  branch: "all",
  status: "all",
  dateFrom: "",
  dateTo: ""
};

const BRANCHES = [
  "Automotores",
  "Motovehiculos",
  "Responsabilidad civil",
  "Hogar",
  "Comercio",
  "Vida",
  "Accidentes Personales",
  "Otro"
];

// Mientras no usemos subdominios, la organización queda fijada a este slug.
// Para activar la resolución por subdominio más adelante, poné FORCED_ORG_SLUG = null.
const FORCED_ORG_SLUG: string | null = "lucassegura";

const NOTICE_WINDOW_DAYS = 15;

// El tablero muestra un aviso recién 15 días antes de su vencimiento (o si ya venció).
// Un aviso pagado se "borra" del tablero una vez que pasaron 15 días de su vencimiento;
// para entonces ya apareció el siguiente aviso generado al pagar.
function isNoticeInWindow(notice: Notice) {
  const days = getDaysUntilDue(notice.due_date);
  if (days > NOTICE_WINDOW_DAYS) return false;
  if (notice.status === "pagado" && days < -NOTICE_WINDOW_DAYS) return false;
  return true;
}

const AVATAR_COLORS = [
  "#1d4ed8",
  "#b91c1c",
  "#0369a1",
  "#3730a3",
  "#047857",
  "#7c3aed",
  "#c2410c",
  "#0f766e",
  "#9333ea",
  "#be185d"
];

const NOTICE_COLUMNS = [
  { key: "avisar" as const, label: "Avisar", dot: "#f59e0b", icon: AlertTriangle },
  { key: "avisado" as const, label: "Avisados", dot: "#4d8eff", icon: Clock },
  { key: "pagado" as const, label: "Pagados", dot: "#4ae176", icon: CheckCircle }
];

const SPANISH_MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre"
];

const SPANISH_WEEK_DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const LOGO_MAX_SIZE_BYTES = 5_000_000;

export function AppShell() {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [slug, setSlug] = useState("");
  const [hostSlug, setHostSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [clientDetailId, setClientDetailId] = useState<string | null>(null);
  const [openPolicyId, setOpenPolicyId] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: ToastMessage["tone"] = "success") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => dismissToast(id), 4200);
  }, [dismissToast]);

  useEffect(() => {
    queueMicrotask(() => {
      const nextHostSlug = resolveLoginSlug(window.location.hostname, window.location.search);
      setHostSlug(nextHostSlug);
      const stored = authStorage.read();
      if (stored) {
        setAuth(stored);
        const organizationFromHost = stored.organizations.find(
          (organization) => organization.slug === nextHostSlug
        );
        setSlug(FORCED_ORG_SLUG ?? organizationFromHost?.slug ?? stored.organizations[0]?.slug ?? nextHostSlug ?? "");
      } else {
        setSlug(FORCED_ORG_SLUG ?? nextHostSlug ?? "");
      }
    });

    const handleAuthChange = (event: Event) => {
      const nextAuth = (event as CustomEvent<AuthState | null>).detail;
      setAuth(nextAuth);
    };

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChange);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChange);
  }, []);

  const selectedOrganization = useMemo(
    () => auth?.organizations.find((organization) => organization.slug === slug),
    [auth, slug]
  );

  const common = {
    token: auth?.accessToken,
    organizationSlug: slug
  };

  const publicOrganization = useQuery({
    queryKey: ["public-organization", slug],
    enabled: Boolean(!auth && slug),
    queryFn: () => apiRequest<PublicOrganization>(`/organizations/slug/${slug}`)
  });

  const clients = useQuery({
    queryKey: ["clients", slug],
    enabled: Boolean(auth && slug),
    queryFn: () => apiRequest<Client[]>("/clients", common)
  });

  const companies = useQuery({
    queryKey: ["insurance-companies", slug],
    enabled: Boolean(auth && slug),
    queryFn: () => apiRequest<InsuranceCompany[]>("/insurance-companies", common)
  });

  const policies = useQuery({
    queryKey: ["policies", slug],
    enabled: Boolean(auth && slug),
    queryFn: () => apiRequest<Policy[]>("/policies", common)
  });

  const notices = useQuery({
    queryKey: ["notices", slug],
    enabled: Boolean(auth && slug),
    queryFn: () => apiRequest<Notice[]>("/notices", common)
  });

  const canManageOrganization = Boolean(
    auth && (selectedOrganization?.role === "productor" || auth.user.platformRole === "platform_admin")
  );

  const organizationSettings = useQuery({
    queryKey: ["organization-settings", slug],
    enabled: Boolean(auth && slug && canManageOrganization),
    queryFn: () => apiRequest<OrganizationSettings>("/organizations/current", common)
  });

  const organizationTeam = useQuery({
    queryKey: ["organization-team", slug],
    enabled: Boolean(auth && slug && canManageOrganization && tab === "team"),
    retry: false,
    queryFn: () => apiRequest<OrganizationTeamMember[]>("/organizations/current/team", common)
  });

  const login = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      apiRequest<AuthState>("/auth/login", { method: "POST", body: payload }),
    onSuccess: (data) => {
      // authStorage.write despacha AUTH_CHANGED_EVENT, que es la única vía que
      // actualiza `auth` (ver listener en el useEffect inicial). Evita doble setAuth.
      authStorage.write(data);
      const organizationFromHost = data.organizations.find(
        (organization) => organization.slug === hostSlug
      );
      setSlug(FORCED_ORG_SLUG ?? organizationFromHost?.slug ?? data.organizations[0]?.slug ?? hostSlug ?? "");
      setLoginError(null);
    },
    onError: (error) => setLoginError(error.message)
  });

  const createClient = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      apiRequest<Client>("/clients", { ...common, method: "POST", body }),
    onSuccess: () => {
      notify("Asegurado creado.");
      return queryClient.invalidateQueries({ queryKey: ["clients", slug] });
    }
  });

  const createCompany = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      apiRequest<InsuranceCompany>("/insurance-companies", { ...common, method: "POST", body }),
    onSuccess: () => {
      notify("Compañía creada.");
      return queryClient.invalidateQueries({ queryKey: ["insurance-companies", slug] });
    }
  });

  const createPolicy = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue | number>) =>
      apiRequest<Policy>("/policies", { ...common, method: "POST", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["policies", slug] });
      await queryClient.invalidateQueries({ queryKey: ["notices", slug] });
      notify("Póliza creada.");
      setTab("notices");
    }
  });

  const updatePolicy = useMutation({
    mutationFn: ({ policyId, values }: { policyId: string; values: PolicyFormValues }) =>
      apiRequest<Policy>(`/policies/${policyId}`, { ...common, method: "PATCH", body: values }),
    onSuccess: async () => {
      notify("Póliza actualizada.");
      await queryClient.invalidateQueries({ queryKey: ["policies", slug] });
      await queryClient.invalidateQueries({ queryKey: ["notices", slug] });
      void queryClient.invalidateQueries({ queryKey: ["policy-notices"] });
    }
  });

  const deletePolicy = useMutation({
    mutationFn: (policyId: string) =>
      apiRequest<{ ok: boolean }>(`/policies/${policyId}`, { ...common, method: "DELETE" }),
    onSuccess: async () => {
      notify("Póliza eliminada.");
      await queryClient.invalidateQueries({ queryKey: ["policies", slug] });
      await queryClient.invalidateQueries({ queryKey: ["notices", slug] });
      void queryClient.invalidateQueries({ queryKey: ["policy-notices"] });
    }
  });

  const markNotified = useMutation({
    mutationFn: (noticeId: string) =>
      apiRequest<Notice>(`/notices/${noticeId}/notified`, {
        ...common,
        method: "PATCH",
        body: {}
      }),
    onSuccess: (_data, noticeId) => {
      notify("Aviso marcado como avisado.");
      // El RPC devuelve la fila sin los joins (cliente/compañía); parcheamos solo
      // el estado en caché para no perder los datos anidados ni refetchear todo.
      queryClient.setQueryData<Notice[]>(["notices", slug], (prev) =>
        prev ? prev.map((notice) => (notice.id === noticeId ? { ...notice, status: "avisado" } : notice)) : prev
      );
    }
  });

  const payNotice = useMutation({
    mutationFn: ({ noticeId, months }: { noticeId: string; months: number }) =>
      apiRequest(`/notices/${noticeId}/pay`, {
        ...common,
        method: "PATCH",
        body: { paymentIntervalMonths: months }
      }),
    onSuccess: () => {
      notify("Pago registrado.");
      void queryClient.invalidateQueries({ queryKey: ["policy-notices"] });
      return queryClient.invalidateQueries({ queryKey: ["notices", slug] });
    }
  });

  const revertNotice = useMutation({
    mutationFn: (noticeId: string) =>
      apiRequest<Notice>(`/notices/${noticeId}/revert`, { ...common, method: "PATCH", body: {} }),
    onSuccess: () => {
      notify("Estado del aviso revertido.");
      void queryClient.invalidateQueries({ queryKey: ["policy-notices"] });
      return queryClient.invalidateQueries({ queryKey: ["notices", slug] });
    }
  });

  const addNoticeNote = useMutation({
    mutationFn: ({ noticeId, note }: { noticeId: string; note: string }) =>
      apiRequest<NoticeNote>(`/notices/${noticeId}/notes`, { ...common, method: "POST", body: { note } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["policy-notices"] });
      return queryClient.invalidateQueries({ queryKey: ["notices", slug] });
    }
  });

  const deleteNoticeNote = useMutation({
    mutationFn: ({ noticeId, noteId }: { noticeId: string; noteId: string }) =>
      apiRequest<{ ok: boolean }>(`/notices/${noticeId}/notes/${noteId}`, { ...common, method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["policy-notices"] });
      return queryClient.invalidateQueries({ queryKey: ["notices", slug] });
    }
  });

  const updateClient = useMutation({
    mutationFn: ({ clientId, patch }: { clientId: string; patch: Record<string, unknown> }) =>
      apiRequest<Client>(`/clients/${clientId}`, { ...common, method: "PATCH", body: patch }),
    onSuccess: () => {
      notify("Asegurado actualizado.");
      return queryClient.invalidateQueries({ queryKey: ["clients", slug] });
    }
  });

  const deleteClient = useMutation({
    mutationFn: (clientId: string) =>
      apiRequest<{ ok: boolean }>(`/clients/${clientId}`, { ...common, method: "DELETE" }),
    onSuccess: async () => {
      notify("Asegurado eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["clients", slug] });
      await queryClient.invalidateQueries({ queryKey: ["policies", slug] });
      await queryClient.invalidateQueries({ queryKey: ["notices", slug] });
      void queryClient.invalidateQueries({ queryKey: ["policy-notices"] });
    }
  });

  const noticeNoteApi: NoticeNoteApi = {
    currentUserId: auth?.user.id ?? "",
    busyNoticeId: addNoticeNote.isPending ? addNoticeNote.variables?.noticeId ?? null : null,
    deletingNoteId: deleteNoticeNote.isPending ? deleteNoticeNote.variables?.noteId ?? null : null,
    onAdd: (noticeId, note) => addNoticeNote.mutateAsync({ noticeId, note }).then(() => undefined),
    onDelete: (noticeId, noteId) => deleteNoticeNote.mutateAsync({ noticeId, noteId }).then(() => undefined)
  };

  const updateProfile = useMutation({
    mutationFn: (body: { fullName: string; avatarUrl: string | null }) =>
      apiRequest<UserProfile>("/profile", { ...common, method: "PATCH", body }),
    onSuccess: (profile) => {
      const current = authStorage.read();
      if (current) {
        authStorage.write({ ...current, user: { ...current.user, ...profile } });
      }
      notify("Perfil actualizado.");
    }
  });

  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      apiRequest<{ ok: boolean }>("/profile/password", { ...common, method: "PATCH", body }),
    onSuccess: () => notify("Contraseña actualizada.")
  });

  const updateOrganization = useMutation({
    mutationFn: (body: UpdateOrganizationPayload) =>
      apiRequest<OrganizationSettings>("/organizations/current", { ...common, method: "PATCH", body }),
    onSuccess: (organization) => {
      const current = authStorage.read();
      if (current) {
        authStorage.write({
          ...current,
          organizations: current.organizations.map((item) =>
            item.id === organization.id
              ? {
                  ...item,
                  displayName: organization.display_name,
                  logoUrl: organization.logo_url,
                  primaryColor: organization.primary_color,
                  secondaryColor: organization.secondary_color
                }
              : item
          )
        });
      }
      queryClient.setQueryData(["organization-settings", slug], organization);
      notify("Configuración actualizada.");
    }
  });

  const uploadOrganizationLogo = useMutation({
    mutationFn: ({ file, kind }: UploadLogoPayload) =>
      apiUpload<UploadLogoResponse>("/organizations/current/logo", file, {
        token: auth?.accessToken,
        organizationSlug: slug,
        fields: { kind }
      }),
    onSuccess: (result, variables) => {
      if (result.organization) {
        queryClient.setQueryData(["organization-settings", slug], result.organization);
      }
      const current = authStorage.read();
      if (current) {
        authStorage.write({
          ...current,
          organizations: current.organizations.map((item) =>
            item.slug === slug
              ? {
                  ...item,
                  logoUrl: variables.kind === "main" ? result.url : item.logoUrl,
                  loginLogoUrl: variables.kind === "login" ? result.url : item.loginLogoUrl
                }
              : item
          )
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["organization-settings", slug] });
      notify("Logo actualizado.");
    }
  });

  const createOrganizationTeamMember = useMutation({
    mutationFn: (body: CreateOrganizationTeamMemberPayload) =>
      apiRequest<OrganizationTeamMember>("/organizations/current/team", {
        ...common,
        method: "POST",
        body
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization-team", slug] })
  });

  const updateOrganizationTeamMember = useMutation({
    mutationFn: ({ memberId, body }: { memberId: string; body: UpdateOrganizationTeamMemberPayload }) =>
      apiRequest<OrganizationTeamMember>(`/organizations/current/team/${memberId}`, {
        ...common,
        method: "PATCH",
        body
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization-team", slug] })
  });

  const changeOrganizationTeamMemberPassword = useMutation({
    mutationFn: ({ memberId, body }: { memberId: string; body: ChangeOrganizationTeamMemberPasswordPayload }) =>
      apiRequest<OrganizationTeamMember>(`/organizations/current/team/${memberId}/password`, {
        ...common,
        method: "PATCH",
        body
      })
  });

  const deactivateOrganizationTeamMember = useMutation({
    mutationFn: ({ memberId, body }: { memberId: string; body: DeactivateOrganizationTeamMemberPayload }) =>
      apiRequest<OrganizationTeamMember>(`/organizations/current/team/${memberId}/deactivate`, {
        ...common,
        method: "PATCH",
        body
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization-team", slug] })
  });

  if (!auth) {
    const publicBrand = publicOrganization.data;
    const publicLogoUrl = publicBrand?.login_logo_url ?? publicBrand?.logo_url ?? null;
    return (
      <main
        className="login-shell"
        style={organizationThemeStyle({
          primaryColor: publicBrand?.primary_color ?? null,
          secondaryColor: publicBrand?.secondary_color ?? null
        })}
      >
        <section className="login-visual-panel">
          <div className="login-diagonal-base" aria-hidden="true" />
          <div className="login-diagonal-front" aria-hidden="true" />
          <div className="login-visual-content">
            <div className="login-visual-brand">
              {publicLogoUrl ? (
                <Image src={publicLogoUrl} alt={`Logo de ${publicBrand?.display_name ?? "la organización"}`} width={440} height={180} unoptimized priority />
              ) : (
                <ShieldCheck size={48} aria-hidden="true" />
              )}
              <h1>Avisos al día</h1>
            </div>

            <div className="login-notices-illustration" aria-hidden="true">
              <svg viewBox="0 0 470 300" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M314 18H460V282H219L314 18Z" fill="#F7FAFE" fillOpacity="0.72" />
                <path d="M324 44H428V236H256L324 44Z" fill="#FFFFFF" fillOpacity="0.82" stroke="#CBD9EA" />
                <path d="M315 77H415" stroke="#D7E1EE" strokeWidth="1.5" />
                <path d="M300 112H398" stroke="#D7E1EE" strokeWidth="1.5" />
                <path d="M288 151H382" stroke="#D7E1EE" strokeWidth="1.5" />
                <rect x="36" y="58" width="220" height="186" rx="10" fill="#FFFFFF" stroke="#C8D6E8" />
                <path d="M36 99H256" stroke="#D7E1EE" strokeWidth="1.5" />
                <circle cx="62" cy="79" r="5" fill="#AABDD5" />
                <circle cx="81" cy="79" r="5" fill="#C1CEDF" />
                <circle cx="100" cy="79" r="5" fill="#D8E1ED" />
                <rect x="66" y="128" width="92" height="10" rx="5" fill="#C5D5E8" />
                <rect x="66" y="160" width="132" height="10" rx="5" fill="#E2E8F1" />
                <rect x="66" y="192" width="108" height="10" rx="5" fill="#E2E8F1" />
                <circle cx="207" cy="133" r="16" fill="#EFF6FF" stroke="#BFD1E8" />
                <circle cx="207" cy="165" r="16" fill="#F8FBFF" stroke="#D0DCEB" />
                <circle cx="207" cy="197" r="16" fill="#F8FBFF" stroke="#D0DCEB" />
                <path d="M88 256C126 276 172 282 225 270C278 258 317 227 348 177" stroke="#B9CBE0" strokeWidth="1.7" strokeLinecap="round" />
                <circle cx="88" cy="256" r="24" fill="#FFFFFF" stroke="#BED0E5" />
                <path d="M79 258L86 265L99 249" stroke="#1456A0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="348" cy="177" r="24" fill="#FFFFFF" stroke="#BED0E5" />
                <path d="M340 184V169C340 164 344 160 349 160C354 160 358 164 358 169V184" stroke="#1456A0" strokeWidth="2.3" strokeLinecap="round" />
                <path d="M335 184H363" stroke="#1456A0" strokeWidth="2.3" strokeLinecap="round" />
                <circle cx="258" cy="42" r="28" fill="#FFFFFF" stroke="#BED0E5" />
                <path d="M258 27L272 33V45C272 55 266 62 258 65C250 62 244 55 244 45V33L258 27Z" fill="#F0F6FF" stroke="#1456A0" strokeWidth="2" strokeLinejoin="round" />
                <path d="M252 45L256 49L265 39" stroke="#1456A0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <p className="login-restricted-label">Acceso restringido</p>
        </section>

        <section className="login-form-side">
          <div className="login-mobile-brand">
            {publicLogoUrl ? (
              <Image src={publicLogoUrl} alt={`Logo de ${publicBrand?.display_name ?? "la organización"}`} width={320} height={120} unoptimized priority />
            ) : (
              <ShieldCheck size={42} aria-hidden="true" />
            )}
          </div>
          <form
            className="login-card"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              login.mutate({
                email: String(form.get("email") ?? ""),
                password: String(form.get("password") ?? "")
              });
            }}
          >
            <div className="login-card-title">
              <div className="login-mark">
                {publicLogoUrl ? (
                  <Image src={publicLogoUrl} alt="" width={32} height={32} unoptimized />
                ) : (
                  <Shield size={22} />
                )}
              </div>
              <div>
                <h2>Iniciar sesión</h2>
                <p>Accedé con tus credenciales.</p>
              </div>
            </div>
            <label className="sp-field">
              <span>Correo electrónico</span>
              <input name="email" type="email" autoComplete="email" placeholder="Correo electrónico" required />
            </label>
            <label className="sp-field">
              <span>Contraseña</span>
              <div className="sp-password-field">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Contraseña"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {loginError ? <div className="sp-error">{loginError}</div> : null}
            <button className="login-submit-button" type="submit" disabled={login.isPending}>
              <span />
              <b>{login.isPending ? "Cargando..." : "Ingresar"}</b>
            </button>
          </form>
        </section>
      </main>
    );
  }

  const allNotices = notices.data ?? [];
  const allClients = clients.data ?? [];
  const allCompanies = companies.data ?? [];
  const allPolicies = policies.data ?? [];
  const policyActions: PolicyActions = {
    clients: allClients,
    companies: allCompanies,
    isSaving: updatePolicy.isPending,
    isDeleting: deletePolicy.isPending,
    onUpdate: (policyId, values) => updatePolicy.mutateAsync({ policyId, values }),
    onDelete: (policyId) => deletePolicy.mutateAsync(policyId)
  };
  const shellTheme = organizationThemeStyle({
    primaryColor:
      organizationSettings.data?.primary_color ??
      selectedOrganization?.primaryColor ??
      null,
    secondaryColor:
      organizationSettings.data?.secondary_color ??
      selectedOrganization?.secondaryColor ??
      null
  });

  return (
    <main className={`sp-shell app-redesign ${tab === "settings" ? "settings-page-mode" : ""}`} style={shellTheme}>
      <Sidebar
        tab={tab}
        setTab={(next) => {
          setClientDetailId(null);
          setOpenPolicyId(null);
          setTab(next);
        }}
        urgentCount={countUrgentNotices(allNotices)}
        canManageOrganization={canManageOrganization}
        organizationName={
          organizationSettings.data?.display_name ??
          selectedOrganization?.displayName ??
          "SiniPro"
        }
        logoUrl={
          organizationSettings.data?.logo_url ??
          selectedOrganization?.logoUrl ??
          null
        }
      />

      <section className="sp-main">
        <header className="sp-header">
          <div>
            <h1>{titleForTab(tab)}</h1>
            <p>Panel operativo</p>
          </div>
          <div className="sp-header-actions">
            {/* Notificaciones y ayuda ocultas por ahora */}
            <UserMenu
              userName={auth.user.fullName}
              userEmail={auth.user.email}
              avatarUrl={auth.user.avatarUrl ?? null}
              role={selectedOrganization?.role ?? auth.user.platformRole}
              onOpenProfile={() => setTab("profile")}
              onLogout={() => {
                authStorage.clear();
                queryClient.clear();
              }}
            />
          </div>
        </header>

        <div className="sp-workspace">
          {tab === "dashboard" ? (
            <DashboardView
              userName={auth.user.fullName}
              notices={allNotices}
              clients={allClients}
              policies={allPolicies}
              isLoading={notices.isLoading || clients.isLoading || policies.isLoading}
              error={notices.error?.message ?? clients.error?.message ?? policies.error?.message ?? null}
              setTab={setTab}
            />
          ) : null}
          {tab === "notices" ? (
            <NoticesView
              notices={allNotices}
              companies={allCompanies}
              isLoading={notices.isLoading}
              markingNoticeId={markNotified.isPending ? markNotified.variables ?? null : null}
              payingNoticeId={payNotice.isPending ? payNotice.variables?.noticeId ?? null : null}
              revertingNoticeId={revertNotice.isPending ? revertNotice.variables ?? null : null}
              error={notices.error?.message ?? null}
              noteApi={noticeNoteApi}
              onNotified={(id) => markNotified.mutate(id)}
              onRevert={(id) => revertNotice.mutate(id)}
              onPay={(noticeId, months) => payNotice.mutateAsync({ noticeId, months })}
              onViewPolicy={(notice) => {
                const policyId = notice.policies?.id;
                const clientId = notice.policies?.clients?.id;
                if (!policyId || !clientId) return;
                setOpenPolicyId(policyId);
                setClientDetailId(clientId);
                setTab("clients");
              }}
            />
          ) : null}
          {tab === "clients" && !clientDetailId ? (
            <ClientsView
              clients={allClients}
              policies={allPolicies}
              isLoading={clients.isLoading}
              isCreating={createClient.isPending}
              error={clients.error?.message ?? null}
              onOpenClient={(client) => {
                setOpenPolicyId(null);
                setClientDetailId(client.id);
              }}
              onSubmit={async (event) => {
                event.preventDefault();
                const formElement = event.currentTarget;
                await createClient.mutateAsync(Object.fromEntries(new FormData(formElement)));
                formElement.reset();
              }}
            />
          ) : null}
          {tab === "clients" && clientDetailId ? (
            <ClientDetailScreen
              client={allClients.find((item) => item.id === clientDetailId) ?? null}
              policies={allPolicies}
              common={common}
              currentUserId={auth.user.id}
              isSavingClient={updateClient.isPending}
              isDeletingClient={deleteClient.isPending}
              noteApi={noticeNoteApi}
              policyActions={policyActions}
              initialOpenPolicyId={openPolicyId}
              onBack={() => setClientDetailId(null)}
              onSaveClient={(patch) => updateClient.mutateAsync({ clientId: clientDetailId, patch })}
              onDeleteClient={() => deleteClient.mutateAsync(clientDetailId)}
            />
          ) : null}
          {tab === "policies" ? (
            <PoliciesView
              policies={allPolicies}
              clients={allClients}
              companies={allCompanies}
              isLoading={policies.isLoading}
              isCreating={createPolicy.isPending}
              error={policies.error?.message ?? null}
              onCreate={(values) => createPolicy.mutateAsync(values)}
              onOpenPolicy={(policy) => {
                if (!policy.clients?.id) return;
                setOpenPolicyId(policy.id);
                setClientDetailId(policy.clients.id);
                setTab("clients");
              }}
            />
          ) : null}
          {tab === "companies" ? (
            <CompaniesView
              companies={allCompanies}
              policies={allPolicies}
              isLoading={companies.isLoading}
              isCreating={createCompany.isPending}
              error={companies.error?.message ?? null}
              onSubmit={async (event) => {
                event.preventDefault();
                const formElement = event.currentTarget;
                await createCompany.mutateAsync(Object.fromEntries(new FormData(formElement)));
                formElement.reset();
              }}
            />
          ) : null}
          {tab === "team" && canManageOrganization ? (
            <TeamView
              currentUserId={auth.user.id}
              team={organizationTeam.data ?? []}
              isLoading={organizationTeam.isLoading}
              isAdding={createOrganizationTeamMember.isPending}
              isUpdating={
                updateOrganizationTeamMember.isPending ||
                changeOrganizationTeamMemberPassword.isPending ||
                deactivateOrganizationTeamMember.isPending
              }
              error={
                organizationTeam.error?.message ??
                createOrganizationTeamMember.error?.message ??
                updateOrganizationTeamMember.error?.message ??
                changeOrganizationTeamMemberPassword.error?.message ??
                deactivateOrganizationTeamMember.error?.message ??
                null
              }
              onAddTeamMember={(payload) => createOrganizationTeamMember.mutateAsync(payload)}
              onUpdateTeamMember={(memberId, payload) => updateOrganizationTeamMember.mutateAsync({ memberId, body: payload })}
              onChangeTeamMemberPassword={(memberId, payload) =>
                changeOrganizationTeamMemberPassword.mutateAsync({ memberId, body: payload })
              }
              onDeactivateTeamMember={(memberId, payload) =>
                deactivateOrganizationTeamMember.mutateAsync({ memberId, body: payload })
              }
              onNotify={notify}
            />
          ) : null}
          {tab === "settings" && canManageOrganization ? (
            <SettingsView
              organization={organizationSettings.data}
              fallbackOrganization={selectedOrganization ?? null}
              isLoading={organizationSettings.isLoading}
              isSaving={updateOrganization.isPending}
              error={updateOrganization.error?.message ?? organizationSettings.error?.message ?? null}
              onUploadLogo={(payload) => uploadOrganizationLogo.mutateAsync(payload)}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                updateOrganization.mutate({
                  displayName: String(form.get("displayName") ?? ""),
                  logoUrl: emptyToNull(form.get("logoUrl")),
                  primaryColor: emptyToNull(form.get("primaryColor")),
                  secondaryColor: emptyToNull(form.get("secondaryColor")),
                  supportEmail: emptyToNull(form.get("supportEmail")),
                  supportPhone: emptyToNull(form.get("supportPhone"))
                });
              }}
            />
          ) : null}
          {tab === "profile" ? (
            <ProfileView
              userName={auth.user.fullName}
              userEmail={auth.user.email}
              avatarUrl={auth.user.avatarUrl ?? null}
              role={selectedOrganization?.role ?? auth.user.platformRole}
              isSavingProfile={updateProfile.isPending}
              isChangingPassword={changePassword.isPending}
              profileError={updateProfile.error?.message ?? null}
              passwordError={changePassword.error?.message ?? null}
              onUpdateProfile={(payload) => updateProfile.mutateAsync(payload)}
              onChangePassword={(payload) => changePassword.mutateAsync(payload)}
            />
          ) : null}
        </div>
      </section>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

function ToastViewport({
  toasts,
  onDismiss
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="sp-toast-viewport" role="status" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const Icon = toast.tone === "success" ? CheckCircle : AlertTriangle;
        return (
          <div key={toast.id} className={`sp-toast ${toast.tone}`}>
            <Icon size={18} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Cerrar notificación">
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DatePicker({
  name,
  value,
  onChange,
  placeholder = "dd/mm/yyyy",
  ariaLabel,
  required = false
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(() => selectedDate ?? new Date());
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    primary: string;
    onPrimary: string;
  } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const margin = 12;
    const popoverHeight = popoverRef.current?.offsetHeight ?? 360;
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < popoverHeight + 12 && rect.top > spaceBelow;
    const top = openUp ? Math.max(margin, rect.top - popoverHeight - 8) : rect.bottom + 8;
    const styles = window.getComputedStyle(trigger);
    const primary = styles.getPropertyValue("--org-primary").trim() || "#176e64";
    const onPrimary = styles.getPropertyValue("--org-on-primary").trim() || "#ffffff";
    setCoords({ top, left, width, primary, onPrimary });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handle = () => updatePosition();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const years = Array.from({ length: 31 }, (_, index) => year - 15 + index);
  const calendarDays = buildCalendarDays(viewDate);

  const selectDate = (date: Date) => {
    onChange(toIsoDate(date));
    setOpen(false);
  };

  return (
    <div className="sp-date-picker">
      {name ? <input type="hidden" name={name} value={value} aria-hidden="true" /> : null}
      <button
        ref={triggerRef}
        type="button"
        className={`sp-date-picker-trigger ${value ? "has-value" : ""}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-required={required ? "true" : undefined}
        onClick={() => {
          setViewDate(selectedDate ?? new Date());
          setOpen((current) => !current);
        }}
      >
        <CalendarDays size={15} />
        <span>{value ? formatDateInput(value) : placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={popoverRef}
              className="sp-date-picker-popover is-floating"
              style={
                {
                  position: "fixed",
                  top: coords.top,
                  left: coords.left,
                  bottom: "auto",
                  width: coords.width,
                  "--org-primary": coords.primary,
                  "--org-on-primary": coords.onPrimary
                } as CSSProperties
              }
            >
              <div className="sp-date-picker-header">
                <button type="button" aria-label="Mes anterior" onClick={() => setViewDate(new Date(year, month - 1, 1))}>
                  <ChevronLeft size={16} />
                </button>
                <div className="sp-date-picker-selects">
                  <select
                    aria-label="Mes"
                    value={month}
                    onChange={(event) => setViewDate(new Date(year, Number(event.target.value), 1))}
                  >
                    {SPANISH_MONTHS.map((monthName, index) => (
                      <option key={monthName} value={index}>
                        {monthName}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Año"
                    value={year}
                    onChange={(event) => setViewDate(new Date(Number(event.target.value), month, 1))}
                  >
                    {years.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" aria-label="Mes siguiente" onClick={() => setViewDate(new Date(year, month + 1, 1))}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="sp-date-picker-weekdays">
                {SPANISH_WEEK_DAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="sp-date-picker-grid">
                {calendarDays.map((date) => {
                  const isoDate = toIsoDate(date);
                  const isSelected = isoDate === value;
                  const isToday = isoDate === toIsoDate(new Date());
                  const isOutsideMonth = date.getMonth() !== month;

                  return (
                    <button
                      key={isoDate}
                      type="button"
                      className={`${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""} ${isOutsideMonth ? "is-muted" : ""}`}
                      onClick={() => selectDate(date)}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function Sidebar({
  tab,
  setTab,
  urgentCount,
  canManageOrganization,
  organizationName,
  logoUrl
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  urgentCount: number;
  canManageOrganization: boolean;
  organizationName: string;
  logoUrl: string | null;
}) {
  const nav: Array<{ key: Tab; name: string; icon: typeof LayoutDashboard; count?: number }> = [
    { key: "dashboard" as const, name: "Dashboard", icon: LayoutDashboard },
    { key: "notices" as const, name: "Avisos", icon: CalendarDays, count: urgentCount },
    { key: "policies" as const, name: "Pólizas", icon: FileText },
    { key: "clients" as const, name: "Asegurados", icon: Users },
    { key: "companies" as const, name: "Compañías", icon: Building2 }
  ];
  if (canManageOrganization) {
    nav.push({ key: "team", name: "Equipo", icon: Users });
    nav.push({ key: "settings", name: "Configuración", icon: Settings });
  }

  return (
    <aside className="sp-sidebar">
      <div className={logoUrl ? "sp-logo only-logo" : "sp-logo"}>
        {logoUrl ? (
          <div className="sp-logo-mark has-image">
            <Image src={logoUrl} alt={organizationName} width={240} height={108} unoptimized />
          </div>
        ) : (
          <>
            <div className="sp-logo-mark">
              <Shield size={17} />
            </div>
            <div className="sp-logo-copy">
              <strong>{organizationName}</strong>
            </div>
          </>
        )}
      </div>
      <nav className="sp-nav" aria-label="Navegación principal">
        <p>Principal</p>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={tab === item.key ? "active" : ""}
              type="button"
              onClick={() => setTab(item.key)}
            >
              <Icon size={22} />
              <span>{item.name}</span>
              {item.count ? <b>{item.count}</b> : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function UserMenu({
  userName,
  userEmail,
  avatarUrl,
  role,
  onOpenProfile,
  onLogout
}: {
  userName: string;
  userEmail: string;
  avatarUrl: string | null;
  role: string;
  onOpenProfile: () => void;
  onLogout: () => void;
}) {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const closeMenu = useCallback(() => {
    if (!isMenuVisible) return;
    const closeMs = readTransitionMs("--dropdown-close-dur", 150);
    setIsMenuClosing(true);
    window.clearTimeout(closeTimerRef.current ?? undefined);
    closeTimerRef.current = window.setTimeout(() => {
      setIsMenuVisible(false);
      setIsMenuClosing(false);
    }, closeMs);
  }, [isMenuVisible]);

  const openMenu = useCallback(() => {
    window.clearTimeout(closeTimerRef.current ?? undefined);
    setIsMenuVisible(true);
    setIsMenuClosing(false);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(closeTimerRef.current ?? undefined);
    };
  }, [closeMenu]);

  return (
    <div className="sp-user-menu" ref={menuRef}>
      <button
        className="sp-user-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isMenuVisible}
        onClick={() => (isMenuVisible ? closeMenu() : openMenu())}
      >
        <Avatar name={userName || userEmail} avatarUrl={avatarUrl} />
        <span>
          <strong>{userName || userEmail}</strong>
          <em>{roleLabel(role)}</em>
        </span>
        <ChevronDown size={15} />
      </button>
      {isMenuVisible ? (
        <div
          className={`sp-user-dropdown t-dropdown ${isMenuClosing ? "is-closing" : "is-open"}`}
          data-origin="top-right"
          role="menu"
        >
          <button
            type="button"
            onClick={() => {
              closeMenu();
              onOpenProfile();
            }}
          >
            <User size={15} />
            Perfil
          </button>
          <button type="button" onClick={onLogout}>
            <LogOut size={15} />
            Cerrar sesión
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return <Image className="sp-user-avatar" src={avatarUrl} alt="" width={56} height={56} unoptimized />;
  }

  return <div className="sp-user-avatar">{initials(name) || <User size={14} />}</div>;
}

function ProfileView({
  userName,
  userEmail,
  avatarUrl,
  role,
  isSavingProfile,
  isChangingPassword,
  profileError,
  passwordError,
  onUpdateProfile,
  onChangePassword
}: {
  userName: string;
  userEmail: string;
  avatarUrl: string | null;
  role: string;
  isSavingProfile: boolean;
  isChangingPassword: boolean;
  profileError: string | null;
  passwordError: string | null;
  onUpdateProfile: (payload: { fullName: string; avatarUrl: string | null }) => Promise<UserProfile>;
  onChangePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) => Promise<{ ok: boolean }>;
}) {
  const [preview, setPreview] = useState<string | null>(avatarUrl);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPreview(avatarUrl));
    return () => window.cancelAnimationFrame(frame);
  }, [avatarUrl]);

  return (
    <div className="sp-page padded">
      <section className="sp-profile-hero">
        <Avatar name={userName || userEmail} avatarUrl={preview} />
        <div>
          <span>{roleLabel(role)}</span>
          <h2>{userName || userEmail}</h2>
          <p>{userEmail}</p>
        </div>
      </section>

      <div className="sp-profile-layout">
        <form
          className="sp-form sp-profile-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            try {
              await onUpdateProfile({
                fullName: String(form.get("fullName") ?? ""),
                avatarUrl: preview
              });
            } catch {
              // parent mutation state renders the error
            }
          }}
        >
          <div className="sp-section-title compact">
            <h2>Datos personales</h2>
            <span>Información visible dentro del panel</span>
          </div>
          <div className="sp-profile-photo">
            <Avatar name={userName || userEmail} avatarUrl={preview} />
            <div>
              <label className="sp-upload-button">
                Cambiar foto
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setPreview(await avatarFileToDataUrl(file));
                  }}
                />
              </label>
              {preview ? (
                <button className="sp-link-button" type="button" onClick={() => setPreview(null)}>
                  Quitar foto
                </button>
              ) : null}
            </div>
          </div>
          <label className="sp-field">
            <span>Nombre</span>
            <input name="fullName" defaultValue={userName} required />
          </label>
          <label className="sp-field">
            <span>Correo</span>
            <input value={userEmail} disabled readOnly />
          </label>
          {profileError ? <div className="sp-error">{profileError}</div> : null}
          <div className="sp-form-actions">
            <button className="sp-primary-action" type="submit" disabled={isSavingProfile}>
              {isSavingProfile ? "Cargando..." : "Guardar perfil"}
            </button>
          </div>
        </form>

        <form
          className="sp-form sp-password-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            try {
              await onChangePassword({
                currentPassword: String(form.get("currentPassword") ?? ""),
                newPassword: String(form.get("newPassword") ?? ""),
                confirmPassword: String(form.get("confirmPassword") ?? "")
              });
              formElement.reset();
            } catch {
              // parent mutation state renders the error
            }
          }}
        >
          <div className="sp-section-title compact">
            <h2>Cambiar contraseña</h2>
            <span>Usá una clave de al menos 8 caracteres</span>
          </div>
          <label className="sp-field">
            <span>Contraseña actual</span>
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <label className="sp-field">
            <span>Nueva contraseña</span>
            <input name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <label className="sp-field">
            <span>Confirmar contraseña</span>
            <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          {passwordError ? <div className="sp-error">{passwordError}</div> : null}
          <div className="sp-form-actions">
            <button className="sp-secondary-action" type="submit" disabled={isChangingPassword}>
              {isChangingPassword ? "Cargando..." : "Actualizar contraseña"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DashboardView({
  userName,
  notices,
  clients,
  policies,
  isLoading,
  error,
  setTab
}: {
  userName: string;
  notices: Notice[];
  clients: Client[];
  policies: Policy[];
  isLoading: boolean;
  error: string | null;
  setTab: (tab: Tab) => void;
}) {
  const firstName = (userName || "").trim().split(/\s+/)[0] || "equipo";
  const todayLabel = capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())
  );
  const urgentNotices = notices.filter((notice) => notice.status !== "pagado" && getDaysUntilDue(notice.due_date) <= 7);
  const openNotices = notices.filter((notice) => notice.status !== "pagado");
  const notified = notices.filter((notice) => notice.status === "avisado");
  const paid = notices.filter((notice) => notice.status === "pagado");
  const nextNotice = notices
    .filter((notice) => notice.status !== "pagado")
    .sort((a, b) => getDaysUntilDue(a.due_date) - getDaysUntilDue(b.due_date))[0];
  const paidRatio = notices.length ? Math.round((paid.length / notices.length) * 100) : 0;
  const contactRatio = openNotices.length ? Math.round((notified.length / openNotices.length) * 100) : 0;
  const recentNotices = [...notices]
    .sort((a, b) => getDaysUntilDue(a.due_date) - getDaysUntilDue(b.due_date))
    .slice(0, 5);
  const recentPayments = paid
    .slice()
    .sort((a, b) => b.due_date.localeCompare(a.due_date))
    .slice(0, 5);

  const stats = [
    {
      label: "Pendientes",
      sublabel: "avisos abiertos",
      value: openNotices.length,
      icon: AlertTriangle,
      tone: "warning",
      tab: "notices" as const
    },
    {
      label: "Urgentes",
      sublabel: "vencen en 7 días",
      value: urgentNotices.length,
      icon: Clock,
      tone: "danger",
      tab: "notices" as const
    },
    {
      label: "Pólizas",
      sublabel: "cartera activa",
      value: policies.length,
      icon: FileText,
      tone: "neutral",
      tab: "policies" as const
    },
    {
      label: "Asegurados",
      sublabel: "personas registradas",
      value: clients.length,
      icon: Users,
      tone: "neutral",
      tab: "clients" as const
    }
  ];

  const statusMetrics = [
    {
      label: "A contactar",
      value: notices.filter((notice) => notice.status === "avisar").length,
      color: "var(--sp-amber)"
    },
    {
      label: "Contactados",
      value: notified.length,
      color: "var(--sp-accent)"
    },
    {
      label: "Pagados",
      value: paid.length,
      color: "var(--sp-green)"
    }
  ];

  const quickActions = [
    {
      label: "Gestionar avisos",
      description: "Revisar vencimientos y registrar pagos",
      icon: Bell,
      tab: "notices" as const
    },
    {
      label: "Nueva póliza",
      description: "Crear una póliza y generar sus avisos",
      icon: Plus,
      tab: "policies" as const
    },
    {
      label: "Nuevo asegurado",
      description: "Cargar datos de contacto y localidad",
      icon: Users,
      tab: "clients" as const
    }
  ];

  return (
    <div className="sp-page padded grid gap-5 p-6">
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando resumen operativo" /> : null}

      <section className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 max-[900px]:flex-col">
        <div>
          <span className="text-xs font-semibold uppercase text-slate-500">{todayLabel}</span>
          <h2 className="m-0 mt-1 text-2xl font-semibold text-slate-950">Hola, {firstName} 👋</h2>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Este es el estado de tu cartera y los últimos movimientos registrados.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 max-[900px]:w-full max-[900px]:flex-wrap max-[520px]:flex-col">
          <button type="button" className="sp-secondary-action" onClick={() => setTab("clients")}>
            <Users size={15} />
            Asegurado
          </button>
          <button type="button" className="sp-primary-action" onClick={() => setTab("policies")}>
            <Plus size={15} />
            Nueva póliza
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <button
              key={stat.label}
              className={`flex min-h-28 items-start gap-3 rounded-lg border bg-white p-4 text-left transition-colors hover:bg-slate-50 ${stat.tone === "danger" ? "border-red-200" : stat.tone === "warning" ? "border-amber-200" : "border-slate-200"}`}
              type="button"
              onClick={() => setTab(stat.tab)}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${stat.tone === "danger" ? "bg-red-50 text-red-700" : stat.tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                <Icon size={18} />
              </span>
              <span className="grid min-w-0 gap-1">
                <em className="text-xs font-medium not-italic text-slate-500">{stat.label}</em>
                <strong className="text-3xl font-semibold leading-none text-slate-950">{stat.value}</strong>
                <small className="text-xs text-slate-500">{stat.sublabel}</small>
              </span>
            </button>
          );
        })}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="sp-section-title">
          <div>
            <h2>Últimos pagos</h2>
            <span>{paid.length} pagos registrados en total</span>
          </div>
          <button type="button" onClick={() => setTab("notices")}>
            Ver avisos
            <ArrowUpRight size={14} />
          </button>
        </div>
        {recentPayments.length === 0 ? (
          <EmptyState title="Sin pagos registrados" text="Cuando marques un aviso como pagado, vas a verlo acá." compact />
        ) : (
          <div className="grid gap-1">
            {recentPayments.map((notice) => {
              const client = notice.policies?.clients;
              return (
                <button
                  key={notice.id}
                  className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
                  type="button"
                  onClick={() => setTab("notices")}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--org-primary-soft)] text-[var(--org-primary)]">
                    <CheckCircle size={17} />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-sm font-semibold text-slate-950">{client?.full_name ?? "Sin cliente"}</strong>
                    <em className="truncate text-xs not-italic text-slate-500">
                      {notice.policies?.insurance_companies?.name ?? "Sin compañía"}
                      {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
                    </em>
                  </span>
                  <span className="grid justify-items-end gap-0.5 text-right">
                    <b className="text-xs font-semibold text-slate-700">{formatDate(notice.due_date)}</b>
                    {notice.paid_interval_months ? (
                      <em className="text-[11px] not-italic text-slate-400">{intervalLabel(notice.paid_interval_months)}</em>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <article className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Seguimiento de avisos</h2>
              <span>{notices.length} avisos generados</span>
            </div>
            <button type="button" onClick={() => setTab("notices")}>
              Abrir avisos
              <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-600">Cobranza registrada</span>
              <strong className="text-lg font-semibold text-slate-950">{paidRatio}%</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${paidRatio}% de avisos pagados`}>
              <i className="block h-full rounded-full bg-[var(--org-primary)]" style={{ width: `${paidRatio}%` }} />
            </div>
          </div>

          <div className="my-3 grid gap-3 md:grid-cols-3">
            {statusMetrics.map((metric) => (
              <div key={metric.label} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4">
                <i className="h-1 w-10 rounded-full" style={{ backgroundColor: metric.color }} />
                <span className="text-xs font-medium text-slate-500">{metric.label}</span>
                <strong className="text-2xl font-semibold text-slate-950">{metric.value}</strong>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-600">Contactabilidad pendiente</span>
              <strong className="text-lg font-semibold text-slate-950">{contactRatio}%</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${contactRatio}% de avisos abiertos contactados`}>
              <i className="block h-full rounded-full bg-amber-600" style={{ width: `${contactRatio}%` }} />
            </div>
          </div>
        </article>

        <aside className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Próximo vencimiento</h2>
              <span>Prioridad operativa</span>
            </div>
            <CalendarDays size={18} />
          </div>
          {nextNotice ? (
            <div className="grid gap-3">
              <strong className="text-xl font-semibold leading-tight text-slate-950">
                {nextNotice.policies?.clients?.full_name ?? "Sin cliente"}
              </strong>
              <span className="text-sm text-slate-500">{nextNotice.policies?.insurance_companies?.name ?? "Sin compañía"}</span>
              <b className={`w-fit rounded-md bg-slate-50 px-2.5 py-1 text-xs font-semibold ${dueClass(getDaysUntilDue(nextNotice.due_date))}`}>
                {dueLabel(getDaysUntilDue(nextNotice.due_date))} · {formatDate(nextNotice.due_date)}
              </b>
              <button type="button" className="sp-primary-action mt-2 w-fit" onClick={() => setTab("notices")}>
                Resolver
                <ArrowUpRight size={14} />
              </button>
            </div>
          ) : (
            <EmptyState title="Sin pendientes" text="No hay vencimientos abiertos para gestionar." compact />
          )}
        </aside>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Agenda inmediata</h2>
              <span>Vencimientos ordenados por prioridad</span>
            </div>
            <button type="button" onClick={() => setTab("notices")}>
              Ver todo
              <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="grid gap-1">
            {recentNotices.length === 0 ? (
              <EmptyState title="Sin avisos cargados" text="Cuando existan vencimientos, van a aparecer en esta lista." compact />
            ) : (
              recentNotices.map((notice) => {
                const client = notice.policies?.clients;
                const days = getDaysUntilDue(notice.due_date);
                return (
                  <button
                    key={notice.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
                    type="button"
                    onClick={() => setTab("notices")}
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-sm font-semibold text-slate-950">{client?.full_name ?? "Sin cliente"}</strong>
                      <em className="truncate text-xs not-italic text-slate-500">
                        {notice.policies?.policy_number ? `#${notice.policies.policy_number}` : "Sin póliza"}
                      </em>
                    </span>
                    <b className={`text-xs font-semibold ${dueClass(days)}`}>{dueLabel(days)}</b>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Accesos rápidos</h2>
              <span>Flujos de trabajo frecuentes</span>
            </div>
          </div>
          <div className="grid gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-slate-200 bg-white p-3 text-left transition-colors hover:bg-slate-50"
                  type="button"
                  onClick={() => setTab(action.tab)}
                >
                  <span className="row-span-2 flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                    <Icon size={16} />
                  </span>
                  <strong className="text-sm font-semibold text-slate-950">{action.label}</strong>
                  <em className="text-xs not-italic leading-5 text-slate-500">{action.description}</em>
                </button>
              );
            })}
          </div>
        </article>
      </section>
    </div>
  );
}

function NoticesView({
  notices,
  companies,
  isLoading,
  markingNoticeId,
  payingNoticeId,
  revertingNoticeId,
  error,
  noteApi,
  onNotified,
  onRevert,
  onPay,
  onViewPolicy
}: {
  notices: Notice[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  markingNoticeId: string | null;
  payingNoticeId: string | null;
  revertingNoticeId: string | null;
  error: string | null;
  noteApi: NoticeNoteApi;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onPay: (id: string, months: number) => Promise<unknown>;
  onViewPolicy: (notice: Notice) => void;
}) {
  const [filters, setFilters] = useState<NoticeFilters>(EMPTY_NOTICE_FILTERS);
  const [view, setView] = useState<NoticeView>(() => readView("sp-notices-view", "kanban"));
  const [payNoticeTarget, setPayNoticeTarget] = useState<Notice | null>(null);
  const [detailNotice, setDetailNotice] = useState<Notice | null>(null);

  const branches = useMemo(() => {
    const fromData = notices.map((notice) => notice.policies?.branch).filter(Boolean) as string[];
    return Array.from(new Set([...BRANCHES, ...fromData]));
  }, [notices]);

  const filtered = useMemo(
    () => notices.filter((notice) => isNoticeInWindow(notice) && matchesNoticeFilters(notice, filters)),
    [notices, filters]
  );

  const grouped = useMemo(
    () => ({
      avisar: filtered.filter((notice) => notice.status === "avisar"),
      avisado: filtered.filter((notice) => notice.status === "avisado"),
      pagado: filtered.filter((notice) => notice.status === "pagado")
    }),
    [filtered]
  );

  return (
    <div className="sp-page flush">
      <FiltersPanel
        companies={companies}
        branches={branches}
        filters={filters}
        onChange={setFilters}
      />

      <div className="sp-board-toolbar">
        <span>{isLoading ? "Cargando..." : `${filtered.length} avisos`}</span>
        <ViewToggle
          leftLabel="Kanban"
          rightLabel="Lista"
          value={view}
          leftValue="kanban"
          rightValue="list"
          onChange={(next) => {
            setView(next);
            writeView("sp-notices-view", next);
          }}
        />
      </div>

      <div className="sp-board-area">
        {error ? <ErrorState text={error} /> : null}
        {isLoading ? <LoadingState text="Cargando avisos" /> : null}
        {!isLoading && view === "kanban" ? (
          <div className="sp-kanban">
            {NOTICE_COLUMNS.map((column) => (
              <section key={column.key} className="sp-kanban-column">
                <header>
                  <div>
                    <i style={{ backgroundColor: column.dot }} />
                    <h3>{column.label}</h3>
                  </div>
                  <span>{grouped[column.key].length}</span>
                </header>
                <div className="sp-kanban-scroll">
                  {grouped[column.key].length === 0 ? (
                    <EmptyState title="Sin avisos" compact />
                  ) : (
                    grouped[column.key].map((notice) => (
                      <NoticeCard
                        key={notice.id}
                        notice={notice}
                        isMarkingNotified={markingNoticeId === notice.id}
                        isPaying={payingNoticeId === notice.id}
                        isReverting={revertingNoticeId === notice.id}
                        noteApi={noteApi}
                        onNotified={onNotified}
                        onRevert={onRevert}
                        onRequestPay={setPayNoticeTarget}
                        onOpenDetail={setDetailNotice}
                      />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel">
            {filtered.length === 0 ? (
              <EmptyState title="No hay avisos para mostrar" text="Probá limpiar filtros o revisar otro rango de vencimientos." />
            ) : (
              <>
                <div className="sp-list-header notice">
                  <span>Cliente y póliza</span>
                  <span>Rama</span>
                  <span>Vencimiento</span>
                  <span>Acciones</span>
                </div>
                {filtered.map((notice) => (
                  <NoticeListRow
                    key={notice.id}
                    notice={notice}
                    isMarkingNotified={markingNoticeId === notice.id}
                    isPaying={payingNoticeId === notice.id}
                    isReverting={revertingNoticeId === notice.id}
                    onNotified={onNotified}
                    onRevert={onRevert}
                    onRequestPay={setPayNoticeTarget}
                    onOpenDetail={setDetailNotice}
                  />
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>

      <PaymentDialog
        key={payNoticeTarget?.id ?? "pay-dialog"}
        notice={payNoticeTarget}
        isPaying={Boolean(payNoticeTarget && payingNoticeId === payNoticeTarget.id)}
        onClose={() => setPayNoticeTarget(null)}
        onConfirm={async (months) => {
          if (!payNoticeTarget) return;
          await onPay(payNoticeTarget.id, months);
          setPayNoticeTarget(null);
        }}
      />

      <NoticeDetailModal
        notice={detailNotice}
        onClose={() => setDetailNotice(null)}
        onViewPolicy={(notice) => {
          setDetailNotice(null);
          onViewPolicy(notice);
        }}
      />
    </div>
  );
}

function NoticeDetailModal({
  notice,
  onClose,
  onViewPolicy
}: {
  notice: Notice | null;
  onClose: () => void;
  onViewPolicy: (notice: Notice) => void;
}) {
  if (!notice) {
    return <Modal title="Detalle del aviso" isOpen={false} onClose={onClose}><div /></Modal>;
  }

  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);
  const dueColor =
    notice.status === "pagado" ? "text-emerald-600" : days < 0 ? "text-red-600" : days <= 7 ? "text-amber-600" : "text-slate-600";

  const rows: Array<{ label: string; value: string | null; href?: string | undefined }> = [
    { label: "Compañía", value: company?.name ?? null },
    { label: "N° de póliza", value: notice.policies?.policy_number || null },
    { label: "Rama", value: notice.policies?.branch || null },
    { label: "Patente", value: notice.policies?.vehicle_plate || null },
    { label: "Teléfono", value: client?.phone ?? null, href: client?.phone ? `tel:${client.phone}` : undefined },
    { label: "Email", value: client?.email ?? null, href: client?.email ? `mailto:${client.email}` : undefined }
  ];
  const visibleRows = rows.filter((row) => row.value);

  return (
    <Modal title="Detalle del aviso" isOpen={Boolean(notice)} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 truncate text-lg font-bold text-slate-900">{client?.full_name ?? "Sin cliente"}</h3>
            <p className="mt-0.5 text-sm font-semibold">
              <span className={dueColor}>{dueLabel(days)}</span>
              <span className="text-slate-400"> · {formatDate(notice.due_date)}</span>
            </p>
          </div>
          <span className={noticeStatusPill(notice.status)}>{noticeStatusLabel(notice.status)}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
          {visibleRows.map((row) => (
            <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{row.label}</span>
              {row.href ? (
                <a className="truncate text-sm font-medium text-slate-800 hover:text-[color:var(--org-primary)]" href={row.href}>{row.value}</a>
              ) : (
                <span className="truncate text-sm font-medium text-slate-800">{row.value}</span>
              )}
            </div>
          ))}
          {notice.status === "pagado" && notice.paid_interval_months ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Periodicidad pagada</span>
              <span className="truncate text-sm font-medium text-slate-800">{intervalLabel(notice.paid_interval_months)}</span>
            </div>
          ) : null}
        </div>

        {notice.notified_by || notice.payment_processed_by ? (
          <div className="flex flex-col gap-1.5">
            {notice.notified_by ? (
              <p className="m-0 flex items-center gap-1.5 text-xs text-slate-500">
                <Bell size={13} className="text-blue-500" />
                Avisado por <strong className="font-semibold text-slate-700">{notice.notified_by.full_name}</strong>
                {notice.notified_at ? <span className="text-slate-400">· {formatDate(notice.notified_at.slice(0, 10))}</span> : null}
              </p>
            ) : null}
            {notice.payment_processed_by ? (
              <p className="m-0 flex items-center gap-1.5 text-xs text-slate-500">
                <CheckCircle size={13} className="text-emerald-500" />
                Cobrado por <strong className="font-semibold text-slate-700">{notice.payment_processed_by.full_name}</strong>
                {notice.payment_processed_at ? <span className="text-slate-400">· {formatDate(notice.payment_processed_at.slice(0, 10))}</span> : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {client?.notes ? (
          <div className="rounded-lg border-l-2 border-amber-300 bg-amber-50 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Nota del asegurado</span>
            <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-snug text-amber-900">{client.notes}</p>
          </div>
        ) : null}

        {notice.notes && notice.notes.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notas internas</span>
            {notice.notes.map((note) => (
              <p key={note.id} className="m-0 rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px] leading-snug text-slate-600">
                <strong className="font-semibold text-slate-700">{note.user?.full_name ?? "Usuario"}:</strong> {note.note}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" className="sp-secondary-action" onClick={onClose}>Cerrar</button>
          <button type="button" className="sp-primary-action" onClick={() => onViewPolicy(notice)}>
            <FileText size={14} />
            Ver póliza
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FiltersPanel({
  companies,
  branches,
  filters,
  onChange
}: {
  companies: InsuranceCompany[];
  branches: string[];
  filters: NoticeFilters;
  onChange: (filters: NoticeFilters) => void;
}) {
  const hasFilters = Object.entries(filters).some(([key, value]) => {
    if (key === "companyId" || key === "branch" || key === "status") return value !== "all";
    return Boolean(value);
  });

  const update = (key: keyof NoticeFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="sp-filters">
      <div className="sp-search">
        <Search size={15} />
        <input
          placeholder="Cliente, póliza N°, patente..."
          value={filters.search}
          onChange={(event) => update("search", event.target.value)}
        />
      </div>
      <select value={filters.companyId} onChange={(event) => update("companyId", event.target.value)}>
        <option value="all">Todas las compañías</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      <select value={filters.branch} onChange={(event) => update("branch", event.target.value)}>
        <option value="all">Todas las ramas</option>
        {branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
      <select value={filters.status} onChange={(event) => update("status", event.target.value)}>
        <option value="all">Todos</option>
        <option value="avisar">Avisar</option>
        <option value="avisado">Avisado</option>
        <option value="pagado">Pagado</option>
      </select>
      <DatePicker
        value={filters.dateFrom}
        onChange={(value) => update("dateFrom", value)}
        placeholder="Desde"
        ariaLabel="Desde"
      />
      <DatePicker
        value={filters.dateTo}
        onChange={(value) => update("dateTo", value)}
        placeholder="Hasta"
        ariaLabel="Hasta"
      />
      {hasFilters ? (
        <button className="sp-clear-filter" type="button" onClick={() => onChange(EMPTY_NOTICE_FILTERS)}>
          <X size={14} />
          Limpiar
        </button>
      ) : null}
    </div>
  );
}

function NoticeCard({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  noteApi,
  onNotified,
  onRevert,
  onRequestPay,
  onOpenDetail
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  noteApi: NoticeNoteApi;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notice: Notice) => void;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);
  // Si está pagado, el vencimiento se muestra en verde (ya cobrado), aunque haya vencido.
  const dueColor =
    notice.status === "pagado"
      ? "text-emerald-600"
      : days < 0
        ? "text-red-600"
        : days <= 7
          ? "text-amber-600"
          : "text-slate-500";

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
      {/* Cuerpo clickeable: abre el detalle del aviso */}
      <div
        role="button"
        tabIndex={0}
        className="cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary-soft)]"
        onClick={() => onOpenDetail(notice)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenDetail(notice);
          }
        }}
      >
        {/* Nivel 1: nombre del asegurado + vencimiento */}
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="truncate text-sm font-semibold leading-tight text-slate-900">{client?.full_name ?? "Sin cliente"}</h4>
          <b className={`shrink-0 text-xs font-semibold ${dueColor}`}>{dueLabel(days)}</b>
        </div>

        {/* Nivel 2: compañía / póliza / patente */}
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {company?.name ?? "Sin compañía"}
          {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
          {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
        </p>

        {/* Nivel 3: rama + teléfono */}
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {notice.policies?.branch ?? "Rama"}
          </span>
          {client?.phone ? (
            <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-slate-400">
              <Phone size={11} />
              {client.phone}
            </span>
          ) : null}
        </div>

        {/* Estado (avisó / cobró) de forma sutil */}
        <NoticeAudit notice={notice} />

        {/* Nota del asegurado (solo lectura desde el aviso) */}
        {client?.notes ? (
          <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-2 text-[11px] leading-snug text-slate-400">
            {client.notes}
          </p>
        ) : null}
      </div>

      {/* Notas del aviso (editables, colapsadas y sutiles) */}
      <NoticeNotes notice={notice} noteApi={noteApi} />

      <NoticeActions
        notice={notice}
        isMarkingNotified={isMarkingNotified}
        isPaying={isPaying}
        isReverting={isReverting}
        onNotified={onNotified}
        onRevert={onRevert}
        onRequestPay={onRequestPay}
      />
    </article>
  );
}

function NoticeAudit({ notice }: { notice: Notice }) {
  if (notice.status === "avisar") return null;
  const showNotified = notice.notified_by && (notice.status === "avisado" || notice.status === "pagado");
  const showPaid = notice.payment_processed_by && notice.status === "pagado";
  if (!showNotified && !showPaid) return null;
  const parts: string[] = [];
  if (showNotified) parts.push(`avisó ${notice.notified_by?.full_name}`);
  if (showPaid) parts.push(`cobró ${notice.payment_processed_by?.full_name}`);
  return (
    <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
      {showPaid ? <CheckCircle size={11} className="shrink-0 text-emerald-500" /> : <Bell size={11} className="shrink-0 text-blue-500" />}
      <span className="truncate">{parts.join(" · ")}</span>
    </p>
  );
}

function NoticeListRow({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  onNotified,
  onRevert,
  onRequestPay,
  onOpenDetail,
  compact
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notice: Notice) => void;
  compact?: boolean;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);

  return (
    <div className={`sp-list-row notice ${compact ? "compact" : ""}`}>
      <i style={{ backgroundColor: NOTICE_COLUMNS.find((column) => column.key === notice.status)?.dot }} />
      <div
        className="sp-list-main cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(notice)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenDetail(notice);
          }
        }}
      >
        <strong>{client?.full_name ?? "Sin cliente"}</strong>
        <span>
          {company?.name ?? "Sin compañía"}
          {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
          {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
        </span>
      </div>
      <span className="sp-branch-tag">{notice.policies?.branch ?? "Rama"}</span>
      <b
        className={`shrink-0 text-xs font-semibold ${
          notice.status === "pagado" ? "text-emerald-600" : days < 0 ? "text-red-600" : days <= 7 ? "text-amber-600" : "text-slate-500"
        }`}
      >
        {dueLabel(days)}
      </b>
      {!compact ? (
        <NoticeActions
          notice={notice}
          isMarkingNotified={isMarkingNotified}
          isPaying={isPaying}
          isReverting={isReverting}
          onNotified={onNotified}
          onRevert={onRevert}
          onRequestPay={onRequestPay}
          inline
        />
      ) : null}
    </div>
  );
}

function NoticeActions({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  onNotified,
  onRevert,
  onRequestPay,
  inline
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestPay: (notice: Notice) => void;
  inline?: boolean;
}) {
  const busy = isMarkingNotified || isPaying || isReverting;
  const wrap = `mt-2 flex gap-1.5 border-t border-slate-100 pt-2 ${inline ? "mt-0 border-0 pt-0" : ""}`;
  const base =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const blue = `${base} bg-blue-600 text-white hover:bg-blue-700`;
  const green = `${base} bg-emerald-600 text-white hover:bg-emerald-700`;
  const neutral = `${base} bg-slate-100 text-slate-600 hover:bg-slate-200`;
  const spin = <Loader2 size={13} className="animate-spin" />;

  // Flujo estricto: avisar -> avisado (azul) -> pagado (verde).
  if (notice.status === "pagado") {
    return (
      <div className={wrap}>
        <button type="button" className={neutral} onClick={() => onRevert(notice.id)} disabled={busy}>
          {isReverting ? spin : <RotateCcw size={13} />}
          Revertir pago
        </button>
      </div>
    );
  }

  if (notice.status === "avisar") {
    return (
      <div className={wrap}>
        <button type="button" className={blue} onClick={() => onNotified(notice.id)} disabled={busy}>
          {isMarkingNotified ? spin : <Bell size={13} />}
          Marcar avisado
        </button>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <button type="button" className={neutral} onClick={() => onRevert(notice.id)} disabled={busy}>
        {isReverting ? spin : <RotateCcw size={13} />}
        Avisar
      </button>
      <button type="button" className={green} onClick={() => onRequestPay(notice)} disabled={busy}>
        {isPaying ? spin : <CheckCircle size={13} />}
        Pagar
      </button>
    </div>
  );
}

function NoticeNotes({ notice, noteApi }: { notice: Notice; noteApi: NoticeNoteApi }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const notes = notice.notes ?? [];
  const isAdding = noteApi.busyNoticeId === notice.id;

  const submit = async () => {
    const value = draft.trim();
    if (!value) return;
    await noteApi.onAdd(notice.id, value);
    setDraft("");
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-600"
        onClick={() => setOpen((current) => !current)}
      >
        <MessageSquare size={12} />
        {notes.length > 0 ? `${notes.length} ${notes.length === 1 ? "nota interna" : "notas internas"}` : "Agregar nota interna"}
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {notes.map((note) => {
            const own = note.user_id === noteApi.currentUserId;
            return (
              <div
                key={note.id}
                className={`flex items-start justify-between gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug ${
                  own ? "border-l-2 border-amber-400 bg-amber-50 text-amber-900" : "border border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <strong className="font-semibold">{note.user?.full_name ?? "Usuario"}:</strong> {note.note}
                </span>
                {own ? (
                  <button
                    type="button"
                    aria-label="Eliminar nota"
                    className="shrink-0 text-slate-400 transition-colors hover:text-red-600 disabled:opacity-50"
                    onClick={() => noteApi.onDelete(notice.id, note.id)}
                    disabled={noteApi.deletingNoteId === note.id}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <input
              value={draft}
              placeholder="Agregar una nota..."
              className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-[color:var(--org-primary)]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              disabled={isAdding}
            />
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[color:var(--org-primary-soft)] text-[color:var(--org-primary)] transition-colors hover:brightness-95 disabled:opacity-50"
              onClick={() => void submit()}
              disabled={isAdding || !draft.trim()}
            >
              {isAdding ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PaymentDialog({
  notice,
  isPaying,
  onClose,
  onConfirm
}: {
  notice: Notice | null;
  isPaying: boolean;
  onClose: () => void;
  onConfirm: (months: number) => Promise<void>;
}) {
  const [months, setMonths] = useState<number>(notice?.paid_interval_months ?? 1);
  const [error, setError] = useState<string | null>(null);

  const client = notice?.policies?.clients;
  const options = [1, 2, 3, 6, 12];

  return (
    <Modal title="Registrar pago" isOpen={Boolean(notice)} onClose={() => (isPaying ? undefined : onClose())}>
      <form
        className="sp-pay-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await onConfirm(months);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "No se pudo registrar el pago.");
          }
        }}
      >
        <p className="sp-pay-client">
          {client?.full_name ?? "Sin cliente"}
          {notice?.policies?.branch ? ` · ${notice.policies.branch}` : ""}
        </p>
        <p className="sp-pay-question">¿Cuántos meses pagó el cliente?</p>
        <div className="sp-pay-options">
          {options.map((value) => {
            const selected = months === value;
            return (
              <button
                key={value}
                type="button"
                className={`sp-pay-option ${selected ? "is-selected" : ""}`}
                onClick={() => setMonths(value)}
                disabled={isPaying}
              >
                <span className="sp-pay-option-copy">
                  <strong>{capitalizeFirst(intervalLabel(value))}</strong>
                  <em>Próximo aviso en {value} {value === 1 ? "mes" : "meses"}</em>
                </span>
                {selected ? (
                  <span className="sp-pay-check">
                    <Check size={13} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {error ? <div className="sp-pay-error">{error}</div> : null}
        <div className="sp-modal-actions">
          <button type="button" className="sp-secondary-action" onClick={onClose} disabled={isPaying}>
            Cancelar
          </button>
          <button type="submit" className="sp-primary-action" disabled={isPaying}>
            {isPaying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {isPaying ? "Registrando..." : "Confirmar pago"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClientsView({
  clients,
  policies,
  isLoading,
  isCreating,
  error,
  onOpenClient,
  onSubmit
}: {
  clients: Client[];
  policies: Policy[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  onOpenClient: (client: Client) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [locality, setLocality] = useState("all");
  const [view, setView] = useState<EntityView>(() => readView("sp-clients-view", "list"));
  const [isModalOpen, setIsModalOpen] = useState(false);

  const localities = useMemo(
    () => Array.from(new Set(clients.map((client) => client.locality).filter(Boolean) as string[])).sort(),
    [clients]
  );

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return clients.filter((client) =>
      (locality === "all" || client.locality === locality) &&
      [client.full_name, client.email, client.phone, client.locality, client.dni]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [clients, locality, search]);

  return (
    <div className="sp-page padded">
      <EntityToolbar
        search={search}
        setSearch={setSearch}
        count={filtered.length}
        total={clients.length}
        view={view}
        setView={(next) => {
          setView(next);
          writeView("sp-clients-view", next);
        }}
        placeholder="Buscar asegurados..."
        actionLabel="Nuevo asegurado"
        onAction={() => setIsModalOpen(true)}
      >
        <SearchableSelect
          value={locality}
          options={[
            { value: "all", label: "Todas las localidades" },
            ...localities.map((item) => ({ value: item, label: item }))
          ]}
          placeholder="Localidad"
          onChange={setLocality}
        />
      </EntityToolbar>
      <section className="sp-section-card wide">
        {error ? <ErrorState text={error} /> : null}
        {isLoading ? <LoadingState text="Cargando asegurados" /> : null}
        {!isLoading && view === "grid" ? (
          <div className="sp-card-grid">
            {filtered.map((client, index) => (
              <ClientCard key={client.id} client={client} policies={policies} color={AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#1d4ed8"} onSelect={onOpenClient} />
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel embedded">
            {filtered.length > 0 ? (
              <div className="sp-list-header entity">
                <span>Asegurado</span>
                <span>Localidad</span>
                <span>Pólizas</span>
              </div>
            ) : null}
            {filtered.map((client, index) => (
              <ClientRow key={client.id} client={client} policies={policies} color={AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#1d4ed8"} onSelect={onOpenClient} />
            ))}
          </div>
        ) : null}
        {!isLoading && filtered.length === 0 ? <EmptyState title="No se encontraron asegurados" text="Probá ajustar la búsqueda o crear un nuevo asegurado." /> : null}
      </section>
      <Modal title="Nuevo asegurado" isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <form
          className="sp-form sp-modal-form"
          onSubmit={async (event) => {
            try {
              await onSubmit(event);
              setIsModalOpen(false);
            } catch {
              // parent mutation state renders the error
            }
          }}
        >
          <div className="sp-form-section">
            <h3>Datos personales</h3>
            <label className="sp-field"><span>Nombre completo</span><input name="fullName" placeholder="Nombre y apellido" required /></label>
          </div>
          <div className="sp-form-grid">
            <label className="sp-field"><span>Teléfono</span><input name="phone" placeholder="Teléfono" /></label>
            <label className="sp-field"><span>Email</span><input name="email" type="email" placeholder="correo@dominio.com" /></label>
          </div>
          <div className="sp-form-grid">
            <label className="sp-field"><span>DNI</span><input name="dni" placeholder="Documento" /></label>
            <LocalityCombobox name="locality" />
          </div>
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setIsModalOpen(false)} disabled={isCreating}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isCreating}>
              {isCreating ? <span className="sp-button-spinner" aria-hidden="true" /> : <Plus size={14} />}
              {isCreating ? "Cargando..." : "Agregar asegurado"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ClientCard({
  client,
  policies,
  color,
  onSelect
}: {
  client: Client;
  policies: Policy[];
  color: string;
  onSelect: (client: Client) => void;
}) {
  const count = policies.filter((policy) => policy.clients?.id === client.id).length;
  return (
    <article className="sp-entity-card is-clickable" role="button" tabIndex={0} onClick={() => onSelect(client)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(client); } }}>
      <div className="sp-entity-head">
        <div className="sp-avatar" style={{ backgroundColor: color }}>{initials(client.full_name)}</div>
        <div>
          <h3>{client.full_name}</h3>
          {client.locality ? <p><MapPin size={12} />{client.locality}</p> : null}
        </div>
      </div>
      <div className="sp-entity-lines">
        {client.phone ? <span><Phone size={14} />{client.phone}</span> : null}
        {client.email ? <span><Mail size={14} />{client.email}</span> : null}
      </div>
      <div className="sp-entity-footer">
        <FileText size={14} />
        <span>{count} póliza{count === 1 ? "" : "s"}</span>
      </div>
    </article>
  );
}

function ClientRow({
  client,
  policies,
  color,
  onSelect
}: {
  client: Client;
  policies: Policy[];
  color: string;
  onSelect: (client: Client) => void;
}) {
  const count = policies.filter((policy) => policy.clients?.id === client.id).length;
  return (
    <div className="sp-list-row entity client is-clickable" role="button" tabIndex={0} onClick={() => onSelect(client)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(client); } }}>
      <div className="sp-avatar small" style={{ backgroundColor: color }}>{initials(client.full_name)}</div>
      <div className="sp-list-main">
        <strong>{client.full_name}</strong>
        <span>{client.phone ?? client.email ?? client.dni ?? "Sin contacto"}</span>
      </div>
      <span>{client.locality ?? "-"}</span>
      <span className="sp-branch-tag">{count} pólizas</span>
    </div>
  );
}

function ClientDetailScreen({
  client,
  policies,
  common,
  currentUserId,
  isSavingClient,
  isDeletingClient,
  noteApi,
  policyActions,
  initialOpenPolicyId,
  onBack,
  onSaveClient,
  onDeleteClient
}: {
  client: Client | null;
  policies: Policy[];
  common: { token: string | undefined; organizationSlug: string };
  currentUserId: string;
  isSavingClient: boolean;
  isDeletingClient: boolean;
  noteApi: NoticeNoteApi;
  policyActions: PolicyActions;
  initialOpenPolicyId: string | null;
  onBack: () => void;
  onSaveClient: (patch: Record<string, unknown>) => Promise<unknown>;
  onDeleteClient: () => Promise<unknown>;
}) {
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null);
  const [openPolicyId, setOpenPolicyId] = useState<string | null>(initialOpenPolicyId);
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [deleteClientOpen, setDeleteClientOpen] = useState(false);
  const [deletePolicyTarget, setDeletePolicyTarget] = useState<Policy | null>(null);

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[color:var(--org-primary)] transition-colors hover:opacity-80"
    >
      <ArrowLeft size={16} />
      Volver a asegurados
    </button>
  );

  if (!client) {
    return (
      <div className="sp-page padded flex flex-col gap-5 p-6">
        {backButton}
        <EmptyState title="Asegurado no encontrado" text="Puede que la lista se haya actualizado." />
      </div>
    );
  }

  const clientPolicies = policies.filter((policy) => policy.clients?.id === client.id);
  const color = AVATAR_COLORS[(client.full_name.charCodeAt(0) || 0) % AVATAR_COLORS.length] ?? "#1d4ed8";

  return (
    <div className="sp-page padded flex flex-col gap-6 p-6">
      {backButton}

      <ClientDetailHeader
        client={client}
        color={color}
        isSaving={isSavingClient}
        onSaveClient={onSaveClient}
        onEditClient={() => setEditClientOpen(true)}
        onDeleteClient={() => setDeleteClientOpen(true)}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <h2 className="m-0 text-lg font-semibold text-slate-900">Pólizas</h2>
          <span className="text-xs font-medium text-slate-500">
            {clientPolicies.length} {clientPolicies.length === 1 ? "póliza" : "pólizas"}
          </span>
        </div>
        {clientPolicies.length === 0 ? (
          <EmptyState title="Sin pólizas" text="Este asegurado todavía no tiene pólizas cargadas." compact />
        ) : (
          <div className="flex flex-col gap-3">
            {clientPolicies.map((policy) => (
              <PolicyHistoryPanel
                key={policy.id}
                policy={policy}
                common={common}
                currentUserId={currentUserId}
                noteApi={noteApi}
                isDeleting={policyActions.isDeleting}
                open={openPolicyId === policy.id}
                onToggle={() => setOpenPolicyId((current) => (current === policy.id ? null : policy.id))}
                onEdit={setEditPolicy}
                onDelete={setDeletePolicyTarget}
              />
            ))}
          </div>
        )}
      </section>

      <PolicyFormModal
        key={editPolicy?.id ?? "client-policy-edit"}
        title="Editar póliza"
        submitLabel="Guardar cambios"
        isOpen={Boolean(editPolicy)}
        policy={editPolicy}
        clients={policyActions.clients}
        companies={policyActions.companies}
        isSaving={policyActions.isSaving}
        onClose={() => setEditPolicy(null)}
        onSubmit={async (values) => {
          if (!editPolicy) return;
          await policyActions.onUpdate(editPolicy.id, values);
          setEditPolicy(null);
        }}
      />

      <ClientFormModal
        key={editClientOpen ? `client-edit-${client.id}` : "client-edit-closed"}
        isOpen={editClientOpen}
        client={client}
        isSaving={isSavingClient}
        onClose={() => setEditClientOpen(false)}
        onSubmit={async (patch) => {
          await onSaveClient(patch);
          setEditClientOpen(false);
        }}
      />

      <ConfirmDialog
        isOpen={deleteClientOpen}
        title="Eliminar asegurado"
        message={`¿Seguro que querés eliminar a ${client.full_name}? Se ocultarán también sus pólizas y avisos. Esta acción se puede revertir desde la base de datos.`}
        confirmLabel="Eliminar asegurado"
        isBusy={isDeletingClient}
        onClose={() => setDeleteClientOpen(false)}
        onConfirm={async () => {
          await onDeleteClient();
          setDeleteClientOpen(false);
          onBack();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deletePolicyTarget)}
        title="Eliminar póliza"
        message={
          deletePolicyTarget
            ? `¿Eliminar la póliza ${deletePolicyTarget.policy_number ? `#${deletePolicyTarget.policy_number}` : ""} de ${deletePolicyTarget.branch}? Se ocultará junto con sus avisos.`
            : ""
        }
        confirmLabel="Eliminar póliza"
        isBusy={policyActions.isDeleting}
        onClose={() => setDeletePolicyTarget(null)}
        onConfirm={async () => {
          if (!deletePolicyTarget) return;
          await policyActions.onDelete(deletePolicyTarget.id);
          setDeletePolicyTarget(null);
        }}
      />
    </div>
  );
}

function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  isBusy,
  onClose,
  onConfirm
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} isOpen={isOpen} onClose={() => (isBusy ? undefined : onClose())}>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle size={18} />
          </span>
          <p className="m-0 text-sm leading-relaxed text-slate-600">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="sp-secondary-action" onClick={onClose} disabled={isBusy}>
            Cancelar
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ClientFormModal({
  isOpen,
  client,
  isSaving,
  onClose,
  onSubmit
}: {
  isOpen: boolean;
  client: Client;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const [fullName, setFullName] = useState(client.full_name);
  const [phone, setPhone] = useState(client.phone ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [dni, setDni] = useState(client.dni ?? "");
  const [locality, setLocality] = useState(client.locality ?? "");
  const [address, setAddress] = useState(client.address ?? "");
  const [birthDate, setBirthDate] = useState(client.birth_date ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="Editar asegurado" isOpen={isOpen} onClose={onClose}>
      <form
        className="sp-form sp-modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          if (!fullName.trim()) {
            setError("El nombre es obligatorio.");
            return;
          }
          try {
            await onSubmit({
              fullName: fullName.trim(),
              phone: phone.trim() || null,
              email: email.trim() || null,
              dni: dni.trim() || null,
              locality: locality.trim() || null,
              address: address.trim() || null,
              birthDate: birthDate || null
            });
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "No se pudo actualizar el asegurado.");
          }
        }}
      >
        <div className="sp-form-section">
          <h3>Datos personales</h3>
          <label className="sp-field">
            <span>Nombre completo</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nombre y apellido" />
          </label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>Teléfono</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Teléfono" />
          </label>
          <label className="sp-field">
            <span>Email</span>
            <input value={email} type="email" onChange={(event) => setEmail(event.target.value)} placeholder="correo@dominio.com" />
          </label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>DNI</span>
            <input value={dni} onChange={(event) => setDni(event.target.value)} placeholder="Documento" />
          </label>
          <label className="sp-field">
            <span>Localidad</span>
            <input value={locality} onChange={(event) => setLocality(event.target.value)} placeholder="Localidad" />
          </label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>Dirección</span>
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Dirección" />
          </label>
          <label className="sp-field">
            <span>Nacimiento</span>
            <DatePicker value={birthDate} onChange={setBirthDate} ariaLabel="Fecha de nacimiento" />
          </label>
        </div>
        {error ? <div className="sp-pay-error">{error}</div> : null}
        <div className="sp-modal-actions">
          <button type="button" className="sp-secondary-action" onClick={onClose} disabled={isSaving}>
            Cancelar
          </button>
          <button type="submit" className="sp-primary-action" disabled={isSaving}>
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar cambios
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClientDetailHeader({
  client,
  color,
  isSaving,
  onSaveClient,
  onEditClient,
  onDeleteClient
}: {
  client: Client;
  color: string;
  isSaving: boolean;
  onSaveClient: (patch: Record<string, unknown>) => Promise<unknown>;
  onEditClient: () => void;
  onDeleteClient: () => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(client.notes ?? "");

  const fields: Array<{ icon: typeof Phone; label: string; value: string | null; href: string | null }> = [
    { icon: Phone, label: "Teléfono", value: client.phone, href: client.phone ? `tel:${client.phone}` : null },
    { icon: Mail, label: "Email", value: client.email, href: client.email ? `mailto:${client.email}` : null },
    { icon: Hash, label: "DNI", value: client.dni, href: null },
    { icon: MapPin, label: "Localidad", value: client.locality, href: null },
    { icon: MapPin, label: "Dirección", value: client.address, href: null },
    { icon: CalendarDays, label: "Nacimiento", value: client.birth_date ? formatDate(client.birth_date) : null, href: null }
  ];

  const visibleFields = fields.filter((field) => field.value);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-sm sm:h-16 sm:w-16 sm:text-xl"
          style={{ backgroundColor: color }}
        >
          {initials(client.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-xl font-bold text-slate-900 sm:text-2xl">{client.full_name}</h2>
          {client.locality ? (
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
              <MapPin size={14} />
              {client.locality}
            </p>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEditClient}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Edit3 size={14} />
            Editar
          </button>
          <button
            type="button"
            onClick={onDeleteClient}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>
      </div>

      {visibleFields.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          {visibleFields.map((field) => {
            const Icon = field.icon;
            return (
              <div key={field.label} className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <Icon size={13} />
                  {field.label}
                </span>
                {field.href ? (
                  <a className="truncate text-sm font-medium text-slate-800 transition-colors hover:text-[color:var(--org-primary)]" href={field.href}>
                    {field.value}
                  </a>
                ) : (
                  <span className="truncate text-sm font-medium text-slate-800">{field.value}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Nota del asegurado</span>
          {!editingNote ? (
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-semibold text-[color:var(--org-primary)] transition-colors hover:opacity-80"
              onClick={() => {
                setDraft(client.notes ?? "");
                setEditingNote(true);
              }}
            >
              <Edit3 size={12} />
              {client.notes ? "Editar" : "Agregar"}
            </button>
          ) : null}
        </div>
        {editingNote ? (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={draft}
              rows={2}
              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-[color:var(--org-primary)]"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Escribí una nota sobre este asegurado..."
              disabled={isSaving}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="sp-secondary-action" onClick={() => setEditingNote(false)} disabled={isSaving}>
                Cancelar
              </button>
              <button
                type="button"
                className="sp-primary-action"
                disabled={isSaving}
                onClick={async () => {
                  await onSaveClient({ notes: draft.trim() || null });
                  setEditingNote(false);
                }}
              >
                {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Guardar
              </button>
            </div>
          </div>
        ) : client.notes ? (
          <p className="mt-1.5 whitespace-pre-line text-[13px] leading-snug text-slate-600">{client.notes}</p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-400">Sin notas todavía.</p>
        )}
      </div>
    </section>
  );
}

function PolicyHistoryPanel({
  policy,
  common,
  currentUserId,
  noteApi,
  isDeleting,
  open,
  onToggle,
  onEdit,
  onDelete
}: {
  policy: Policy;
  common: { token: string | undefined; organizationSlug: string };
  currentUserId: string;
  noteApi: NoticeNoteApi;
  isDeleting: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: (policy: Policy) => void;
  onDelete: (policy: Policy) => void;
}) {
  const history = useQuery({
    queryKey: ["policy-notices", policy.id],
    enabled: open,
    queryFn: () => apiRequest<Notice[]>(`/policies/${policy.id}/notices`, common)
  });

  const notices = history.data ?? [];
  const payments = notices.filter((notice) => notice.status === "pagado");

  const infoItems = [
    { label: "Compañía", value: policy.insurance_companies?.name ?? "-" },
    { label: "Rama", value: policy.branch },
    { label: "N° de póliza", value: policy.policy_number || "-" },
    { label: "Patente", value: policy.vehicle_plate || "-" },
    { label: "Periodicidad", value: intervalLabel(policy.payment_interval_months) },
    { label: "Primer pago", value: policy.first_payment_date ? formatDate(policy.first_payment_date) : "-" }
  ];

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 pr-3 transition-colors hover:bg-slate-50">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left"
          onClick={onToggle}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--org-primary-soft)] text-[color:var(--org-primary)]">
            <FileText size={17} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <strong className="truncate text-sm font-semibold text-slate-900">
              {policy.branch} · {policy.insurance_companies?.name ?? "Sin compañía"}
            </strong>
            <span className="truncate text-xs text-slate-500">
              {policy.policy_number ? `#${policy.policy_number}` : "Sin N°"}
              {policy.vehicle_plate ? ` · ${policy.vehicle_plate}` : ""}
              {` · ${intervalLabel(policy.payment_interval_months)}`}
            </span>
          </div>
          <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <PolicyActionButtons policy={policy} isDeleting={isDeleting} onEdit={onEdit} onDelete={onDelete} compact />
      </div>

      {open ? (
        <div className="flex flex-col gap-5 border-t border-slate-100 bg-slate-50/70 p-4">
          {history.isLoading ? <LoadingState text="Cargando historial" /> : null}
          {history.error ? <ErrorState text={history.error.message} /> : null}
          {!history.isLoading && !history.error ? (
            <>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
                {infoItems.map((item) => (
                  <div key={item.label} className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</span>
                    <strong className="text-sm font-medium text-slate-800">{item.value}</strong>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">Historial de pagos</h4>
                {payments.length === 0 ? (
                  <p className="m-0 text-xs text-slate-400">Todavía no hay pagos registrados.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {payments.map((payment) => (
                      <div key={payment.id} className="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                          <CheckCircle size={15} />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <strong className="text-sm font-semibold text-slate-900">Vto. {formatDate(payment.due_date)}</strong>
                          <span className="truncate text-xs text-slate-500">
                            {payment.paid_interval_months ? `${intervalLabel(payment.paid_interval_months)}` : "Pago"}
                            {payment.payment_processed_by ? ` · cobró ${payment.payment_processed_by.full_name}` : ""}
                          </span>
                        </div>
                        {payment.payment_processed_at ? (
                          <em className="shrink-0 text-[11px] not-italic text-slate-400">{formatDate(payment.payment_processed_at.slice(0, 10))}</em>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">Historial de avisos</h4>
                {notices.length === 0 ? (
                  <p className="m-0 text-xs text-slate-400">Sin avisos para esta póliza.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {notices.map((notice) => (
                      <div key={notice.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: NOTICE_COLUMNS.find((column) => column.key === notice.status)?.dot }} />
                          <strong className="text-sm font-semibold text-slate-900">Vto. {formatDate(notice.due_date)}</strong>
                          <span className={noticeStatusPill(notice.status)}>{noticeStatusLabel(notice.status)}</span>
                          {notice.notified_by ? <em className="text-[11px] not-italic text-slate-400">Avisó {notice.notified_by.full_name}</em> : null}
                        </div>
                        <NoticeNotes notice={notice} noteApi={{ ...noteApi, currentUserId }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function noticeStatusLabel(status: Notice["status"]) {
  if (status === "avisar") return "Avisar";
  if (status === "avisado") return "Avisado";
  return "Pagado";
}

function noticeStatusPill(status: Notice["status"]) {
  const base = "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase";
  if (status === "avisar") return `${base} bg-amber-50 text-amber-700`;
  if (status === "avisado") return `${base} bg-blue-50 text-blue-700`;
  return `${base} bg-emerald-50 text-emerald-700`;
}

function PoliciesView({
  policies,
  clients,
  companies,
  isLoading,
  isCreating,
  error,
  onCreate,
  onOpenPolicy
}: {
  policies: Policy[];
  clients: Client[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  onCreate: (values: PolicyFormValues) => Promise<unknown>;
  onOpenPolicy: (policy: Policy) => void;
}) {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [view, setView] = useState<EntityView>(() => readView("sp-policies-view", "list"));
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const branches = Array.from(new Set([...BRANCHES, ...policies.map((policy) => policy.branch)])).sort();
  const filtered = policies.filter((policy) => {
    const term = search.toLowerCase();
    const matchesSearch =
      !term ||
      policy.clients?.full_name?.toLowerCase().includes(term) ||
      policy.policy_number?.toLowerCase().includes(term) ||
      policy.vehicle_plate?.toLowerCase().includes(term);
    const matchesBranch = branch === "all" || policy.branch === branch;
    const matchesCompany = companyId === "all" || policy.insurance_companies?.id === companyId;
    return matchesSearch && matchesBranch && matchesCompany;
  });

  return (
    <div className="sp-page padded">
      <div className="sp-entity-toolbar">
        <div className="sp-search">
          <Search size={15} />
          <input placeholder="Asegurado, N° póliza, patente..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select value={branch} onChange={(event) => setBranch(event.target.value)}>
          <option value="all">Todas las ramas</option>
          {branches.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <SearchableSelect
          value={companyId}
          options={[
            { value: "all", label: "Todas las compañías" },
            ...companies.map((company) => ({ value: company.id, label: company.name }))
          ]}
          placeholder="Compañía"
          onChange={setCompanyId}
        />
        <span>{filtered.length} de {policies.length}</span>
        <ViewToggle
          leftLabel="Grid"
          rightLabel="Lista"
          value={view}
          leftValue="grid"
          rightValue="list"
          onChange={(next) => {
            setView(next);
            writeView("sp-policies-view", next);
          }}
        />
        <button className="sp-primary-action" type="button" onClick={() => setIsCreateOpen(true)}>
          <Plus size={14} />
          Nueva póliza
        </button>
      </div>

      <section className="sp-section-card wide">
        {error ? <ErrorState text={error} /> : null}
        {isLoading ? <LoadingState text="Cargando pólizas" /> : null}
        {!isLoading && view === "grid" ? (
          <div className="sp-card-grid">
            {filtered.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} onOpen={onOpenPolicy} />
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel embedded">
            {filtered.map((policy) => (
              <PolicyRow key={policy.id} policy={policy} onOpen={onOpenPolicy} />
            ))}
          </div>
        ) : null}
        {!isLoading && filtered.length === 0 ? <EmptyState title="No hay pólizas para mostrar" text="Probá limpiar los filtros o cargar una nueva póliza." /> : null}
      </section>

      <PolicyFormModal
        key="policy-create"
        title="Nueva póliza"
        submitLabel="Guardar póliza"
        isOpen={isCreateOpen}
        policy={null}
        clients={clients}
        companies={companies}
        isSaving={isCreating}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={async (values) => {
          await onCreate(values);
          setIsCreateOpen(false);
        }}
      />
    </div>
  );
}

function PolicyFormModal({
  title,
  submitLabel,
  isOpen,
  policy,
  clients,
  companies,
  isSaving,
  onClose,
  onSubmit
}: {
  title: string;
  submitLabel: string;
  isOpen: boolean;
  policy: Policy | null;
  clients: Client[];
  companies: InsuranceCompany[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: PolicyFormValues) => Promise<unknown>;
}) {
  const [clientId, setClientId] = useState(policy?.clients?.id ?? "");
  const [companyId, setCompanyId] = useState(policy?.insurance_companies?.id ?? "");
  const [branch, setBranch] = useState(policy?.branch ?? "");
  const [policyNumber, setPolicyNumber] = useState(policy?.policy_number ?? "");
  const [vehiclePlate, setVehiclePlate] = useState(policy?.vehicle_plate ?? "");
  const [months, setMonths] = useState<number>(policy?.payment_interval_months ?? 1);
  const [date, setDate] = useState(policy?.first_payment_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const branches = Array.from(new Set([...BRANCHES, ...(branch ? [branch] : [])]));

  return (
    <Modal title={title} isOpen={isOpen} onClose={onClose}>
      <form
        className="sp-form sp-modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          if (!clientId || !companyId || !branch || !policyNumber.trim() || !date) {
            setError("Completá asegurado, compañía, rama, número y vencimiento.");
            return;
          }
          try {
            await onSubmit({
              clientId,
              insuranceCompanyId: companyId,
              branch,
              policyNumber: policyNumber.trim(),
              vehiclePlate: vehiclePlate.trim(),
              paymentIntervalMonths: months,
              firstPaymentDate: date
            });
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "No se pudo guardar la póliza.");
          }
        }}
      >
        <div className="sp-form-section">
          <h3>Relación comercial</h3>
          <div className="sp-form-grid">
            <SearchableSelect
              label="Asegurado"
              value={clientId}
              onChange={setClientId}
              options={clients.map((client) => ({ value: client.id, label: client.full_name }))}
              placeholder="Buscar asegurado"
            />
            <SearchableSelect
              label="Compañía"
              value={companyId}
              onChange={setCompanyId}
              options={companies.map((company) => ({ value: company.id, label: company.name }))}
              placeholder="Buscar compañía"
            />
          </div>
        </div>
        <div className="sp-form-section">
          <h3>Datos de póliza</h3>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>Rama</span>
            <select value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option value="">Seleccionar rama</option>
              {branches.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="sp-field">
            <span>Número</span>
            <input value={policyNumber} onChange={(event) => setPolicyNumber(event.target.value)} placeholder="Número de póliza" />
          </label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>Patente</span>
            <input value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value)} placeholder="Opcional" />
          </label>
          <label className="sp-field">
            <span>Periodicidad</span>
            <select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{intervalLabel(value)}</option>)}
            </select>
          </label>
        </div>
        <label className="sp-field">
          <span>Primer vencimiento</span>
          <DatePicker value={date} onChange={setDate} ariaLabel="Primer vencimiento" />
        </label>
        {error ? <div className="sp-pay-error">{error}</div> : null}
        <div className="sp-modal-actions">
          <button className="sp-secondary-action" type="button" onClick={onClose} disabled={isSaving}>Cancelar</button>
          <button className="sp-primary-action" type="submit" disabled={isSaving}>
            {isSaving ? <span className="sp-button-spinner" aria-hidden="true" /> : <Save size={14} />}
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PolicyActionButtons({
  policy,
  isDeleting,
  onEdit,
  onDelete,
  compact
}: {
  policy: Policy;
  isDeleting: boolean;
  onEdit: (policy: Policy) => void;
  onDelete: (policy: Policy) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "flex shrink-0 items-center gap-1" : "flex gap-2"}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(policy);
        }}
        className={
          compact
            ? "flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            : "inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        }
        aria-label="Editar póliza"
      >
        <Edit3 size={14} />
        {compact ? null : "Editar"}
      </button>
      <button
        type="button"
        disabled={isDeleting}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(policy);
        }}
        className={
          compact
            ? "flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            : "inline-flex items-center justify-center gap-1 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
        }
        aria-label="Eliminar póliza"
      >
        <Trash2 size={14} />
        {compact ? null : "Eliminar"}
      </button>
    </div>
  );
}

function PolicyCard({ policy, onOpen }: { policy: Policy; onOpen: (policy: Policy) => void }) {
  return (
    <article
      className="sp-entity-card policy is-clickable"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(policy)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(policy);
        }
      }}
    >
      <div className="sp-entity-head">
        <div className="sp-icon-box"><ShieldCheck size={18} /></div>
        <div>
          <h3>{policy.branch}</h3>
          <p>{policy.insurance_companies?.name ?? "Sin compañía"}</p>
        </div>
      </div>
      <div className="sp-entity-lines">
        <span><User size={14} />{policy.clients?.full_name ?? "Sin cliente"}</span>
        <span><Hash size={14} />{policy.policy_number}</span>
        {policy.vehicle_plate ? <span>{policy.vehicle_plate}</span> : null}
      </div>
      <div className="sp-entity-footer">
        <CalendarDays size={14} />
        <span>{formatDate(policy.first_payment_date)}</span>
      </div>
    </article>
  );
}

function PolicyRow({ policy, onOpen }: { policy: Policy; onOpen: (policy: Policy) => void }) {
  return (
    <div
      className="sp-list-row entity policy is-clickable"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(policy)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(policy);
        }
      }}
    >
      <div className="sp-icon-box small"><ShieldCheck size={15} /></div>
      <div className="sp-list-main">
        <strong>{policy.clients?.full_name ?? "Sin cliente"}</strong>
        <span>{policy.insurance_companies?.name ?? "Sin compañía"} · #{policy.policy_number}</span>
      </div>
      <span className="sp-branch-tag">{policy.branch}</span>
      <span>{policy.vehicle_plate ?? "-"}</span>
      <span>{formatDate(policy.first_payment_date)}</span>
      <ChevronRight className="ml-auto shrink-0 text-slate-300" size={16} />
    </div>
  );
}

function CompaniesView({
  companies,
  policies,
  isLoading,
  isCreating,
  error,
  onSubmit
}: {
  companies: InsuranceCompany[];
  policies: Policy[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="sp-page padded">
      <div className="sp-company-header">
        <div>
          <h2>Compañías</h2>
          <p>Gestión de entidades aseguradoras.</p>
        </div>
        <button className="sp-primary-action" type="button" onClick={() => setIsModalOpen(true)}>
          <Plus size={15} />
          Nueva compañía
        </button>
      </div>
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando compañías" /> : null}
      {!isLoading && companies.length === 0 ? (
        <EmptyState title="No hay compañías cargadas" text="Agregá una compañía para asociarla a nuevas pólizas." />
      ) : null}
      {!isLoading && companies.length > 0 ? (
        <div className="sp-company-grid">
          {companies.map((company, index) => {
            const count = policies.filter((policy) => policy.insurance_companies?.id === company.id).length;
            return (
              <article key={company.id} className="sp-company-card">
                <div className="sp-avatar company" style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}>
                  {initials(company.name)}
                </div>
                <div>
                  <h3>{company.name}</h3>
                  <p>{count} póliza{count === 1 ? "" : "s"} activa{count === 1 ? "" : "s"}</p>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      <Modal title="Nueva compañía" isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <form
          className="sp-form"
          onSubmit={async (event) => {
            try {
              await onSubmit(event);
              setIsModalOpen(false);
            } catch {
              // parent mutation state renders the error
            }
          }}
        >
          <label className="sp-field"><span>Nombre</span><input name="name" placeholder="Nombre de la compañía" required /></label>
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setIsModalOpen(false)} disabled={isCreating}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isCreating}>
              {isCreating ? <span className="sp-button-spinner" aria-hidden="true" /> : <Plus size={14} />}
              {isCreating ? "Cargando..." : "Agregar compañía"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function SettingsView({
  organization,
  fallbackOrganization,
  isLoading,
  isSaving,
  error,
  onUploadLogo,
  onSubmit
}: {
  organization: OrganizationSettings | undefined;
  fallbackOrganization: AuthState["organizations"][number] | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onUploadLogo: (payload: UploadLogoPayload) => Promise<{ url: string }>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const displayName = organization?.display_name ?? fallbackOrganization?.displayName ?? "";
  const initialPrimaryColor = organization?.primary_color ?? fallbackOrganization?.primaryColor ?? "#127c72";
  const initialSecondaryColor = organization?.secondary_color ?? fallbackOrganization?.secondaryColor ?? "#64748b";
  const initialLogoUrl = organization?.logo_url ?? fallbackOrganization?.logoUrl ?? null;
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor);
  const [secondaryColor, setSecondaryColor] = useState(initialSecondaryColor);
  const [uploadingKind, setUploadingKind] = useState<UploadLogoPayload["kind"] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setLogoUrl(initialLogoUrl);
      setPrimaryColor(initialPrimaryColor);
      setSecondaryColor(initialSecondaryColor);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialLogoUrl, initialPrimaryColor, initialSecondaryColor]);

  const handleUploadLogo = async (file: File, kind: UploadLogoPayload["kind"]) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("El logo debe ser una imagen.");
      return;
    }

    if (file.size > LOGO_MAX_SIZE_BYTES) {
      setUploadError("El logo debe pesar 5 MB o menos.");
      return;
    }

    setUploadError(null);
    setUploadingKind(kind);
    try {
      const result = await onUploadLogo({ file, kind });
      setLogoUrl(result.url);
    } catch (uploadError) {
      setUploadError(uploadError instanceof Error ? uploadError.message : "No se pudo subir el logo.");
    } finally {
      setUploadingKind(null);
    }
  };

  const primaryPickerColor = isHexColor(primaryColor) ? primaryColor : "#000000";
  const secondaryPickerColor = isHexColor(secondaryColor) ? secondaryColor : "#000000";

  return (
    <div className="sp-page padded sp-settings-page">
      <div className="sp-settings-header">
        <div>
          <h2>Configuración de organización</h2>
          <p>Personaliza la apariencia y los datos institucionales de tu espacio de trabajo.</p>
        </div>
        <button className="sp-primary-action sp-settings-header-action" type="submit" form="organization-settings-form" disabled={isSaving || isLoading}>
          <Save size={15} />
          {isLoading || isSaving ? "Cargando..." : "Guardar configuración"}
        </button>
      </div>

      <div className="sp-settings-grid">
        <form
          id="organization-settings-form"
          key={`${organization?.id ?? fallbackOrganization?.id ?? "organization"}-${organization?.display_name ?? displayName}`}
          className="sp-form sp-settings-form"
          onSubmit={onSubmit}
        >
          <section className="sp-section-card">
            <div className="sp-section-title">
              <span className="sp-section-icon"><Building2 size={21} /></span>
              <div>
                <h2>Datos institucionales</h2>
                <span>Nombre comercial y canales de contacto para tus clientes</span>
              </div>
            </div>
            <label className="sp-field sp-field-wide">
              <span>Nombre comercial</span>
              <input name="displayName" defaultValue={displayName} placeholder="Nombre de la organización" required />
              <small>Así es como te verán tus clientes.</small>
            </label>
            <div className="sp-form-grid">
              <label className="sp-field">
                <span>Email de soporte</span>
                <input name="supportEmail" type="email" defaultValue={organization?.support_email ?? ""} placeholder="soporte@dominio.com" />
              </label>
              <label className="sp-field">
                <span>Teléfono de soporte</span>
                <input name="supportPhone" defaultValue={organization?.support_phone ?? ""} placeholder="+54..." />
              </label>
            </div>
          </section>

          <section className="sp-section-card">
            <div className="sp-section-title">
              <span className="sp-section-icon tertiary"><Palette size={21} /></span>
              <div>
                <h2>Marca y colores</h2>
                <span>El mismo logo se utiliza en login, sidebar y panel</span>
              </div>
            </div>
            <input name="logoUrl" type="hidden" value={logoUrl ?? ""} readOnly />
            <span className="sp-upload-title">Logo principal</span>
            <div className="sp-logo-upload-grid">
              <LogoDropzone
                title="Haz clic o arrastra una imagen"
                previewUrl={logoUrl}
                isUploading={uploadingKind === "main"}
                onFile={(file) => handleUploadLogo(file, "main")}
              />
            </div>
            <div className="sp-form-grid">
              <label className="sp-field">
                <span>Color principal</span>
                <div className="sp-color-input">
                  <input aria-label="Selector de color principal" type="color" value={primaryPickerColor} onChange={(event) => setPrimaryColor(event.currentTarget.value)} />
                  <input name="primaryColor" type="text" value={primaryColor} onChange={(event) => setPrimaryColor(event.currentTarget.value.toUpperCase())} spellCheck={false} />
                </div>
              </label>
              <label className="sp-field">
                <span>Color secundario</span>
                <div className="sp-color-input">
                  <input aria-label="Selector de color secundario" type="color" value={secondaryPickerColor} onChange={(event) => setSecondaryColor(event.currentTarget.value)} />
                  <input name="secondaryColor" type="text" value={secondaryColor} onChange={(event) => setSecondaryColor(event.currentTarget.value.toUpperCase())} spellCheck={false} />
                </div>
              </label>
            </div>
            {uploadError ? <div className="sp-error">{uploadError}</div> : null}
          </section>

          {error ? <div className="sp-error">{error}</div> : null}
          <div className="sp-settings-actions">
            <button className="sp-primary-action" type="submit" disabled={isSaving || isLoading}>
              <Save size={15} />
              {isLoading || isSaving ? "Cargando..." : "Guardar configuración"}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}

function TeamView({
  currentUserId,
  team,
  isLoading,
  isAdding,
  isUpdating,
  error,
  onAddTeamMember,
  onUpdateTeamMember,
  onChangeTeamMemberPassword,
  onDeactivateTeamMember,
  onNotify
}: {
  currentUserId: string;
  team: OrganizationTeamMember[];
  isLoading: boolean;
  isAdding: boolean;
  isUpdating: boolean;
  error: string | null;
  onAddTeamMember: (payload: CreateOrganizationTeamMemberPayload) => Promise<OrganizationTeamMember>;
  onUpdateTeamMember: (memberId: string, payload: UpdateOrganizationTeamMemberPayload) => Promise<OrganizationTeamMember>;
  onChangeTeamMemberPassword: (
    memberId: string,
    payload: ChangeOrganizationTeamMemberPasswordPayload
  ) => Promise<OrganizationTeamMember>;
  onDeactivateTeamMember: (memberId: string, payload: DeactivateOrganizationTeamMemberPayload) => Promise<OrganizationTeamMember>;
  onNotify: (message: string, tone?: ToastMessage["tone"]) => void;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<OrganizationTeamMember | null>(null);
  const [passwordMember, setPasswordMember] = useState<OrganizationTeamMember | null>(null);
  const [deletingMember, setDeletingMember] = useState<OrganizationTeamMember | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showMemberPassword, setShowMemberPassword] = useState(false);
  const [showProducerPassword, setShowProducerPassword] = useState(false);
  const [isAuthorizingAction, setIsAuthorizingAction] = useState(false);
  const [pendingAuthorization, setPendingAuthorization] = useState<{
    title: string;
    description: ReactNode;
    confirmLabel: string;
    tone?: "danger";
    onConfirm: (producerPassword: string) => Promise<void>;
  } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    // Capturamos el form antes del await: React anula event.currentTarget al
    // terminar el handler, y leerlo después tira "Cannot read properties of null".
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const fullName = String(form.get("fullName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    const role = String(form.get("role") ?? "asesor") as CreateOrganizationTeamMemberPayload["role"];

    if (password !== confirmPassword) {
      setFormError("Las contraseñas no coinciden.");
      return;
    }

    await onAddTeamMember({ fullName, email, role, password });
    onNotify(`${fullName} fue creado en el equipo como ${roleLabel(role)}.`);
    formElement.reset();
    setIsModalOpen(false);
  };

  const handleUpdateMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingMember) return;
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("fullName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "asesor") as UpdateOrganizationTeamMemberPayload["role"];
    const memberId = editingMember.id;
    setEditingMember(null);
    setPendingAuthorization({
      title: "Confirmar edición",
      description: <>Vas a actualizar los datos de <strong>{editingMember.fullName}</strong>.</>,
      confirmLabel: "Guardar cambios",
      onConfirm: async (producerPassword) => {
        await onUpdateTeamMember(memberId, { fullName, email, role, producerPassword });
        onNotify(`${fullName} fue actualizado.`);
      }
    });
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordMember) return;
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setFormError("Las contraseñas no coinciden.");
      return;
    }
    const memberId = passwordMember.id;
    const memberName = passwordMember.fullName;
    setPasswordMember(null);
    setPendingAuthorization({
      title: "Confirmar cambio de contraseña",
      description: <>Vas a cambiar la contraseña de <strong>{memberName}</strong>.</>,
      confirmLabel: "Cambiar contraseña",
      onConfirm: async (producerPassword) => {
        await onChangeTeamMemberPassword(memberId, { password, producerPassword });
        onNotify(`Se actualizó la contraseña de ${memberName}.`);
      }
    });
  };

  const handleDeactivateMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deletingMember) return;
    setFormError(null);
    const memberId = deletingMember.id;
    const memberName = deletingMember.fullName;
    setDeletingMember(null);
    setPendingAuthorization({
      title: "Confirmar eliminación",
      description: <>Se dará de baja a <strong>{memberName}</strong> de esta organización.</>,
      confirmLabel: "Eliminar",
      tone: "danger",
      onConfirm: async (producerPassword) => {
        await onDeactivateTeamMember(memberId, { producerPassword });
        onNotify(`${memberName} fue eliminado del equipo.`);
      }
    });
  };

  const handleAuthorizeAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingAuthorization || isAuthorizingAction) return;
    setFormError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const producerPassword = String(form.get("producerPassword") ?? "");
    setIsAuthorizingAction(true);
    try {
      await pendingAuthorization.onConfirm(producerPassword);
      setPendingAuthorization(null);
      formElement.reset();
    } finally {
      setIsAuthorizingAction(false);
    }
  };

  return (
    <div className="sp-page padded sp-team-page">
      <div className="sp-team-page-header">
        <p><Building2 size={15} /> Panel operativo</p>
        <h2>Equipo</h2>
      </div>

      <Card className="sp-team-module">
        <div className="sp-team-header">
          <h3>Integrantes del equipo</h3>
          <div className="sp-team-header-actions">
            <span>{team.length} {team.length === 1 ? "Miembro" : "Miembros"}</span>
            <button className="sp-primary-action" type="button" onClick={() => setIsModalOpen(true)}>
              <Plus size={15} />
              Añadir miembro
            </button>
          </div>
        </div>

        <div className="sp-team-table-wrap">
          {isLoading ? (
            <LoadingState text="Cargando equipo..." />
          ) : team.length === 0 ? (
            <EmptyState title="Todavía no hay integrantes" text="Agregá productores o asesores para compartir la gestión." />
          ) : (
            <Table className="sp-team-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th className="sp-team-actions-head">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {team.map((member) => {
                  const isCurrentUser = member.userId === currentUserId;
                  return (
                    <tr key={member.id}>
                      <td>
                        <div className="sp-team-user">
                          <div className="sp-avatar" style={{ background: avatarColor(member.fullName) }}>
                            {initials(member.fullName)}
                          </div>
                          <div>
                            <strong>{member.fullName}{isCurrentUser ? " (vos)" : ""}</strong>
                            <span>{member.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>{roleLabel(member.role)}</td>
                      <td>
                        <span className={`sp-team-status ${member.isActive ? "is-active" : ""}`}>
                          {member.isActive ? "Activo" : "Pendiente"}
                        </span>
                      </td>
                      <td>
                        {isCurrentUser ? (
                          <span className="sp-team-self-note">Disponible en Perfil</span>
                        ) : (
                          <div className="sp-team-row-actions">
                            <button type="button" aria-label={`Editar ${member.fullName}`} onClick={() => setEditingMember(member)}>
                              <Edit3 size={15} />
                            </button>
                            <button type="button" aria-label={`Cambiar contraseña de ${member.fullName}`} onClick={() => setPasswordMember(member)}>
                              <ShieldCheck size={15} />
                            </button>
                            <button type="button" className="danger" aria-label={`Eliminar ${member.fullName}`} onClick={() => setDeletingMember(member)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      <Modal title="Agregar usuario" isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <form className="sp-form sp-modal-form sp-team-modal-form" onSubmit={handleSubmit}>
          <label className="sp-field">
            <span>Nombre y apellido</span>
            <input name="fullName" placeholder="Ej: Maria Gonzalez" required />
          </label>
          <label className="sp-field">
            <span>Correo electrónico</span>
            <input name="email" type="email" autoComplete="username" placeholder="maria@ejemplo.com" required />
          </label>
          <label className="sp-field">
            <span>Rol</span>
            <select name="role" defaultValue="asesor" required>
              <option value="asesor">Asesor</option>
              <option value="productor">Productor</option>
            </select>
          </label>
          <label className="sp-field">
            <span>Contraseña inicial</span>
            <div className="sp-password-inline">
              <input
                name="password"
                type={showCreatePassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                placeholder="Min. 8 caracteres"
                required
              />
              <button type="button" onClick={() => setShowCreatePassword((value) => !value)} aria-label="Ver contraseña">
                {showCreatePassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <label className="sp-field">
            <span>Repetir contraseña</span>
            <input name="confirmPassword" type={showCreatePassword ? "text" : "password"} autoComplete="new-password" minLength={8} placeholder="Repetí la contraseña" required />
          </label>
          {formError || error ? <div className="sp-error">{formError ?? error}</div> : null}
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setIsModalOpen(false)}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isAdding}>
              {isAdding ? <span className="sp-button-spinner" aria-hidden="true" /> : <Plus size={15} />}
              {isAdding ? "Cargando..." : "Crear usuario"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal title="Editar integrante" isOpen={Boolean(editingMember)} onClose={() => setEditingMember(null)}>
        <form className="sp-form sp-modal-form sp-team-modal-form" onSubmit={handleUpdateMember}>
          <label className="sp-field">
            <span>Nombre y apellido</span>
            <input name="fullName" defaultValue={editingMember?.fullName ?? ""} required />
          </label>
          <label className="sp-field">
            <span>Correo electrónico</span>
            <input name="email" type="email" autoComplete="username" defaultValue={editingMember?.email ?? ""} required />
          </label>
          <label className="sp-field">
            <span>Rol</span>
            <select name="role" defaultValue={editingMember?.role ?? "asesor"} required>
              <option value="asesor">Asesor</option>
              <option value="productor">Productor</option>
            </select>
          </label>
          <p className="sp-team-delete-copy">Los cambios se confirmarán con la contraseña del productor en el siguiente paso.</p>
          {formError || error ? <div className="sp-error">{formError ?? error}</div> : null}
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setEditingMember(null)}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isUpdating}>Continuar</button>
          </div>
        </form>
      </Modal>

      <Modal title="Cambiar contraseña" isOpen={Boolean(passwordMember)} onClose={() => setPasswordMember(null)}>
        <form className="sp-form sp-modal-form sp-team-modal-form" onSubmit={handleChangePassword}>
          <label className="sp-field">
            <span>Nueva contraseña</span>
            <div className="sp-password-inline">
              <input name="password" type={showMemberPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required />
              <button type="button" onClick={() => setShowMemberPassword((value) => !value)} aria-label="Ver contraseña">
                {showMemberPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <label className="sp-field">
            <span>Repetir contraseña</span>
            <input name="confirmPassword" type={showMemberPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required />
          </label>
          {formError || error ? <div className="sp-error">{formError ?? error}</div> : null}
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setPasswordMember(null)}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isUpdating}>Continuar</button>
          </div>
        </form>
      </Modal>

      <Modal title="Eliminar integrante" isOpen={Boolean(deletingMember)} onClose={() => setDeletingMember(null)}>
        <form className="sp-form sp-modal-form sp-team-modal-form" onSubmit={handleDeactivateMember}>
          <p className="sp-team-delete-copy">
            Se dará de baja a <strong>{deletingMember?.fullName}</strong> de esta organización. Esta acción requiere la contraseña del productor.
          </p>
          {formError || error ? <div className="sp-error">{formError ?? error}</div> : null}
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setDeletingMember(null)}>Cancelar</button>
            <button className="sp-primary-action danger" type="submit" disabled={isUpdating}>Confirmar</button>
          </div>
        </form>
      </Modal>

      <Modal
        title={pendingAuthorization?.title ?? "Confirmar acción"}
        isOpen={Boolean(pendingAuthorization)}
        onClose={() => {
          if (isAuthorizingAction) return;
          setPendingAuthorization(null);
        }}
      >
        <form className="sp-form sp-modal-form sp-team-modal-form" onSubmit={handleAuthorizeAction}>
          <p className="sp-team-delete-copy">{pendingAuthorization?.description}</p>
          <label className="sp-field">
            <span>Contraseña del productor</span>
            <div className="sp-password-inline">
              <input name="producerPassword" type={showProducerPassword ? "text" : "password"} autoComplete="current-password" required />
              <button type="button" onClick={() => setShowProducerPassword((value) => !value)} aria-label="Ver contraseña del productor">
                {showProducerPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {formError || error ? <div className="sp-error">{formError ?? error}</div> : null}
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setPendingAuthorization(null)} disabled={isAuthorizingAction}>Cancelar</button>
            <button
              className={`sp-primary-action ${pendingAuthorization?.tone === "danger" ? "danger" : ""}`}
              type="submit"
              disabled={isAuthorizingAction || isUpdating}
            >
              {isAuthorizingAction || isUpdating ? <span className="sp-button-spinner" aria-hidden="true" /> : null}
              {isAuthorizingAction || isUpdating ? "Cargando..." : pendingAuthorization?.confirmLabel ?? "Confirmar"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function LogoDropzone({
  title,
  previewUrl,
  isUploading,
  onFile
}: {
  title: string;
  previewUrl: string | null;
  isUploading: boolean;
  onFile: (file: File) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      void onFile(file);
    }
  };

  return (
    <div
      className={`sp-logo-dropzone ${isDragging ? "is-dragging" : ""}`}
      onClick={() => {
        if (!isUploading) inputRef.current?.click();
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (!isUploading) {
          handleFiles(event.dataTransfer.files);
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => {
          handleFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div className="sp-logo-dropzone-preview">
        {previewUrl ? (
          <Image src={previewUrl} alt="" width={64} height={64} unoptimized />
        ) : (
          <UploadCloud size={24} />
        )}
      </div>
      <div className="sp-logo-dropzone-copy">
        <span>{title}</span>
        <em>{previewUrl ? "Imagen cargada" : "PNG, JPG, WEBP o GIF hasta 5 MB"}</em>
      </div>
      <button
        type="button"
        className="sp-logo-dropzone-action"
        disabled={isUploading}
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.click();
        }}
      >
        {isUploading ? "Subiendo..." : "Seleccionar"}
      </button>
    </div>
  );
}

function EntityToolbar({
  search,
  setSearch,
  count,
  total,
  view,
  setView,
  placeholder,
  actionLabel,
  onAction,
  children
}: {
  search: string;
  setSearch: (value: string) => void;
  count: number;
  total: number;
  view: EntityView;
  setView: (view: EntityView) => void;
  placeholder: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="sp-entity-toolbar">
      <div className="sp-search">
        <Search size={15} />
        <input placeholder={placeholder} value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {children}
      <span>{count} de {total}</span>
      <ViewToggle
        leftLabel="Grid"
        rightLabel="Lista"
        value={view}
        leftValue="grid"
        rightValue="list"
        onChange={setView}
      />
      {actionLabel && onAction ? (
        <button className="sp-primary-action" type="button" onClick={onAction}>
          <Plus size={14} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

type SelectOption = {
  value: string;
  label: string;
  meta?: string;
  key?: string;
};

function Modal({
  title,
  isOpen,
  onClose,
  children
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current ?? undefined);
    if (isOpen) {
      const frame = window.requestAnimationFrame(() => {
        setIsMounted(true);
        setIsClosing(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!isMounted) return;

    const frame = window.requestAnimationFrame(() => {
      setIsClosing(true);
      const closeMs = readTransitionMs("--modal-close-dur", 150);
      closeTimerRef.current = window.setTimeout(() => {
        setIsMounted(false);
        setIsClosing(false);
      }, closeMs);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(closeTimerRef.current ?? undefined);
    };
  }, [isOpen, isMounted]);

  if (!isMounted) return null;

  return (
    <div
      className="sp-modal-backdrop fixed inset-0 z-50 grid min-h-dvh place-items-center overflow-hidden bg-slate-950/45 p-6 max-[520px]:p-3"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={`sp-modal m-0 flex max-h-[min(760px,calc(100dvh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl max-[520px]:max-h-[calc(100dvh-24px)] ${isClosing ? "opacity-0" : "opacity-100"}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sp-modal-header flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <h2 className="m-0 text-lg font-semibold text-slate-950">{title}</h2>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>
        <div className="sp-modal-body min-h-0 overflow-y-auto p-5">{children}</div>
      </section>
    </div>
  );
}

function SearchableSelect({
  label,
  name,
  value,
  options,
  placeholder,
  required,
  onChange
}: {
  label?: string;
  name?: string;
  value?: string;
  options: SelectOption[];
  placeholder: string;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [internalValue, setInternalValue] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => option.value === selectedValue);
  const filtered = options.filter((option) => {
    const term = query.trim().toLowerCase();
    return !term || `${option.label} ${option.meta ?? ""}`.toLowerCase().includes(term);
  });

  const closeSelect = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const select = (next: string) => {
    setInternalValue(next);
    onChange?.(next);
    closeSelect();
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        closeSelect();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSelect();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSelect]);

  const control = (
    <div className="sp-combobox" ref={rootRef}>
      <div className="sp-combobox-control">
        <input
          value={open ? query : selected?.label ?? ""}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        <button type="button" onClick={() => setOpen((state) => !state)} aria-label="Abrir opciones">
          <ChevronDown size={15} />
        </button>
      </div>
      {open ? (
        <div className="sp-combobox-menu t-dropdown is-open" data-origin="top-left">
          <div>
            {filtered.length === 0 ? <p>Sin resultados</p> : null}
            {filtered.map((option, index) => (
              <button
                key={option.key ?? `${option.value}-${index}`}
                type="button"
                className={option.value === selectedValue ? "active" : ""}
                onClick={() => select(option.value)}
              >
                <span>{option.label}</span>
                {option.meta ? <em>{option.meta}</em> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {name ? (
        <input
          className="sp-combobox-hidden-input"
          name={name}
          value={selectedValue}
          required={required}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );

  if (!label) return control;
  return (
    <label className="sp-field">
      <span>{label}</span>
      {control}
    </label>
  );
}

function LocalityCombobox({ name }: { name: string }) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          nombre: term,
          campos: "id,nombre,provincia.nombre",
          max: "12"
        });
        const response = await fetch(`https://apis.datos.gob.ar/georef/api/localidades?${params}`, {
          signal: controller.signal
        });
        const payload = (await response.json()) as {
          localidades?: Array<{ id?: string; nombre?: string; provincia?: { nombre?: string } }>;
        };
        const nextOptions = (payload.localidades ?? []).map((locality, index) => ({
            key: locality.id ?? `${locality.nombre ?? "localidad"}-${locality.provincia?.nombre ?? "provincia"}-${index}`,
            value: locality.provincia?.nombre
              ? `${locality.nombre ?? ""}, ${locality.provincia.nombre}`
              : locality.nombre ?? "",
            label: locality.nombre ?? "",
            ...(locality.provincia?.nombre ? { meta: locality.provincia.nombre } : {})
          })).filter((option) => option.value.trim());
        setOptions(nextOptions);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setOptions([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const visibleOptions = options.filter((option) => option.label);

  return (
    <label className="sp-field">
      <span>Localidad</span>
      <div className="sp-combobox sp-locality-combobox">
        <input
          className="block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[var(--org-primary)] focus:ring-2 focus:ring-[var(--org-primary-soft)]"
          value={query}
          placeholder="Buscar localidad"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setValue(event.target.value);
            if (event.target.value.trim().length < 2) setOptions([]);
            setOpen(true);
          }}
        />
        {open && (query.trim().length >= 2 || visibleOptions.length > 0) ? (
          <div className="sp-combobox-menu locality">
            <div>
              {isLoading ? <p>Buscando...</p> : null}
              {!isLoading && visibleOptions.length === 0 ? <p>Sin resultados</p> : null}
              {visibleOptions.map((option, index) => (
                <button
                  key={option.key ?? `${option.value}-${index}`}
                  type="button"
                  onClick={() => {
                    setQuery(option.value);
                    setValue(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {option.meta ? <em>{option.meta}</em> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <input name={name} value={value} readOnly hidden />
      </div>
    </label>
  );
}

function ViewToggle<T extends string>({
  leftLabel,
  rightLabel,
  value,
  leftValue,
  rightValue,
  onChange
}: {
  leftLabel: string;
  rightLabel: string;
  value: T;
  leftValue: T;
  rightValue: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="sp-view-toggle">
      <button className={value === leftValue ? "active" : ""} type="button" onClick={() => onChange(leftValue)}>
        <LayoutGrid size={13} />
        {leftLabel}
      </button>
      <button className={value === rightValue ? "active" : ""} type="button" onClick={() => onChange(rightValue)}>
        <List size={13} />
        {rightLabel}
      </button>
    </div>
  );
}

function EmptyState({ title, text, compact }: { title: string; text?: string; compact?: boolean }) {
  return (
    <div className={`sp-empty ${compact ? "compact" : ""}`}>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="sp-state sp-loading-state" role="status">
      <span />
      <strong>{text}</strong>
    </div>
  );
}

function ErrorState({ text }: { text: string }) {
  return (
    <div className="sp-state sp-error-state" role="alert">
      <AlertTriangle size={16} />
      <strong>{text}</strong>
    </div>
  );
}

function titleForTab(tab: Tab) {
  const labels: Record<Tab, string> = {
    dashboard: "Dashboard",
    notices: "Avisos",
    clients: "Asegurados",
    policies: "Pólizas",
    companies: "Compañías",
    team: "Equipo",
    settings: "Configuración",
    profile: "Perfil"
  };
  return labels[tab];
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    productor: "Productor",
    asesor: "Asesor"
  };
  return labels[role] ?? role;
}

function matchesNoticeFilters(notice: Notice, filters: NoticeFilters) {
  const term = filters.search.toLowerCase();
  const client = notice.policies?.clients;
  const policy = notice.policies;
  const company = policy?.insurance_companies;
  const matchesSearch =
    !term ||
    client?.full_name?.toLowerCase().includes(term) ||
    policy?.policy_number?.toLowerCase().includes(term) ||
    policy?.vehicle_plate?.toLowerCase().includes(term);
  const matchesCompany = filters.companyId === "all" || company?.id === filters.companyId;
  const matchesBranch = filters.branch === "all" || policy?.branch === filters.branch;
  const matchesStatus = filters.status === "all" || notice.status === filters.status;
  const matchesFrom = !filters.dateFrom || notice.due_date >= filters.dateFrom;
  const matchesTo = !filters.dateTo || notice.due_date <= filters.dateTo;
  return matchesSearch && matchesCompany && matchesBranch && matchesStatus && matchesFrom && matchesTo;
}

function getDaysUntilDue(dueDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function dueLabel(days: number) {
  if (days < 0) return `Vencido hace ${Math.abs(days)}d`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Mañana";
  return `En ${days} días`;
}

function dueClass(days: number) {
  if (days < 0) return "danger";
  if (days <= 7) return "warning";
  return "muted";
}

function countUrgentNotices(notices: Notice[]) {
  return notices.filter((notice) => notice.status !== "pagado" && getDaysUntilDue(notice.due_date) <= 7).length;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function avatarColor(name: string) {
  const seed = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AVATAR_COLORS[seed % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatDateInput(value: string) {
  const date = parseIsoDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildCalendarDays(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function readView<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return (window.localStorage.getItem(key) as T | null) ?? fallback;
}

function writeView(key: string, value: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
}

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function emptyToNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function resolveSubdomainSlug(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  ) {
    return null;
  }

  const parts = normalized.split(".").filter(Boolean);
  if (normalized.endsWith(".localhost") && parts.length >= 2) {
    const localCandidate = parts[0] ?? "";
    return /^[a-z0-9-]{2,63}$/.test(localCandidate) ? localCandidate : null;
  }

  if (parts.length < 3) return null;
  const candidate = parts[0] ?? "";
  if (!candidate || candidate === "www" || candidate === "app" || candidate === "api") return null;
  return /^[a-z0-9-]{2,63}$/.test(candidate) ? candidate : null;
}

function resolveLoginSlug(hostname: string, search: string) {
  if (FORCED_ORG_SLUG) return FORCED_ORG_SLUG;
  const querySlug = new URLSearchParams(search).get("slug")?.trim().toLowerCase();
  if (querySlug && /^[a-z0-9-]{2,63}$/.test(querySlug)) {
    return querySlug;
  }

  return resolveSubdomainSlug(hostname);
}

function organizationThemeStyle({
  primaryColor,
  secondaryColor
}: {
  primaryColor: string | null;
  secondaryColor: string | null;
}) {
  const primary = normalizeHexColor(primaryColor) ?? "#176e64";
  const secondary = normalizeHexColor(secondaryColor) ?? "#64748b";
  return {
    "--org-primary": primary,
    "--org-primary-soft": hexToRgba(primary, 0.1),
    "--org-primary-muted": hexToRgba(primary, 0.18),
    "--org-secondary": secondary,
    "--org-secondary-soft": hexToRgba(secondary, 0.18),
    "--org-on-primary": contrastColor(primary),
    "--sp-accent": primary,
    "--sp-accent-soft": hexToRgba(primary, 0.1),
    "--sp-sidebar-bg": `color-mix(in srgb, ${primary} 68%, #111827)`,
    "--sp-sidebar-active": hexToRgba(secondary, 0.12),
    "--sp-sidebar-accent": secondary
  } as CSSProperties;
}

function normalizeHexColor(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : null;
}

function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function contrastColor(hex: string) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#10201f" : "#ffffff";
}

function readTransitionMs(variable: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variable);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

async function avatarFileToDataUrl(file: File) {
  const maxSize = 256;
  const quality = 0.82;
  const image = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return await fileToDataUrl(file);
  }
  context.drawImage(image, 0, 0, width, height);
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(mimeType, quality);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load image"));
    };
    image.src = url;
  });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
