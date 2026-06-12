"use client";

import { useEffect, useState } from "react";
import type { UserProfile } from "@/lib/api";
import { avatarFileToDataUrl } from "@/lib/browser";
import { roleLabel } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";

export function ProfileView({
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

