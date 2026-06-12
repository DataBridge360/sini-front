"use client";

import { AlertTriangle, CheckCircle, X } from "lucide-react";

export type ToastMessage = {
  id: string;
  tone: "success" | "error";
  message: string;
};

export function ToastViewport({
  toasts,
  onDismiss
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="sp-toast-viewport" role="status" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const Icon = toast.tone === "success" ? CheckCircle : AlertTriangle;
        return (
          <div key={toast.id} className={`sp-toast ${toast.tone}`}>
            <Icon size={18} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Cerrar notificación">
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

