"use client";

import { ArrowUpRight } from "lucide-react";
import type { Notice } from "@/lib/api";
import { getDaysUntilDue } from "@/lib/format";

// Resumen compacto de la cobranza: lo que antes era la tarjeta grande de
// avisos. El detalle vive en la pestaña Avisos.
export function NoticesSummary({ notices, onOpenNotices }: { notices: Notice[]; onOpenNotices: () => void }) {
  const open = notices.filter((notice) => notice.status !== "pagado");
  const urgent = open.filter((notice) => getDaysUntilDue(notice.due_date) <= 7);
  const toContact = notices.filter((notice) => notice.status === "avisar").length;
  const notified = notices.filter((notice) => notice.status === "avisado").length;
  const paid = notices.filter((notice) => notice.status === "pagado").length;
  const paidRatio = notices.length ? Math.round((paid / notices.length) * 100) : 0;

  return (
    <section className="db-card db-notices" aria-labelledby="db-notices-title">
      <header className="db-card-head">
        <h2 id="db-notices-title">Avisos</h2>
        <button type="button" className="db-link" onClick={onOpenNotices}>
          Gestionar
          <ArrowUpRight size={13} />
        </button>
      </header>

      <p className="db-notices-lead">
        <strong>{open.length}</strong>
        {open.length === 1 ? " aviso abierto" : " avisos abiertos"}
        {urgent.length > 0 ? <em> · {urgent.length} por vencer esta semana</em> : null}
      </p>

      <dl className="db-notices-stats">
        <div>
          <dt>A contactar</dt>
          <dd>{toContact}</dd>
        </div>
        <div>
          <dt>Contactados</dt>
          <dd>{notified}</dd>
        </div>
        <div>
          <dt>Pagados</dt>
          <dd>{paid}</dd>
        </div>
      </dl>

      <div className="db-progress" role="img" aria-label={`Cobranza registrada: ${paidRatio}%`}>
        <span style={{ width: `${paidRatio}%` }} />
      </div>
      <p className="db-notices-foot">Cobranza registrada · {paidRatio}%</p>
    </section>
  );
}
