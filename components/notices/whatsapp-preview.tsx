"use client";

import { CheckCheck } from "lucide-react";
import { useState, type ReactNode } from "react";

// Vista previa del mensaje tal como lo va a ver el cliente en WhatsApp:
// *negrita*, _cursiva_, ~tachado~, `mono` y las líneas que arrancan con "- "
// como viñetas. Es solo presentación; el texto que se copia sigue siendo el
// original con los asteriscos (WhatsApp los interpreta al pegarlo).
const INLINE_PATTERN = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE_PATTERN)
    .filter((part) => part !== "")
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      const inner = part.slice(1, -1);

      if (part.startsWith("*") && part.endsWith("*")) {
        return <strong key={key} className="font-semibold">{inner}</strong>;
      }
      if (part.startsWith("_") && part.endsWith("_")) {
        return <em key={key}>{inner}</em>;
      }
      if (part.startsWith("~") && part.endsWith("~")) {
        return <s key={key}>{inner}</s>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={key} className="rounded bg-black/5 px-1 font-mono text-[11.5px]">{inner}</code>;
      }
      return <span key={key}>{part}</span>;
    });
}

function formatWhatsAppMessage(message: string) {
  return message.split("\n").map((line, index) => {
    const key = `line-${index}`;

    if (line.trim() === "") {
      return <div key={key} className="h-2.5" aria-hidden />;
    }

    const bullet = /^\s*[-*•]\s+/.exec(line);
    if (bullet) {
      return (
        <div key={key} className="flex gap-1.5">
          <span aria-hidden>•</span>
          <span>{renderInline(line.slice(bullet[0].length), key)}</span>
        </div>
      );
    }

    return <div key={key}>{renderInline(line, key)}</div>;
  });
}

export function WhatsAppPreview({ message }: { message: string }) {
  const [time] = useState(() =>
    new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
  );

  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-[#efeae2] p-3">
      <div className="flex justify-end">
        <div className="relative max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-800 shadow-sm">
          <div className="break-words">{formatWhatsAppMessage(message)}</div>
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
            {time}
            <CheckCheck size={12} className="text-sky-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
