"use client";

import Image from "next/image";
import { Eye, EyeOff, Shield, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { PublicOrganization } from "@/lib/api";
import { organizationThemeStyle } from "@/lib/colors";

export function LoginView({
  brand,
  error,
  isPending,
  onSubmit
}: {
  brand: PublicOrganization | undefined;
  error: string | null;
  isPending: boolean;
  onSubmit: (credentials: { email: string; password: string }) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const publicBrand = brand;
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
              onSubmit({
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
            {error ? <div className="sp-error">{error}</div> : null}
            <button className="login-submit-button" type="submit" disabled={isPending}>
              <span />
              <b>{isPending ? "Cargando..." : "Ingresar"}</b>
            </button>
          </form>
        </section>
      </main>
  );
}
