"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ClipboardList, LogOut, ShieldCheck, Users } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  authStorage,
  intervalLabel,
  type AuthState,
  type Client,
  type InsuranceCompany,
  type Notice,
  type Policy
} from "@/lib/api";

type Tab = "notices" | "clients" | "policies" | "companies";

export function AppShell() {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [slug, setSlug] = useState("");
  const [tab, setTab] = useState<Tab>("notices");
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = authStorage.read();
      if (stored) {
        setAuth(stored);
        setSlug(stored.organizations[0]?.slug ?? "");
      }
    });
  }, []);

  const selectedOrganization = useMemo(
    () => auth?.organizations.find((organization) => organization.slug === slug),
    [auth, slug]
  );

  const common = {
    token: auth?.accessToken,
    organizationSlug: slug
  };

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

  const login = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      apiRequest<AuthState>("/auth/login", { method: "POST", body: payload }),
    onSuccess: (data) => {
      authStorage.write(data);
      setAuth(data);
      setSlug(data.organizations[0]?.slug ?? "");
      setLoginError(null);
    },
    onError: (error) => setLoginError(error.message)
  });

  const createClient = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      apiRequest<Client>("/clients", { ...common, method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients", slug] })
  });

  const createCompany = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      apiRequest<InsuranceCompany>("/insurance-companies", { ...common, method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insurance-companies", slug] })
  });

  const createPolicy = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue | number>) =>
      apiRequest<Policy>("/policies", { ...common, method: "POST", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["policies", slug] });
      await queryClient.invalidateQueries({ queryKey: ["notices", slug] });
      setTab("notices");
    }
  });

  const markNotified = useMutation({
    mutationFn: (noticeId: string) =>
      apiRequest<Notice>(`/notices/${noticeId}/notified`, { ...common, method: "PATCH", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notices", slug] })
  });

  const payNotice = useMutation({
    mutationFn: ({ noticeId, months }: { noticeId: string; months: number }) =>
      apiRequest(`/notices/${noticeId}/pay`, {
        ...common,
        method: "PATCH",
        body: { paymentIntervalMonths: months }
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notices", slug] })
  });

  if (!auth) {
    return (
      <main className="login-wrap">
        <section className="login">
          <div className="brand">
            <strong>Sinipro2</strong>
            <span>Acceso por organizacion</span>
          </div>
          <form
            className="form"
            style={{ marginTop: 20 }}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              login.mutate({
                email: String(form.get("email") ?? ""),
                password: String(form.get("password") ?? "")
              });
            }}
          >
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field">
              <span>Contrasena</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {loginError ? <div className="error">{loginError}</div> : null}
            <button className="primary" type="submit" disabled={login.isPending}>
              Ingresar
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <strong>{selectedOrganization?.displayName ?? "Sinipro2"}</strong>
          <span>{auth.user.fullName} · {selectedOrganization?.role ?? auth.user.platformRole}</span>
        </div>
        <div className="actions">
          <select value={slug} onChange={(event) => setSlug(event.target.value)}>
            {auth.organizations.map((organization) => (
              <option key={organization.id} value={organization.slug}>
                {organization.displayName}
              </option>
            ))}
          </select>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              authStorage.clear();
              setAuth(null);
              queryClient.clear();
            }}
          >
            <LogOut size={16} /> Salir
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <nav className="nav">
            <button className={tab === "notices" ? "active" : ""} onClick={() => setTab("notices")}>
              <ClipboardList size={17} /> Avisos
            </button>
            <button className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}>
              <Users size={17} /> Clientes
            </button>
            <button className={tab === "policies" ? "active" : ""} onClick={() => setTab("policies")}>
              <ShieldCheck size={17} /> Polizas
            </button>
            <button className={tab === "companies" ? "active" : ""} onClick={() => setTab("companies")}>
              <Building2 size={17} /> Companias
            </button>
          </nav>
        </aside>

        <section className="content">
          {tab === "notices" ? (
            <NoticesView
              notices={notices.data ?? []}
              isLoading={notices.isLoading}
              onNotified={(id) => markNotified.mutate(id)}
              onPay={(noticeId, months) => payNotice.mutate({ noticeId, months })}
            />
          ) : null}
          {tab === "clients" ? (
            <ClientsView
              clients={clients.data ?? []}
              onSubmit={(event) => {
                event.preventDefault();
                createClient.mutate(Object.fromEntries(new FormData(event.currentTarget)));
                event.currentTarget.reset();
              }}
            />
          ) : null}
          {tab === "policies" ? (
            <PoliciesView
              policies={policies.data ?? []}
              clients={clients.data ?? []}
              companies={companies.data ?? []}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                createPolicy.mutate({
                  clientId: String(form.get("clientId")),
                  insuranceCompanyId: String(form.get("insuranceCompanyId")),
                  branch: String(form.get("branch")),
                  policyNumber: String(form.get("policyNumber")),
                  vehiclePlate: String(form.get("vehiclePlate") ?? ""),
                  paymentIntervalMonths: Number(form.get("paymentIntervalMonths")),
                  firstPaymentDate: String(form.get("firstPaymentDate"))
                });
                event.currentTarget.reset();
              }}
            />
          ) : null}
          {tab === "companies" ? (
            <CompaniesView
              companies={companies.data ?? []}
              onSubmit={(event) => {
                event.preventDefault();
                createCompany.mutate(Object.fromEntries(new FormData(event.currentTarget)));
                event.currentTarget.reset();
              }}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function NoticesView({
  notices,
  isLoading,
  onNotified,
  onPay
}: {
  notices: Notice[];
  isLoading: boolean;
  onNotified: (id: string) => void;
  onPay: (id: string, months: number) => void;
}) {
  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Avisos</h1>
          <span className="muted">Seguimiento, notificacion y registro de pagos</span>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Vence</th>
            <th>Cliente</th>
            <th>Poliza</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={5}>Cargando...</td></tr>
          ) : notices.length === 0 ? (
            <tr><td colSpan={5}>No hay avisos.</td></tr>
          ) : (
            notices.map((notice) => (
              <tr key={notice.id}>
                <td>{notice.due_date}</td>
                <td>{notice.policies?.clients?.full_name ?? "-"}</td>
                <td>{notice.policies?.policy_number ?? "-"}</td>
                <td><span className={`status ${notice.status}`}>{notice.status}</span></td>
                <td>
                  <div className="actions">
                    {notice.status !== "pagado" ? (
                      <>
                        <button className="ghost" type="button" onClick={() => onNotified(notice.id)}>
                          Avisado
                        </button>
                        <select
                          aria-label="Periodicidad de pago"
                          defaultValue={notice.paid_interval_months ?? 1}
                          onChange={(event) => onPay(notice.id, Number(event.target.value))}
                        >
                          {Array.from({ length: 12 }, (_, index) => index + 1).map((months) => (
                            <option key={months} value={months}>
                              Pagar {intervalLabel(months)}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span className="muted">Pagado</span>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}

function ClientsView({
  clients,
  onSubmit
}: {
  clients: Client[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid">
      <section className="panel">
        <h2>Nuevo cliente</h2>
        <form className="form" onSubmit={onSubmit}>
          <label className="field"><span>Nombre completo</span><input name="fullName" required /></label>
          <label className="field"><span>Telefono</span><input name="phone" /></label>
          <label className="field"><span>Email</span><input name="email" type="email" /></label>
          <label className="field"><span>DNI</span><input name="dni" /></label>
          <label className="field"><span>Localidad</span><input name="locality" /></label>
          <button className="primary" type="submit">Guardar cliente</button>
        </form>
      </section>
      <section className="panel">
        <h2>Clientes</h2>
        <table className="table">
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td><strong>{client.full_name}</strong><br /><span className="muted">{client.dni ?? client.email ?? client.phone ?? "-"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PoliciesView({
  policies,
  clients,
  companies,
  onSubmit
}: {
  policies: Policy[];
  clients: Client[];
  companies: InsuranceCompany[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid">
      <section className="panel">
        <h2>Nueva poliza</h2>
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span>Cliente</span>
            <select name="clientId" required>
              <option value="">Seleccionar</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Compania</span>
            <select name="insuranceCompanyId" required>
              <option value="">Seleccionar</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Ramo</span><input name="branch" required /></label>
          <label className="field"><span>Numero</span><input name="policyNumber" required /></label>
          <label className="field"><span>Patente</span><input name="vehiclePlate" /></label>
          <label className="field">
            <span>Periodicidad</span>
            <select name="paymentIntervalMonths" defaultValue="1">
              {Array.from({ length: 12 }, (_, index) => index + 1).map((months) => (
                <option key={months} value={months}>{intervalLabel(months)}</option>
              ))}
            </select>
          </label>
          <label className="field"><span>Primer vencimiento</span><input name="firstPaymentDate" type="date" required /></label>
          <button className="primary" type="submit">Guardar poliza</button>
        </form>
      </section>
      <section className="panel">
        <h2>Polizas</h2>
        <table className="table">
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id}>
                <td>
                  <strong>{policy.policy_number}</strong><br />
                  <span className="muted">{policy.clients?.full_name ?? "-"} · {policy.insurance_companies?.name ?? "-"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function CompaniesView({
  companies,
  onSubmit
}: {
  companies: InsuranceCompany[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid">
      <section className="panel">
        <h2>Nueva compania</h2>
        <form className="form" onSubmit={onSubmit}>
          <label className="field"><span>Nombre</span><input name="name" required /></label>
          <button className="primary" type="submit">Guardar compania</button>
        </form>
      </section>
      <section className="panel">
        <h2>Companias</h2>
        <table className="table">
          <tbody>
            {companies.map((company) => (
              <tr key={company.id}><td>{company.name}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
