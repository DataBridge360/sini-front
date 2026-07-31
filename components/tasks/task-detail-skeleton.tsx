"use client";

// Esqueleto del detalle: reserva la forma real de la pantalla mientras llega la
// tarea. Sin esto el modal abre con el contenido colapsado y todo salta de lugar
// cuando responde el servidor.
export function TaskDetailSkeleton() {
  return (
    <div className="sp-skeleton" aria-hidden="true">
      <div className="sp-skeleton-fields">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="sp-skeleton-field">
            <i className="sp-skeleton-bar" style={{ width: "38%", height: 9 }} />
            <i className="sp-skeleton-bar" style={{ height: 34 }} />
          </div>
        ))}
      </div>

      <i className="sp-skeleton-bar" style={{ width: "26%", height: 9, marginTop: 22 }} />
      <i className="sp-skeleton-bar" style={{ height: 140, marginTop: 8 }} />
    </div>
  );
}

export function TaskActivitySkeleton() {
  // Alterna lados para insinuar una conversación, no una lista.
  const widths = [72, 54, 84];

  return (
    <div className="sp-skeleton sp-skeleton-activity" aria-hidden="true">
      {widths.map((width, index) => (
        <div key={index} className={index % 2 === 1 ? "sp-skeleton-msg own" : "sp-skeleton-msg"}>
          <i className="sp-skeleton-bar" style={{ width: "40%", height: 8 }} />
          <i className="sp-skeleton-bar" style={{ width: `${width}%`, height: 38, marginTop: 5 }} />
        </div>
      ))}
    </div>
  );
}
