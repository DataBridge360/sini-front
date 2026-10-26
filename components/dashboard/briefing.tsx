"use client";

import Image from "next/image";
import type { Suggestion, SummarySegment } from "@/components/dashboard/dashboard-helpers";

// Arriba de todo: quién saluda (Gesti), una frase con lo que hay hoy y hasta
// dos sugerencias armadas con las tareas reales.
export function Briefing({
  dateLabel,
  greeting,
  firstName,
  segments,
  suggestions,
  onSuggestion
}: {
  dateLabel: string;
  greeting: string;
  firstName: string;
  segments: SummarySegment[];
  suggestions: Suggestion[];
  onSuggestion: (suggestion: Suggestion) => void;
}) {
  return (
    <section className="db-briefing" aria-label="Resumen de Gesti">
      <div className="db-briefing-hello">
        <Image className="db-gesti-avatar" src="/gesti/gesti-avatar.webp" alt="Gesti" width={52} height={52} priority />
        <div className="db-briefing-text">
          <span>{dateLabel}</span>
          <h2>
            {greeting}, {firstName}.
          </h2>
          <p>
            {segments.map((segment, index) =>
              segment.tone ? (
                <strong key={index} data-tone={segment.tone}>
                  {segment.text}
                </strong>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </p>
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="db-briefing-ask">
          <div className="db-suggestions">
            {suggestions.map((suggestion) => (
              <button key={suggestion.label} type="button" onClick={() => onSuggestion(suggestion)}>
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
