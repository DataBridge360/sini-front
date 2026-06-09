"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  CircleHelp,
  Clock,
  Eye,
  EyeOff,
  Edit3,
  FileText,
  Hash,
  LayoutDashboard,
  LayoutGrid,
  List,
  LogOut,
  Mail,
  MapPin,
  Palette,
  Phone,
  Plus,
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

export function AppShell() {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [slug, setSlug] = useState("");
  const [hostSlug, setHostSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
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
      const nextHostSlug = resolveSubdomainSlug(window.location.hostname);
      setHostSlug(nextHostSlug);
      const stored = authStorage.read();
      if (stored) {
        setAuth(stored);
        const organizationFromHost = stored.organizations.find(
          (organization) => organization.slug === nextHostSlug
        );
        setSlug(organizationFromHost?.slug ?? stored.organizations[0]?.slug ?? nextHostSlug ?? "");
      } else {
        setSlug(nextHostSlug ?? "");
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
      authStorage.write(data);
      setAuth(data);
      const organizationFromHost = data.organizations.find(
        (organization) => organization.slug === hostSlug
      );
      setSlug(organizationFromHost?.slug ?? data.organizations[0]?.slug ?? hostSlug ?? "");
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

  const markNotified = useMutation({
    mutationFn: (noticeId: string) =>
      apiRequest<Notice>(`/notices/${noticeId}/notified`, {
        ...common,
        method: "PATCH",
        body: {}
      }),
    onSuccess: () => {
      notify("Aviso marcado como avisado.");
      return queryClient.invalidateQueries({ queryKey: ["notices", slug] });
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
      return queryClient.invalidateQueries({ queryKey: ["notices", slug] });
    }
  });

  const updateProfile = useMutation({
    mutationFn: (body: { fullName: string; avatarUrl: string | null }) =>
      apiRequest<UserProfile>("/profile", { ...common, method: "PATCH", body }),
    onSuccess: (profile) => {
      setAuth((current) => {
        if (!current) return current;
        const next = { ...current, user: { ...current.user, ...profile } };
        authStorage.write(next);
        return next;
      });
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
      setAuth((current) => {
        if (!current) return current;
        const next = {
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
        };
        authStorage.write(next);
        return next;
      });
      queryClient.setQueryData(["organization-settings", slug], organization);
      notify("Configuración actualizada.");
    }
  });

  const uploadOrganizationLogo = useMutation({
    mutationFn: ({ file, kind }: UploadLogoPayload) =>
      apiUpload<{ url: string }>("/organizations/current/logo", file, {
        token: auth?.accessToken,
        organizationSlug: slug,
        fields: { kind }
      })
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
    const publicLogoUrl = publicBrand?.logo_url ?? null;
    return (
      <main
        className="login-shell"
        style={organizationThemeStyle({
          primaryColor: publicBrand?.primary_color ?? null,
          secondaryColor: publicBrand?.secondary_color ?? null
        })}
      >
        <section className="login-visual-panel">
          <div className="login-visual-content">
            <p>{hostSlug ? "Portal de organización" : "Portal operativo"}</p>
            <h1>{publicBrand?.display_name ?? "SiniPro"}</h1>
            <div className="login-intro">
              <h2>Gestión comercial de seguros</h2>
              <span>
                Avisos de vencimiento, pólizas, asegurados y compañías en un solo espacio de trabajo.
              </span>
            </div>
          </div>
        </section>

        <section className="login-form-side">
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
                <p>
                  Accedé con tus credenciales
                  {publicBrand?.display_name ? ` de ${publicBrand.display_name}` : " de SiniPro"}.
                </p>
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
        setTab={setTab}
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
            <button className="sp-header-icon-action has-alert" type="button" aria-label="Notificaciones">
              <Bell size={21} />
              <span />
            </button>
            <button className="sp-header-icon-action help" type="button" aria-label="Ayuda">
              <CircleHelp size={21} />
            </button>
            <UserMenu
              userName={auth.user.fullName}
              userEmail={auth.user.email}
              avatarUrl={auth.user.avatarUrl ?? null}
              role={selectedOrganization?.role ?? auth.user.platformRole}
              onOpenProfile={() => setTab("profile")}
              onLogout={() => {
                authStorage.clear();
                setAuth(null);
                queryClient.clear();
              }}
            />
          </div>
        </header>

        <div className="sp-workspace">
          {tab === "dashboard" ? (
            <DashboardView
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
              error={notices.error?.message ?? null}
              onNotified={(id) => markNotified.mutate(id)}
              onPay={(noticeId, months) => payNotice.mutate({ noticeId, months })}
            />
          ) : null}
          {tab === "clients" ? (
            <ClientsView
              clients={allClients}
              policies={allPolicies}
              isLoading={clients.isLoading}
              isCreating={createClient.isPending}
              error={clients.error?.message ?? null}
              onSubmit={async (event) => {
                event.preventDefault();
                const formElement = event.currentTarget;
                await createClient.mutateAsync(Object.fromEntries(new FormData(formElement)));
                formElement.reset();
              }}
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
              onSubmit={async (event) => {
                event.preventDefault();
                const formElement = event.currentTarget;
                const form = new FormData(formElement);
                await createPolicy.mutateAsync({
                  clientId: String(form.get("clientId")),
                  insuranceCompanyId: String(form.get("insuranceCompanyId")),
                  branch: String(form.get("branch")),
                  policyNumber: String(form.get("policyNumber")),
                  vehiclePlate: String(form.get("vehiclePlate") ?? ""),
                  paymentIntervalMonths: Number(form.get("paymentIntervalMonths")),
                  firstPaymentDate: String(form.get("firstPaymentDate"))
                });
                formElement.reset();
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(() => selectedDate ?? new Date());

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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
    <div className="sp-date-picker" ref={rootRef}>
      {name ? <input type="hidden" name={name} value={value} aria-hidden="true" /> : null}
      <button
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
      {open ? (
        <div className="sp-date-picker-popover">
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
        </div>
      ) : null}
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
      <div className="sp-logo">
        <div className="sp-logo-mark">
          {logoUrl ? <Image src={logoUrl} alt="" width={36} height={36} unoptimized /> : <Shield size={17} />}
        </div>
        <div className="sp-logo-copy">
          <strong>{organizationName}</strong>
          <span>Management Suite</span>
        </div>
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
              <Icon size={18} />
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
            const form = new FormData(event.currentTarget);
            try {
              await onChangePassword({
                currentPassword: String(form.get("currentPassword") ?? ""),
                newPassword: String(form.get("newPassword") ?? ""),
                confirmPassword: String(form.get("confirmPassword") ?? "")
              });
              event.currentTarget.reset();
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
  notices,
  clients,
  policies,
  isLoading,
  error,
  setTab
}: {
  notices: Notice[];
  clients: Client[];
  policies: Policy[];
  isLoading: boolean;
  error: string | null;
  setTab: (tab: Tab) => void;
}) {
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
          <span className="text-xs font-semibold uppercase text-slate-500">Panel ejecutivo</span>
          <h2 className="m-0 mt-1 text-2xl font-semibold text-slate-950">Operación de cartera</h2>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Resumen de vencimientos, seguimiento comercial y estado general de pólizas.
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
  error,
  onNotified,
  onPay
}: {
  notices: Notice[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  markingNoticeId: string | null;
  payingNoticeId: string | null;
  error: string | null;
  onNotified: (id: string) => void;
  onPay: (id: string, months: number) => void;
}) {
  const [filters, setFilters] = useState<NoticeFilters>(EMPTY_NOTICE_FILTERS);
  const [view, setView] = useState<NoticeView>(() => readView("sp-notices-view", "kanban"));

  const branches = useMemo(() => {
    const fromData = notices.map((notice) => notice.policies?.branch).filter(Boolean) as string[];
    return Array.from(new Set([...BRANCHES, ...fromData]));
  }, [notices]);

  const filtered = useMemo(
    () => notices.filter((notice) => matchesNoticeFilters(notice, filters)),
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
                        onNotified={onNotified}
                        onPay={onPay}
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
                    onNotified={onNotified}
                    onPay={onPay}
                  />
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
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
  onNotified,
  onPay
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  onNotified: (id: string) => void;
  onPay: (id: string, months: number) => void;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);

  return (
    <article className="sp-notice-card">
      <div className="sp-card-topline">
        <h4>{client?.full_name ?? "Sin cliente"}</h4>
        <div className="sp-mini-avatar">{initials(client?.full_name ?? "SC")}</div>
      </div>
      <p className="sp-card-summary">
        {company?.name ?? "Sin compañía"}
        {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
        {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
      </p>
      <div className="sp-card-meta">
        <span>{notice.policies?.branch ?? "Rama"}</span>
        {client?.phone ? <em><Phone size={11} />{client.phone}</em> : null}
        <b className={dueClass(days)}>{dueLabel(days)}</b>
      </div>
      <div className="sp-note-preview">
        <span>Notas</span>
        <p>+ Agregar nota</p>
      </div>
      <NoticeActions
        notice={notice}
        isMarkingNotified={isMarkingNotified}
        isPaying={isPaying}
        onNotified={onNotified}
        onPay={onPay}
      />
    </article>
  );
}

function NoticeListRow({
  notice,
  isMarkingNotified,
  isPaying,
  onNotified,
  onPay,
  compact
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  onNotified: (id: string) => void;
  onPay: (id: string, months: number) => void;
  compact?: boolean;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);

  return (
    <div className={`sp-list-row notice ${compact ? "compact" : ""}`}>
      <i style={{ backgroundColor: NOTICE_COLUMNS.find((column) => column.key === notice.status)?.dot }} />
      <div className="sp-list-main">
        <strong>{client?.full_name ?? "Sin cliente"}</strong>
        <span>
          {company?.name ?? "Sin compañía"}
          {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
          {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
        </span>
      </div>
      <span className="sp-branch-tag">{notice.policies?.branch ?? "Rama"}</span>
      <b className={dueClass(days)}>{dueLabel(days)}</b>
      {!compact ? (
        <NoticeActions
          notice={notice}
          isMarkingNotified={isMarkingNotified}
          isPaying={isPaying}
          onNotified={onNotified}
          onPay={onPay}
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
  onNotified,
  onPay,
  inline
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  onNotified: (id: string) => void;
  onPay: (id: string, months: number) => void;
  inline?: boolean;
}) {
  if (notice.status === "pagado") {
    return <div className={`sp-card-actions ${inline ? "inline" : ""}`}><span>Pagado</span></div>;
  }

  return (
    <div className={`sp-card-actions ${inline ? "inline" : ""}`}>
      {notice.status === "avisar" ? (
        <button type="button" className="sp-action-blue" onClick={() => onNotified(notice.id)} disabled={isMarkingNotified || isPaying}>
          {isMarkingNotified ? <span className="sp-button-spinner" aria-hidden="true" /> : <CheckCircle size={13} />}
          {isMarkingNotified ? "Cargando..." : "Avisado"}
        </button>
      ) : null}
      {isPaying ? (
        <span className="sp-action-loading">
          <span className="sp-button-spinner" aria-hidden="true" />
          Cargando...
        </span>
      ) : (
        <select
          aria-label="Registrar pago"
          defaultValue={notice.paid_interval_months ?? 1}
          disabled={isMarkingNotified}
          onChange={(event) => onPay(notice.id, Number(event.target.value))}
        >
          <option value="">Pagar...</option>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((months) => (
            <option key={months} value={months}>
              {intervalLabel(months)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ClientsView({
  clients,
  policies,
  isLoading,
  isCreating,
  error,
  onSubmit
}: {
  clients: Client[];
  policies: Policy[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
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
              <ClientCard key={client.id} client={client} policies={policies} color={AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#1d4ed8"} />
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
              <ClientRow key={client.id} client={client} policies={policies} color={AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#1d4ed8"} />
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

function ClientCard({ client, policies, color }: { client: Client; policies: Policy[]; color: string }) {
  const count = policies.filter((policy) => policy.clients?.id === client.id).length;
  return (
    <article className="sp-entity-card">
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

function ClientRow({ client, policies, color }: { client: Client; policies: Policy[]; color: string }) {
  const count = policies.filter((policy) => policy.clients?.id === client.id).length;
  return (
    <div className="sp-list-row entity client">
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

function PoliciesView({
  policies,
  clients,
  companies,
  isLoading,
  isCreating,
  error,
  onSubmit
}: {
  policies: Policy[];
  clients: Client[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [view, setView] = useState<EntityView>(() => readView("sp-policies-view", "list"));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPolicyDate, setNewPolicyDate] = useState("");

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
        <button className="sp-primary-action" type="button" onClick={() => setIsModalOpen(true)}>
          <Plus size={14} />
          Nueva póliza
        </button>
      </div>

      <section className="sp-section-card wide">
        {error ? <ErrorState text={error} /> : null}
        {isLoading ? <LoadingState text="Cargando pólizas" /> : null}
        {!isLoading && view === "grid" ? (
          <div className="sp-card-grid">
            {filtered.map((policy) => <PolicyCard key={policy.id} policy={policy} />)}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel embedded">
            {filtered.length > 0 ? (
              <div className="sp-list-header entity policy">
                <span>Asegurado</span>
                <span>Rama</span>
                <span>Patente</span>
                <span>Primer vencimiento</span>
              </div>
            ) : null}
            {filtered.map((policy) => <PolicyRow key={policy.id} policy={policy} />)}
          </div>
        ) : null}
        {!isLoading && filtered.length === 0 ? <EmptyState title="No hay pólizas para mostrar" text="Probá limpiar los filtros o cargar una nueva póliza." /> : null}
      </section>
      <Modal title="Nueva póliza" isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <form
          className="sp-form sp-modal-form"
          onSubmit={async (event) => {
            try {
              await onSubmit(event);
              setNewPolicyDate("");
              setIsModalOpen(false);
            } catch {
              // parent mutation state renders the error
            }
          }}
        >
          <div className="sp-form-section">
            <h3>Relación comercial</h3>
            <div className="sp-form-grid">
              <SearchableSelect
                name="clientId"
                label="Asegurado"
                options={clients.map((client) => ({ value: client.id, label: client.full_name }))}
                placeholder="Buscar asegurado"
                required
              />
              <SearchableSelect
                name="insuranceCompanyId"
                label="Compañía"
                options={companies.map((company) => ({ value: company.id, label: company.name }))}
                placeholder="Buscar compañía"
                required
              />
            </div>
          </div>
          <div className="sp-form-section">
            <h3>Datos de póliza</h3>
          </div>
          <div className="sp-form-grid">
            <label className="sp-field"><span>Rama</span><select name="branch" required><option value="">Seleccionar rama</option>{BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="sp-field"><span>Número</span><input name="policyNumber" placeholder="Número de póliza" required /></label>
          </div>
          <div className="sp-form-grid">
            <label className="sp-field"><span>Patente</span><input name="vehiclePlate" placeholder="Opcional" /></label>
            <label className="sp-field"><span>Periodicidad</span><select name="paymentIntervalMonths" defaultValue="1">{Array.from({ length: 12 }, (_, index) => index + 1).map((months) => <option key={months} value={months}>{intervalLabel(months)}</option>)}</select></label>
          </div>
          <label className="sp-field">
            <span>Primer vencimiento</span>
            <DatePicker
              name="firstPaymentDate"
              value={newPolicyDate}
              onChange={setNewPolicyDate}
              ariaLabel="Primer vencimiento"
              required
            />
          </label>
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setIsModalOpen(false)} disabled={isCreating}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isCreating}>
              {isCreating ? <span className="sp-button-spinner" aria-hidden="true" /> : <Plus size={14} />}
              {isCreating ? "Cargando..." : "Guardar póliza"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function PolicyCard({ policy }: { policy: Policy }) {
  return (
    <article className="sp-entity-card policy">
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

function PolicyRow({ policy }: { policy: Policy }) {
  return (
    <div className="sp-list-row entity policy">
      <div className="sp-icon-box small"><ShieldCheck size={15} /></div>
      <div className="sp-list-main">
        <strong>{policy.clients?.full_name ?? "Sin cliente"}</strong>
        <span>{policy.insurance_companies?.name ?? "Sin compañía"} · #{policy.policy_number}</span>
      </div>
      <span className="sp-branch-tag">{policy.branch}</span>
      <span>{policy.vehicle_plate ?? "-"}</span>
      <span>{formatDate(policy.first_payment_date)}</span>
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
    const form = new FormData(event.currentTarget);
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
    event.currentTarget.reset();
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
        <em>{previewUrl ? "Imagen cargada" : "SVG, PNG, JPG o WEBP"}</em>
      </div>
      <button
        type="button"
        className="sp-logo-dropzone-action"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
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
          className="block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
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
