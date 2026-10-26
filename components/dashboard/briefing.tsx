"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent } from "react";
import type { Suggestion, SummarySegment } from "@/components/dashboard/dashboard-helpers";

// Arriba de todo: quién saluda (Gesti), una frase con lo que hay hoy y un
// camino corto hacia el chat. Las sugerencias salen de las tareas reales.
export function Briefing({
  dateLabel,
  greeting,
  firstName,
  segments,
  suggestions,
  onAsk,
  onSuggestion
}: {
  dateLabel: string;
  greeting: string;
  firstName: string;
  segments: SummarySegment[];
  suggestions: Suggestion[];
  onAsk: () => void;
  onSuggestion: (suggestion: Suggestion) => void;
}) {
  const [question, setQuestion] = useState("");

  // Gesti todavía no recibe el texto por parámetro: el input es la puerta al chat.
  function submit(event: FormEvent) {
    event.preventDefault();
    onAsk();
  }

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

      <div className="db-briefing-ask">
        <form className="db-ask" onSubmit={submit}>
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Preguntale a Gesti…"
            aria-label="Preguntale a Gesti"
            autoComplete="off"
          />
          <button type="submit" aria-label="Abrir Gesti">
            <ArrowRight size={15} />
          </button>
        </form>
        {suggestions.length > 0 ? (
          <div className="db-suggestions">
            {suggestions.map((suggestion) => (
              <button key={suggestion.label} type="button" onClick={() => onSuggestion(suggestion)}>
                {suggestion.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
