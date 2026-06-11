"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  User,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  apiUpload,
  authStorage,
  AUTH_CHANGED_EVENT,
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
import { readTransitionMs } from "@/lib/browser";
import { organizationThemeStyle } from "@/lib/colors";
import { emptyToNull, roleLabel } from "@/lib/format";
import { countUrgentNotices } from "@/lib/notices";
import {
  type NoticeNoteApi,
  type PolicyActions,
  type PolicyFormValues,
  type Tab,
  type UpdateOrganizationPayload,
  type UploadLogoPayload,
  type UploadLogoResponse
} from "@/lib/shell-types";
import { FORCED_ORG_SLUG, resolveLoginSlug } from "@/lib/slug";
import { Avatar } from "@/components/ui/avatar";
import { LoadingState } from "@/components/ui/states";
import { ToastViewport, type ToastMessage } from "@/components/ui/toast";

// Cada vista se carga on-demand (code-split): el usuario solo descarga el chunk
// de la pestaña que visita, y el de login no viaja a usuarios autenticados.
const viewLoading = () => <LoadingState text="Cargando..." />;

const LoginView = dynamic(() => import("@/components/views/login-view").then((m) => m.LoginView), {
  ssr: false,
  loading: viewLoading
});
const DashboardView = dynamic(() => import("@/components/views/dashboard-view").then((m) => m.DashboardView), {
  ssr: false,
  loading: viewLoading
});
const NoticesView = dynamic(() => import("@/components/views/notices-view").then((m) => m.NoticesView), {
  ssr: false,
  loading: viewLoading
});
const ClientsView = dynamic(() => import("@/components/views/clients-view").then((m) => m.ClientsView), {
  ssr: false,
  loading: viewLoading
});
const ClientDetailScreen = dynamic(
  () => import("@/components/views/client-detail-screen").then((m) => m.ClientDetailScreen),
  { ssr: false, loading: viewLoading }
);
const PoliciesView = dynamic(() => import("@/components/views/policies-view").then((m) => m.PoliciesView), {
  ssr: false,
  loading: viewLoading
});
const CompaniesView = dynamic(() => import("@/components/views/companies-view").then((m) => m.CompaniesView), {
  ssr: false,
  loading: viewLoading
});
const TeamView = dynamic(() => import("@/components/views/team-view").then((m) => m.TeamView), {
  ssr: false,
  loading: viewLoading
});
const SettingsView = dynamic(() => import("@/components/views/settings-view").then((m) => m.SettingsView), {
  ssr: false,
  loading: viewLoading
});
const ProfileView = dynamic(() => import("@/components/views/profile-view").then((m) => m.ProfileView), {
  ssr: false,
  loading: viewLoading
});

export function AppShell() {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [slug, setSlug] = useState("");
  const [hostSlug, setHostSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [clientDetailId, setClientDetailId] = useState<string | null>(null);
  const [openPolicyId, setOpenPolicyId] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
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
    return (
      <LoginView
        brand={publicOrganization.data}
        error={loginError}
        isPending={login.isPending}
        onSubmit={(credentials) => login.mutate(credentials)}
      />
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
            <p>{subtitleForTab(tab)}</p>
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
              companies={allCompanies}
              isLoading={notices.isLoading || clients.isLoading || policies.isLoading}
              isCreatingClient={createClient.isPending}
              isCreatingPolicy={createPolicy.isPending}
              error={notices.error?.message ?? clients.error?.message ?? policies.error?.message ?? null}
              setTab={setTab}
              onCreateClient={(body) => createClient.mutateAsync(body)}
              onCreatePolicy={(values) => createPolicy.mutateAsync(values)}
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
              onCreate={(body) => createClient.mutateAsync(body)}
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

function subtitleForTab(tab: Tab) {
  const labels: Record<Tab, string> = {
    dashboard: "Resumen de tu cartera y próximos vencimientos",
    notices: "Avisá los vencimientos y registrá los pagos",
    clients: "Tu cartera de asegurados y sus datos de contacto",
    policies: "Pólizas activas de la organización",
    companies: "Compañías aseguradoras con las que trabajás",
    team: "Personas con acceso a esta organización",
    settings: "Marca, colores y datos de tu organización",
    profile: "Tus datos personales y contraseña"
  };
  return labels[tab];
}

