"use client";

import { AlertTriangle } from "lucide-react";
import Image from "next/image";

export function EmptyState({ title, text, compact }: { title: string; text?: string; compact?: boolean }) {
  return (
    <div className={`sp-empty ${compact ? "compact" : ""}`}>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

// Cargando: Gesti pensando, flotando sobre el fondo, sin caja alrededor.
export function LoadingState({ text }: { text: string }) {
  return (
    <div className="sp-loading" role="status">
      <Image src="/gesti/poses/gesti-think.webp" alt="" width={88} height={88} unoptimized />
      <strong>{text}</strong>
    </div>
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

