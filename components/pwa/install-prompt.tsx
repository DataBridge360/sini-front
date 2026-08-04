"use client";

import Image from "next/image";
import { Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useInstallPrompt } from "@/lib/pwa";

// Cuánto esperamos después de entrar antes de ofrecer la instalación. Lo justo
// para que el usuario vea que la sesión abrió y no le caiga un cartel encima de
// la transición del login.
const APPEAR_DELAY_MS = 1400;

/**
 * Oferta de instalación que aparece al iniciar sesión.
 *
 * En Chrome, Edge y Android el botón "Instalar" abre el diálogo nativo del
 * navegador ("¿Instalar SiniPro?"), que es el que realmente instala la app.
 * Ese diálogo no se puede abrir solo: el navegador exige un gesto del usuario,
 * de ahí esta tarjeta intermedia.
 *
 * En iPhone y iPad no existe esa API, así que se muestran los pasos de
 * Compartir → "Agregar a inicio", que es la única forma de instalar en iOS.
 */
export function InstallPrompt() {
  const { canPromptNatively, needsIosInstructions, promptInstall, dismiss } = useInstallPrompt();
  const [visible, setVisible] = useState(false);

  const offered = canPromptNatively || needsIosInstructions;

  useEffect(() => {
    if (!offered) return;
    const timer = window.setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [offered]);

  if (!offered || !visible) return null;

  return (
    <aside className="sp-install-card" role="dialog" aria-labelledby="sp-install-title">
      <button
        type="button"
        className="sp-install-close"
        onClick={dismiss}
        aria-label="Cerrar la oferta de instalación"
      >
        <X size={15} />
      </button>

      <div className="sp-install-head">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={44}
          height={44}
          className="sp-install-icon"
          aria-hidden="true"
        />
        <div>
          <h2 id="sp-install-title">Instalá SiniPro</h2>
          <p>
            {needsIosInstructions
              ? "Agregala a tu pantalla de inicio y abrila como una app, sin la barra del navegador."
              : "Abrila como una app desde tu escritorio o pantalla de inicio, sin la barra del navegador."}
          </p>
        </div>
      </div>

      {needsIosInstructions ? (
        <ol className="sp-install-steps">
          <li>
            <Share size={16} aria-hidden="true" />
            <span>
              Tocá <strong>Compartir</strong> en la barra del navegador.
            </span>
          </li>
          <li>
            <SquarePlus size={16} aria-hidden="true" />
            <span>
              Elegí <strong>Agregar a inicio</strong> y confirmá.
            </span>
          </li>
        </ol>
      ) : (
        <div className="sp-install-actions">
          <button type="button" className="sp-install-later" onClick={dismiss}>
            Ahora no
          </button>
          <button
            type="button"
            className="sp-install-confirm"
            onClick={() => {
              void promptInstall();
            }}
          >
            Instalar
          </button>
        </div>
      )}
    </aside>
  );
}
