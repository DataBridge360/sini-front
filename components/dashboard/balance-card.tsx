"use client";

import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { HERO_POSES, type HeroPose, type HeroSummary, type NoticeSummary } from "@/components/dashboard/dashboard-helpers";

// La tarjeta principal, como el saldo de una billetera: cuántas tareas piden
// atención hoy y, abajo, el estado de los avisos.
export function BalanceCard({
  greeting,
  firstName,
  summary,
  notices,
  pose,
  isLoading,
  ariaSummary,
  onOpenGesti,
  onOpenNotices
}: {
  greeting: string;
  firstName: string;
  summary: HeroSummary;
  notices: NoticeSummary;
  // Qué Gesti acompaña la tarjeta según el estado del día.
  pose: HeroPose;
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
      <p className="db-hero-greeting">
        {greeting}, {firstName}
      </p>

      <button type="button" className="db-hero-pose" onClick={onOpenGesti} aria-label="Hablar con Gesti">
        <Image src={HERO_POSES[pose].src} alt={HERO_POSES[pose].alt} width={240} height={240} priority />
      </button>

      <div className="db-hero-balance">
        <strong aria-hidden="true">{isLoading ? "–" : summary.count}</strong>
        <span>{summary.label}</span>
      </div>
      {isLoading ? (
        <p className="db-hero-detail">Revisando tus tareas…</p>
      ) : (
        <ul className="db-hero-chips" aria-hidden="true">
          {summary.chips.map((chip) => (
            <li key={chip.text} data-tone={chip.tone}>
              {chip.text}
            </li>
          ))}
        </ul>
      )}

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
        {notices.collectionPct !== null ? (
          <span className="db-hero-bar" aria-hidden="true">
            <span style={{ width: `${notices.collectionPct}%` }} />
          </span>
        ) : null}
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
