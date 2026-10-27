"use client";

import Image from "next/image";
import { ChevronRight } from "lucide-react";
import type { HeroSummary, NoticeSummary } from "@/components/dashboard/dashboard-helpers";

// La tarjeta principal, como el saldo de una billetera: cuántas tareas piden
// atención hoy y, abajo, el estado de los avisos.
export function BalanceCard({
  greeting,
  firstName,
  summary,
  notices,
  isLoading,
  ariaSummary,
  onOpenGesti,
  onOpenNotices
}: {
  greeting: string;
  firstName: string;
  summary: HeroSummary;
  notices: NoticeSummary;
  isLoading: boolean;
  // La misma información en una frase, para lectores de pantalla.
  ariaSummary: string;
  onOpenGesti: () => void;
  onOpenNotices: () => void;
}) {
  const noticesText =
    notices.toContact === 0
      ? "Sin avisos para contactar"
      : `${notices.toContact} ${notices.toContact === 1 ? "aviso" : "avisos"} para contactar`;

  return (
    <section className="db-hero" aria-label={ariaSummary}>
      <div className="db-hero-top">
        <p>
          {greeting}, {firstName}
        </p>
        <button type="button" className="db-hero-avatar" onClick={onOpenGesti} aria-label="Hablar con Gesti">
          <Image src="/gesti/gesti-avatar.webp" alt="" width={40} height={40} priority />
        </button>
      </div>

      <div className="db-hero-balance">
        <strong aria-hidden="true">{isLoading ? "–" : summary.count}</strong>
        <span>{summary.label}</span>
      </div>
      <p className="db-hero-detail">{isLoading ? "Revisando tus tareas…" : summary.detail}</p>

      <button type="button" className="db-hero-notices" onClick={onOpenNotices}>
        <span className="db-hero-notices-text">
          <span>{noticesText}</span>
          {notices.collectionPct !== null ? (
            <>
              <i aria-hidden="true"> · </i>
              <span>Cobranza {notices.collectionPct}%</span>
            </>
          ) : null}
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
