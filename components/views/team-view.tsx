"use client";

import { Building2, Edit3, Eye, EyeOff, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type {
  ChangeOrganizationTeamMemberPasswordPayload,
  CreateOrganizationTeamMemberPayload,
  DeactivateOrganizationTeamMemberPayload,
  OrganizationTeamMember,
  UpdateOrganizationTeamMemberPayload
} from "@/lib/api";
import { avatarColor, initials, roleLabel } from "@/lib/format";
import { Card, Table } from "@/components/ui-system";
import { Modal } from "@/components/ui/modal";
import type { ToastMessage } from "@/components/ui/toast";
import { EmptyState, LoadingState } from "@/components/ui/states";

export function TeamView({
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
                          {member.isActive ? "Activo" : "Inactivo"}
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

