"use client";

import { AlertTriangle } from "lucide-react";

export function EmptyState({ title, text, compact }: { title: string; text?: string; compact?: boolean }) {
  return (
    <div className={`sp-empty ${compact ? "compact" : ""}`}>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

export function LoadingState({ text }: { text: string }) {
  return (
    <div className="sp-state sp-loading-state" role="status">
      <span />
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

