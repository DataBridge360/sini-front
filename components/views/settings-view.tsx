"use client";

import Image from "next/image";
import { Building2, Palette, Save, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthState, OrganizationSettings } from "@/lib/api";
import { contrastColor, hexToRgba, isHexColor, normalizeHexColor } from "@/lib/colors";
import type { UploadLogoPayload } from "@/lib/shell-types";


// Debe coincidir con el límite del backend y del bucket de Supabase (2MB).
const LOGO_MAX_SIZE_BYTES = 2_000_000;

export function SettingsView({
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
  const initialLoginLogoUrl = organization?.login_logo_url ?? fallbackOrganization?.loginLogoUrl ?? null;
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [loginLogoUrl, setLoginLogoUrl] = useState<string | null>(initialLoginLogoUrl);
  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor);
  const [secondaryColor, setSecondaryColor] = useState(initialSecondaryColor);
  const [uploadingKind, setUploadingKind] = useState<UploadLogoPayload["kind"] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setLogoUrl(initialLogoUrl);
      setLoginLogoUrl(initialLoginLogoUrl);
      setPrimaryColor(initialPrimaryColor);
      setSecondaryColor(initialSecondaryColor);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialLogoUrl, initialLoginLogoUrl, initialPrimaryColor, initialSecondaryColor]);

  const handleUploadLogo = async (file: File, kind: UploadLogoPayload["kind"]) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("El logo debe ser una imagen.");
      return;
    }

    if (file.size > LOGO_MAX_SIZE_BYTES) {
      setUploadError("El logo debe pesar 2 MB o menos.");
      return;
    }

    setUploadError(null);
    setUploadingKind(kind);
    try {
      const result = await onUploadLogo({ file, kind });
      if (kind === "login") {
        setLoginLogoUrl(result.url);
      } else {
        setLogoUrl(result.url);
      }
    } catch (uploadError) {
      setUploadError(uploadError instanceof Error ? uploadError.message : "No se pudo subir el logo.");
    } finally {
      setUploadingKind(null);
    }
  };

  const primaryPickerColor = isHexColor(primaryColor) ? primaryColor : "#000000";
  const secondaryPickerColor = isHexColor(secondaryColor) ? secondaryColor : "#000000";
  // Para la vista previa usamos el último color válido: mientras se tipea un
  // hex incompleto no queremos que el preview "parpadee" en negro.
  const previewPrimary = normalizeHexColor(primaryColor) ?? normalizeHexColor(initialPrimaryColor) ?? "#176e64";
  const previewSecondary = normalizeHexColor(secondaryColor) ?? normalizeHexColor(initialSecondaryColor) ?? "#64748b";

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
                <small>Canal de contacto interno; no se muestra públicamente.</small>
              </label>
              <label className="sp-field">
                <span>Teléfono de soporte</span>
                <input name="supportPhone" defaultValue={organization?.support_phone ?? ""} placeholder="+54..." />
                <small>Opcional. Ej: +54 9 11 5555-5555.</small>
              </label>
            </div>
          </section>

          <section className="sp-section-card">
            <div className="sp-section-title">
              <span className="sp-section-icon tertiary"><Palette size={21} /></span>
              <div>
                <h2>Marca y colores</h2>
                <span>Subí tus logos y elegí los colores que identifican a tu organización</span>
              </div>
            </div>
            <input name="logoUrl" type="hidden" value={logoUrl ?? ""} readOnly />
            <div className="sp-logo-upload-grid">
              <div>
                <span className="sp-upload-title">Logo del panel</span>
                <LogoDropzone
                  title="Hacé clic o arrastrá una imagen"
                  hint="Se muestra en la barra lateral · PNG, JPG, WEBP o GIF hasta 2 MB"
                  previewUrl={logoUrl}
                  isUploading={uploadingKind === "main"}
                  onFile={(file) => handleUploadLogo(file, "main")}
                />
              </div>
              <div>
                <span className="sp-upload-title">Logo de la pantalla de ingreso</span>
                <LogoDropzone
                  title="Hacé clic o arrastrá una imagen"
                  hint="Se muestra al iniciar sesión; si no cargás uno se usa el logo del panel"
                  previewUrl={loginLogoUrl}
                  isUploading={uploadingKind === "login"}
                  onFile={(file) => handleUploadLogo(file, "login")}
                />
              </div>
            </div>
            <div className="sp-form-grid">
              <label className="sp-field">
                <span>Color principal</span>
                <div className="sp-color-input">
                  <input aria-label="Selector de color principal" type="color" value={primaryPickerColor} onChange={(event) => setPrimaryColor(event.currentTarget.value)} />
                  <input name="primaryColor" type="text" value={primaryColor} onChange={(event) => setPrimaryColor(event.currentTarget.value.toUpperCase())} spellCheck={false} pattern="#[0-9a-fA-F]{6}" title="Usá un color en formato #RRGGBB" />
                </div>
                <small>Botones, acciones y barra lateral.</small>
              </label>
              <label className="sp-field">
                <span>Color secundario</span>
                <div className="sp-color-input">
                  <input aria-label="Selector de color secundario" type="color" value={secondaryPickerColor} onChange={(event) => setSecondaryColor(event.currentTarget.value)} />
                  <input name="secondaryColor" type="text" value={secondaryColor} onChange={(event) => setSecondaryColor(event.currentTarget.value.toUpperCase())} spellCheck={false} pattern="#[0-9a-fA-F]{6}" title="Usá un color en formato #RRGGBB" />
                </div>
                <small>Detalles y resaltados del menú.</small>
              </label>
            </div>
            <div className="mt-6 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Vista previa de tus colores</span>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-xs font-semibold"
                  style={{ backgroundColor: previewPrimary, color: contrastColor(previewPrimary) }}
                >
                  Botón principal
                </span>
                <span
                  className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-xs font-semibold text-white"
                  style={{ background: `color-mix(in srgb, ${previewPrimary} 68%, #111827)` }}
                >
                  Barra lateral
                </span>
                <span
                  className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-xs font-semibold"
                  style={{ backgroundColor: hexToRgba(previewSecondary, 0.16), color: previewSecondary }}
                >
                  Detalles
                </span>
              </div>
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


function LogoDropzone({
  title,
  hint,
  previewUrl,
  isUploading,
  onFile
}: {
  title: string;
  hint?: string;
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
        <em>{hint ?? (previewUrl ? "Imagen cargada" : "PNG, JPG, WEBP o GIF hasta 2 MB")}</em>
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

