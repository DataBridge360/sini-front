"use client";

import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/modal";
import { formatUsageMonth, formatUsd, usagePercent } from "@/lib/gesti-api";
import type { GestiUsageSummary } from "@/lib/gesti-contract";

// "Consumo" de Gesti (solo productor y admin de plataforma): lo gastado en el
// mes contra el presupuesto de la cuenta de la API (es global, no por
// organización) y lo que gastó cada usuario de esta organización.

function UsageBody({ usage }: { usage: GestiUsageSummary }) {
  const percent = usagePercent(usage.spentUsd, usage.budgetUsd);
  const users = [...usage.users].sort((a, b) => b.spentUsd - a.spentUsd);
  const tone = percent >= 100 ? "full" : percent >= 80 ? "high" : "ok";

  return (
    <div className="gesti-usage">
      <section aria-label="Presupuesto del mes">
        <p className="gesti-usage-month">{formatUsageMonth(usage.month)}</p>
        <p className="gesti-usage-figure">
          <strong>{formatUsd(usage.spentUsd)}</strong> de {formatUsd(usage.budgetUsd)}
        </p>
        <div
          className="gesti-usage-bar"
          data-tone={tone}
          role="progressbar"
          aria-label="Presupuesto de Gesti gastado en el mes"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent}% gastado`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="gesti-usage-note">
          {usage.remainingUsd > 0
            ? `Quedan ${formatUsd(usage.remainingUsd)} este mes.`
            : "Se usó todo el presupuesto: Gesti avisa que vuelve el 1 del mes próximo."}{" "}
          El presupuesto es de toda la cuenta de Gesti, no solo de tu organización.
        </p>
      </section>

      <section aria-label="Consumo de tu organización">
        <div className="gesti-usage-head">
          <h3>Tu organización</h3>
          <span>{formatUsd(usage.organizationSpentUsd)}</span>
        </div>
        {users.length === 0 ? (
          <p className="gesti-usage-empty">Todavía nadie usó Gesti este mes.</p>
        ) : (
          <table className="gesti-usage-table">
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col" className="is-number">
                  Consultas
                </th>
                <th scope="col" className="is-number">
                  USD
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <th scope="row">
                    <span className="gesti-usage-name">{user.fullName}</span>
                    {user.email ? <span className="gesti-usage-email">{user.email}</span> : null}
                  </th>
                  <td className="is-number">{user.requests}</td>
                  <td className="is-number">{formatUsd(user.spentUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function GestiUsagePanel({
  isOpen,
  onClose,
  load,
  scope
}: {
  isOpen: boolean;
  onClose: () => void;
  load: () => Promise<GestiUsageSummary>;
  /** Separa el caché por organización. */
  scope: string;
}) {
  const query = useQuery({
    queryKey: ["gesti-usage", scope],
    queryFn: load,
    enabled: isOpen,
    // El gasto cambia con cada respuesta: se vuelve a pedir al abrir.
    staleTime: 0
  });

  return (
    <Modal title="Consumo de Gesti" isOpen={isOpen} onClose={onClose}>
      {query.data ? (
        <UsageBody usage={query.data} />
      ) : query.isError ? (
        <div className="gesti-usage-state" role="alert">
          <p>No se pudo cargar el consumo.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </div>
      ) : (
        <p className="gesti-usage-state" role="status">
          Cargando consumo…
        </p>
      )}
    </Modal>
  );
}
