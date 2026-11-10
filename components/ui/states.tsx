"use client";

import { AlertTriangle } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  createDelayedFlag,
  pickLoadingText,
  usePageLoadingHost,
  usePageLoadingSnapshot,
  useRegisterPageLoader
} from "@/lib/page-loading";

export function EmptyState({ title, text, compact }: { title: string; text?: string; compact?: boolean }) {
  return (
    <div className={`sp-empty ${compact ? "compact" : ""}`}>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

// Cargando: Gesti pensando, flotando sobre el fondo, sin caja alrededor.
function GestiLoading({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div className={`sp-loading ${compact ? "local" : ""}`} role="status">
      <Image src="/gesti/poses/gesti-think.webp" alt="" width={88} height={88} unoptimized />
      <strong>{text}</strong>
    </div>
  );
}

// Una sola mascota por página: el loader de página no dibuja nada propio, se
// registra y el overlay del área de contenido (PageLoadingOverlay) muestra uno
// solo aunque carguen varios módulos a la vez. Un loader "local" (dentro de un
// panel, un modal o una tarjeta) se queda en su superficie, compacto, y no
// levanta el overlay. Sin overlay montado (login, tests) dibuja la versión local.
export function LoadingState({ text, variant = "page" }: { text: string; variant?: "page" | "local" }) {
  const { hosts } = usePageLoadingSnapshot();
  const overlaid = variant === "page" && hosts > 0;
  useRegisterPageLoader(text, overlaid);
  if (overlaid) return null;
  return <GestiLoading text={text} compact />;
}

const OVERLAY_SHOW_AFTER_MS = 120;
const OVERLAY_HIDE_AFTER_MS = 100;

// Overlay único del área de contenido: cubre solo la vista (no el menú ni el
// header), por encima del contenido y con el fondo de la app casi opaco. La
// mascota queda centrada en la parte visible aunque la página sea larga. Va
// dentro de `.sp-workspace` y envuelve las vistas: mientras se ve, la vista
// queda inerte (sin foco ni clics) porque es contenido a medio cargar.
export function PageLoadingHost({ children }: { children: ReactNode }) {
  usePageLoadingHost();
  const { entries } = usePageLoadingSnapshot();
  const active = entries.length > 0;
  const [visible, setVisible] = useState(false);
  const flagRef = useRef<ReturnType<typeof createDelayedFlag> | null>(null);

  useEffect(() => {
    const flag = createDelayedFlag({ showAfterMs: OVERLAY_SHOW_AFTER_MS, hideAfterMs: OVERLAY_HIDE_AFTER_MS }, setVisible);
    flagRef.current = flag;
    return () => {
      flag.dispose();
      flagRef.current = null;
    };
  }, []);
  useEffect(() => flagRef.current?.set(active), [active]);

  const shown = visible && active;
  return (
    <>
      <div className="sp-page-body" inert={shown}>
        {children}
      </div>
      {shown ? (
        <div className="sp-page-loader">
          <div className="sp-page-loader-inner">
            <GestiLoading text={pickLoadingText(entries)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ErrorState({ text }: { text: string }) {
  return (
    <div className="sp-state sp-error-state" role="alert">
      <AlertTriangle size={16} />
      <strong>{text}</strong>
    </div>
  );
}

