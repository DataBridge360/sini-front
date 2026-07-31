"use client";

import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TaskAttachment } from "@/lib/api";
import { formatFileSize } from "@/lib/task-attachments";

// Visor de imágenes de la tarea. Recorre TODAS las imágenes de la tarea en orden
// cronológico, no solo las de la actividad desde donde se abrió: si estás
// comparando dos fotos, no querés cerrar y abrir otra actividad para verlas.
export function AttachmentLightbox({
  images,
  startId,
  onClose
}: {
  images: TaskAttachment[];
  startId: string | null;
  onClose: () => void;
}) {
  if (!startId || images.length === 0) return null;

  const startIndex = Math.max(
    0,
    images.findIndex((image) => image.id === startId)
  );

  // Keyed por la imagen de entrada: abrir otra remonta con el índice correcto,
  // pero navegar con las flechas no reinicia nada.
  return <LightboxView key={startId} images={images} startIndex={startIndex} onClose={onClose} />;
}

function LightboxView({
  images,
  startIndex,
  onClose
}: {
  images: TaskAttachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((value) => (value + 1) % images.length);
      if (event.key === "ArrowLeft") setIndex((value) => (value - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [images.length, onClose]);

  const current = images[index];
  if (!current?.url) return null;

  const go = (delta: number) => setIndex((value) => (value + delta + images.length) % images.length);

  return (
    <div
      className="sp-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.file_name}
      onClick={onClose}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (start == null || end == null) return;
        const delta = end - start;
        if (Math.abs(delta) > 50) go(delta < 0 ? 1 : -1);
      }}
    >
      <header className="sp-lightbox-bar" onClick={(event) => event.stopPropagation()}>
        <div className="min-w-0">
          <strong className="block truncate">{current.file_name}</strong>
          <span>
            {formatFileSize(current.file_size_bytes)}
            {images.length > 1 ? ` · ${index + 1} de ${images.length}` : ""}
          </span>
        </div>
        <a href={current.url} target="_blank" rel="noreferrer" aria-label="Abrir original">
          <ExternalLink size={16} />
        </a>
        <a href={current.url} download={current.file_name} aria-label="Descargar">
          <Download size={16} />
        </a>
        <button type="button" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>

      {images.length > 1 ? (
        <button
          type="button"
          className="sp-lightbox-nav left"
          aria-label="Imagen anterior"
          onClick={(event) => {
            event.stopPropagation();
            go(-1);
          }}
        >
          <ChevronLeft size={22} />
        </button>
      ) : null}

      {/* Signed URL temporal: <img> nativo, next/image no aplica acá */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.url}
        alt={current.file_name}
        className="sp-lightbox-image"
        onClick={(event) => event.stopPropagation()}
      />

      {images.length > 1 ? (
        <button
          type="button"
          className="sp-lightbox-nav right"
          aria-label="Imagen siguiente"
          onClick={(event) => {
            event.stopPropagation();
            go(1);
          }}
        >
          <ChevronRight size={22} />
        </button>
      ) : null}
    </div>
  );
}
