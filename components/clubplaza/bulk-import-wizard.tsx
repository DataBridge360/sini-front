"use client";

// Wizard de carga masiva de jugadores hacia Club Plaza. Réplica funcional del
// BulkImportWizard original (mismo flujo de 3 pasos y mismas categorías del
// preview), adaptado al sistema de diseño de SiniPro. El Excel NO se parsea
// acá: se sube crudo al proxy y Club Plaza devuelve la clasificación.

import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  UserPlus,
  XCircle
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  clubplazaBulkImportConfirm,
  clubplazaBulkImportPreview,
  generatePassword,
  type ImportResult,
  type PlayerCorrection,
  type PreviewResponse
} from "@/lib/clubplaza";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import type { ToastMessage } from "@/components/ui/toast";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (límite del backend de Club Plaza)

const STEPS = ["Subir", "Revisar", "Importar"] as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Las fechas del preview llegan como ISO completo ("1980-07-09T00:00:00.000Z").
function shortDate(value: string): string {
  return value.includes("T") ? value.slice(0, 10) : value;
}

type ConflictRow = {
  label: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
};

type ConflictItem = {
  id: string;
  nombre: string;
  description: string;
  rows: ConflictRow[];
};

export function BulkImportWizard({
  isOpen,
  onClose,
  onImportComplete,
  notify
}: {
  isOpen: boolean;
  onClose: () => void;
  // Recibe el resultado del confirm para que la vista agregue los jugadores
  // creados a la planilla como pendientes, y las correcciones aceptadas
  // (nombre/DNI/fecha corregidos) para replicarlas en la planilla.
  onImportComplete: (result: ImportResult, corrections: PlayerCorrection[]) => void;
  notify: (message: string, tone?: ToastMessage["tone"]) => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [acceptedConflicts, setAcceptedConflicts] = useState<Set<string>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [showNewPlayers, setShowNewPlayers] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Al cerrar se descarta todo el progreso (el preview_token expira solo).
  // Ajuste de estado durante el render (patrón de react.dev) en vez de effect.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setCurrentStep(0);
      setSelectedFile(null);
      setPreview(null);
      setResult(null);
      setAcceptedConflicts(new Set());
      setShowNewPlayers(false);
      setShowExitConfirm(false);
    }
  }

  // Lista unificada de "jugadores con cambios de datos" para pintar tarjetas.
  const allConflicts: ConflictItem[] = useMemo(() => {
    if (!preview) return [];
    return [
      ...(preview.name_changed_players || []).map((c) => ({
        id: c.existing_id,
        nombre: c.nombre_nuevo,
        description: "Mismo DNI y fecha de nacimiento — nombre corregido.",
        rows: [
          { label: "DNI", oldValue: c.dni, newValue: c.dni, changed: false },
          { label: "Nombre", oldValue: c.nombre_existente, newValue: c.nombre_nuevo, changed: true },
          {
            label: "Fecha nac.",
            oldValue: shortDate(c.fecha_nacimiento),
            newValue: shortDate(c.fecha_nacimiento),
            changed: false
          }
        ]
      })),
      ...(preview.dni_changed_players || []).map((c) => ({
        id: c.existing_id,
        nombre: c.nombre_completo,
        description: "Mismo nombre, apellido y fecha de nacimiento — DNI corregido.",
        rows: [
          { label: "DNI", oldValue: c.dni_existente, newValue: c.dni_nuevo, changed: true },
          {
            label: "Fecha nac.",
            oldValue: shortDate(c.fecha_nacimiento),
            newValue: shortDate(c.fecha_nacimiento),
            changed: false
          }
        ]
      })),
      ...(preview.birth_date_conflicts || []).map((c) => ({
        id: c.existing_id,
        nombre: c.nombre_completo,
        description: "Mismo DNI y nombre — fecha de nacimiento a corregir.",
        rows: [
          { label: "DNI", oldValue: c.dni, newValue: c.dni, changed: false },
          {
            label: "Fecha nac.",
            oldValue: shortDate(c.fecha_nacimiento_existente),
            newValue: shortDate(c.fecha_nacimiento_nueva),
            changed: true
          }
        ]
      })),
      ...(preview.dni_conflicts || []).map((c) => ({
        id: c.existing_id,
        nombre: c.nombre_nuevo,
        description: "Mismo DNI con nombre diferente al registrado.",
        rows: [
          { label: "DNI", oldValue: c.dni, newValue: c.dni, changed: false },
          { label: "Nombre", oldValue: c.nombre_existente, newValue: c.nombre_nuevo, changed: true }
        ]
      }))
    ];
  }, [preview]);

  const toggleConflict = (id: string) => {
    setAcceptedConflicts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFileSelect = (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (![".xls", ".xlsx"].includes(ext)) {
      notify("Solo se aceptan archivos .xls o .xlsx", "error");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      notify("El archivo no puede superar los 10 MB", "error");
      return;
    }
    setSelectedFile(file);
    setPreview(null);
    setResult(null);
  };

  const handleUploadAndPreview = async () => {
    if (!selectedFile) return;
    setIsBusy(true);
    try {
      const data = await clubplazaBulkImportPreview(selectedFile);
      // Todos los conflictos arrancan aceptados por defecto (igual que Club Plaza).
      const ids = new Set<string>();
      data.dni_conflicts?.forEach((c) => ids.add(c.existing_id));
      data.birth_date_conflicts?.forEach((c) => ids.add(c.existing_id));
      data.dni_changed_players?.forEach((c) => ids.add(c.existing_id));
      data.name_changed_players?.forEach((c) => ids.add(c.existing_id));
      setPreview(data);
      setAcceptedConflicts(ids);
      setCurrentStep(1);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Error al procesar el archivo", "error");
    } finally {
      setIsBusy(false);
    }
  };

  // Correcciones aceptadas que Club Plaza va a aplicar, expresadas contra el
  // DNI con el que la planilla conoce al jugador (el existente).
  const buildAcceptedCorrections = (): PlayerCorrection[] => {
    if (!preview) return [];
    const accepted = (id: string) => acceptedConflicts.has(id);
    return [
      ...(preview.name_changed_players || [])
        .filter((c) => accepted(c.existing_id))
        .map((c) => ({ dni: c.dni, fullName: c.nombre_nuevo })),
      ...(preview.dni_conflicts || [])
        .filter((c) => accepted(c.existing_id))
        .map((c) => ({ dni: c.dni, fullName: c.nombre_nuevo })),
      ...(preview.birth_date_conflicts || [])
        .filter((c) => accepted(c.existing_id))
        .map((c) => ({ dni: c.dni, birthDate: shortDate(c.fecha_nacimiento_nueva) })),
      ...(preview.dni_changed_players || [])
        .filter((c) => accepted(c.existing_id))
        .map((c) => ({ dni: c.dni_existente, newDni: c.dni_nuevo }))
    ];
  };

  const handleConfirmImport = async () => {
    if (!preview) return;
    setIsBusy(true);
    try {
      const corrections = buildAcceptedCorrections();
      const importResult = await clubplazaBulkImportConfirm({
        preview_token: preview.preview_token,
        overwrite_existing: true,
        accepted_conflict_ids: Array.from(acceptedConflicts),
        test_mode: false
      });
      setResult(importResult);
      setCurrentStep(2);
      onImportComplete(importResult, corrections);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Error en la importación", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const hasProgress = selectedFile !== null || currentStep > 0;
  const handleAttemptClose = () => {
    if (isBusy) return;
    if (currentStep === 2 || !hasProgress) {
      onClose();
    } else {
      setShowExitConfirm(true);
    }
  };

  const canImport = Boolean(
    preview &&
      (preview.new_players.length > 0 ||
        acceptedConflicts.size > 0 ||
        (preview.pagado_to_update?.length ?? 0) > 0)
  );

  const sinCambios = preview
    ? preview.existing_players.length - (preview.pagado_to_update?.length ?? 0)
    : 0;

  return (
    <>
      <Modal title="Carga Masiva de Jugadores" isOpen={isOpen} onClose={handleAttemptClose}>
        <div className="flex flex-col gap-5">
          {/* Stepper */}
          <nav aria-label="Progreso de la carga" className="mx-auto w-full max-w-xs">
            <div className="relative flex items-center justify-between">
              <div className="absolute left-0 top-4 z-0 h-0.5 w-full bg-slate-200" />
              <div
                className={`absolute left-0 top-4 z-0 h-0.5 bg-green-500 transition-all duration-300 ${
                  currentStep === 0 ? "w-0" : currentStep === 1 ? "w-1/2" : "w-full"
                }`}
              />
              {STEPS.map((label, idx) => (
                <div key={label} className="relative z-10 flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ring-4 ring-white transition-colors ${
                      idx < currentStep
                        ? "bg-green-500 text-white"
                        : idx === currentStep
                          ? "bg-blue-600 text-white"
                          : "border border-slate-300 bg-slate-100 text-slate-400"
                    }`}
                  >
                    {idx < currentStep ? <Check size={16} /> : idx + 1}
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      idx < currentStep
                        ? "text-green-600"
                        : idx === currentStep
                          ? "text-slate-900"
                          : "text-slate-400"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </nav>

          {/* ===== Paso 1: Subir archivo ===== */}
          {currentStep === 0 ? (
            <div className="flex flex-col gap-4">
              {selectedFile ? (
                <div className="cp-import-file">
                  <span className="cp-import-file-icon"><FileSpreadsheet size={26} strokeWidth={1.5} /></span>
                  <span className="cp-import-file-name">{selectedFile.name}</span>
                  <span className="cp-import-file-meta">{formatFileSize(selectedFile.size)}</span>
                  <span className="cp-import-file-actions">
                    <label className="sp-secondary-action cp-import-replace">
                      Elegir otro archivo
                      <input
                        className="cp-import-file-input"
                        type="file"
                        accept=".xls,.xlsx"
                        disabled={isBusy}
                        onChange={(event) => {
                          if (event.target.files?.[0]) handleFileSelect(event.target.files[0]);
                        }}
                      />
                    </label>
                    <button type="button" className="sp-primary-action" disabled={isBusy} onClick={handleUploadAndPreview}>
                      {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                      {isBusy ? "Procesando..." : "Procesar archivo"}
                    </button>
                  </span>
                </div>
              ) : (
                <label
                  className="sp-field sp-dropzone"
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!isBusy) event.currentTarget.setAttribute("data-drag", "on");
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                      event.currentTarget.removeAttribute("data-drag");
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.currentTarget.removeAttribute("data-drag");
                    if (isBusy) return;
                    const dropped = event.dataTransfer.files?.[0];
                    if (dropped) handleFileSelect(dropped);
                  }}
                >
                  <span>
                    Archivo Excel <em className="not-italic text-red-500">*</em>
                  </span>
                  <span className="sp-dropzone-area">
                    <span className="sp-dropzone-icon">
                      <FileSpreadsheet size={19} strokeWidth={1.75} />
                    </span>
                    <span className="sp-dropzone-title">Arrastrá el archivo acá</span>
                    <span className="sp-dropzone-hint">o elegilo desde tu computadora</span>
                    <span className="sp-dropzone-action">Elegir archivo</span>
                    <span className="sp-dropzone-formats">.xls o .xlsx · hasta 10 MB</span>
                  </span>
                  <input
                    className="sp-dropzone-input"
                    type="file"
                    accept=".xls,.xlsx"
                    disabled={isBusy}
                    onChange={(event) => {
                      if (event.target.files?.[0]) handleFileSelect(event.target.files[0]);
                    }}
                  />
                </label>
              )}
              <p className="m-0 text-xs leading-relaxed text-slate-500">
                Columnas esperadas: <code>DOCUMENTO</code>, <code>NOMBRE</code>, <code>APELLIDO</code> y{" "}
                <code>FECHA NACIMIENTO</code> (dd/mm/aaaa). Se lee la primera hoja; máximo 10 MB.
              </p>
            </div>
          ) : null}

          {/* ===== Paso 2: Revisar preview ===== */}
          {currentStep === 1 && preview ? (
            <div className="flex flex-col gap-5">
              {/* Tarjetas resumen */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
                  <span className="block text-xl font-bold text-green-600">
                    {preview.new_players.length}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-green-600/70">
                    Nuevos
                  </span>
                </div>
                <div
                  className={`rounded-xl border border-orange-200 bg-orange-50 p-3 text-center ${
                    allConflicts.length > 0 ? "ring-1 ring-orange-300" : ""
                  }`}
                >
                  <span className="block text-xl font-bold text-orange-600">{allConflicts.length}</span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-orange-600/70">
                    Diferencias
                  </span>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
                  <span className="block text-xl font-bold text-red-600">{preview.errors.length}</span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-red-600/70">
                    Errores
                  </span>
                </div>
              </div>

              {/* Jugadores nuevos (expandible) */}
              {preview.new_players.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-green-200">
                  <button
                    type="button"
                    onClick={() => setShowNewPlayers((v) => !v)}
                    className="flex w-full items-center justify-between bg-green-50 px-4 py-3 transition-colors hover:bg-green-100"
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green-700">
                      <UserPlus size={15} />
                      {preview.new_players.length} jugador{preview.new_players.length !== 1 ? "es" : ""}{" "}
                      nuevo{preview.new_players.length !== 1 ? "s" : ""}
                    </span>
                    {showNewPlayers ? (
                      <ChevronUp size={15} className="text-green-600" />
                    ) : (
                      <ChevronDown size={15} className="text-green-600" />
                    )}
                  </button>
                  {showNewPlayers ? (
                    <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto bg-white">
                      {preview.new_players.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="m-0 truncate text-sm font-medium text-slate-900">
                              {p.nombre_completo}
                            </p>
                            <p className="m-0 font-mono text-[11px] text-slate-400">
                              DNI {p.dni} · {shortDate(p.fecha_nacimiento)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Errores del preview */}
              {preview.errors.length > 0 ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="m-0 mb-1.5 flex items-center gap-1.5 text-sm font-medium text-red-600">
                    <AlertTriangle size={15} />
                    Errores encontrados
                  </p>
                  <ul className="m-0 list-none space-y-1 p-0">
                    {preview.errors.slice(0, 3).map((err, idx) => (
                      <li key={idx} className="text-xs text-red-500">
                        Fila {err.row}: {err.message}
                      </li>
                    ))}
                    {preview.errors.length > 3 ? (
                      <li className="text-xs text-slate-400">...y {preview.errors.length - 3} más</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {/* Conflictos (jugadores con cambios de datos) */}
              {allConflicts.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <h3 className="m-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-600">
                    <AlertTriangle size={15} />
                    Conflictos detectados
                  </h3>
                  <div className="flex max-h-[300px] flex-col gap-3 overflow-y-auto pr-1">
                    {allConflicts.map((conflict) => (
                      <div
                        key={conflict.id}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
                      >
                        <div className="p-4">
                          <p className="m-0 text-sm font-bold tracking-tight text-slate-900">
                            {conflict.nombre}
                          </p>
                          <p className="m-0 mt-0.5 text-[11px] text-slate-500">{conflict.description}</p>
                        </div>
                        <div className="divide-y divide-slate-100 border-y border-slate-200 bg-white">
                          <div className="grid grid-cols-[80px_1fr_1fr] gap-2 px-4 pb-1 pt-2">
                            <span />
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                              En sistema
                            </span>
                            <span className="text-right text-[9px] font-bold uppercase tracking-wider text-slate-400">
                              Nuevo valor
                            </span>
                          </div>
                          {conflict.rows.map((row, ri) => (
                            <div
                              key={ri}
                              className="grid grid-cols-[80px_1fr_1fr] items-center gap-2 px-4 py-2"
                            >
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                {row.label}
                              </span>
                              <span
                                className={`font-mono text-sm ${
                                  row.changed ? "text-orange-600" : "text-slate-400"
                                }`}
                              >
                                {row.oldValue}
                              </span>
                              <span
                                className={`text-right font-mono text-sm ${
                                  row.changed ? "font-semibold text-green-600" : "text-slate-400"
                                }`}
                              >
                                {row.newValue}
                              </span>
                            </div>
                          ))}
                        </div>
                        <label className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-100">
                          <input
                            type="checkbox"
                            checked={acceptedConflicts.has(conflict.id)}
                            onChange={() => toggleConflict(conflict.id)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="text-xs font-medium text-slate-500 transition-colors group-hover:text-slate-900">
                            Aceptar cambio y sobreescribir
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Jugadores existentes que pasan a pagado */}
              {(preview.pagado_to_update?.length ?? 0) > 0 ? (
                <section className="flex flex-col gap-2">
                  <h3 className="m-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-600">
                    <Banknote size={15} />
                    Se actualizará estado a pagado
                  </h3>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="m-0 mb-2 text-[11px] text-blue-600/80">
                      Estos jugadores ya existen y pasarán automáticamente a estado pagado:
                    </p>
                    <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                      {preview.pagado_to_update.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-blue-700">
                          <CheckCircle2 size={13} className="shrink-0 text-blue-500" />
                          <span className="font-medium">{p.nombre_completo}</span>
                          <span className="font-mono text-blue-500/70">DNI {p.dni}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {/* Sin cambios */}
              {sinCambios > 0 ? (
                <div className="flex items-center gap-2 text-slate-400">
                  <Info size={16} />
                  <span className="text-xs">
                    {sinCambios} jugador{sinCambios !== 1 ? "es" : ""} sin cambios (datos idénticos)
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ===== Paso 3: Resultado ===== */}
          {currentStep === 2 && result ? (
            <div className="flex flex-col gap-4">
              <div
                className={`flex items-center gap-3 rounded-xl border p-4 ${
                  result.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                }`}
              >
                {result.success ? (
                  <CheckCircle2 size={20} className="shrink-0 text-green-600" />
                ) : (
                  <XCircle size={20} className="shrink-0 text-red-600" />
                )}
                <div>
                  <p
                    className={`m-0 text-sm font-semibold ${
                      result.success ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {result.success ? "Importación exitosa" : "Importación con errores"}
                  </p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">
                    {result.inserted} creados · {result.updated} actualizados · {result.skipped} omitidos
                  </p>
                </div>
              </div>

              {result.created_players && result.created_players.length > 0 ? (
                <div>
                  <p className="m-0 mb-2 text-sm font-medium text-slate-900">
                    Jugadores creados y contraseñas:
                  </p>
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr className="text-left text-slate-500">
                            <th className="px-3 py-2 text-xs font-medium">Nombre</th>
                            <th className="px-3 py-2 text-xs font-medium">DNI</th>
                            <th className="px-3 py-2 text-xs font-medium">Contraseña</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.created_players.map((player, idx) => (
                            <tr key={idx} className="border-t border-slate-100">
                              <td className="px-3 py-2 text-xs text-slate-900">
                                {player.nombre_completo}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-600">{player.dni}</td>
                              <td className="px-3 py-2">
                                <code className="rounded bg-green-100 px-2 py-0.5 font-mono text-xs font-bold text-green-700">
                                  {generatePassword(player.apellido, player.dni)}
                                </code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="m-0 mt-1.5 text-[11px] text-slate-400">
                    Formato: Apellido + últimos 3 dígitos del DNI. Ej: Abarzua875
                  </p>
                </div>
              ) : null}

              {result.errors.length > 0 ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="m-0 mb-1 text-sm font-medium text-red-600">
                    Errores ({result.errors.length})
                  </p>
                  <ul className="m-0 list-none space-y-1 p-0">
                    {result.errors.slice(0, 3).map((err, idx) => (
                      <li key={idx} className="text-xs text-red-500">
                        Fila {err.row} ({err.dni}): {err.error}
                      </li>
                    ))}
                    {result.errors.length > 3 ? (
                      <li className="text-xs text-slate-400">...y {result.errors.length - 3} más</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Acciones. El paso 1 no lleva footer: sin archivo la única acción es
              el dropzone, y con archivo elegido viven las dos junto al archivo. */}
          {currentStep > 0 ? (
            <div className="sp-modal-actions">
              {currentStep === 1 ? (
                <>
                  <button
                    type="button"
                    className="sp-secondary-action"
                    disabled={isBusy}
                    onClick={() => {
                      setCurrentStep(0);
                      setPreview(null);
                    }}
                  >
                    <ArrowLeft size={15} />
                    Volver
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy || !canImport}
                    onClick={handleConfirmImport}
                  >
                    {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    {isBusy ? "Importando..." : "Continuar Importación"}
                  </button>
                </>
              ) : null}

              {currentStep === 2 ? (
                <>
                  <button
                    type="button"
                    className="sp-secondary-action"
                    onClick={() => {
                      setCurrentStep(0);
                      setSelectedFile(null);
                      setPreview(null);
                      setResult(null);
                      setAcceptedConflicts(new Set());
                    }}
                  >
                    <Upload size={15} />
                    Nueva carga
                  </button>
                  <button type="button" className="sp-primary-action" onClick={onClose}>
                    Cerrar
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showExitConfirm}
        title="Salir de la carga masiva"
        message="Si salís ahora, vas a perder todo el progreso de la importación. ¿Estás seguro?"
        confirmLabel="Salir"
        isBusy={false}
        tone="warning"
        onClose={() => setShowExitConfirm(false)}
        onConfirm={() => {
          setShowExitConfirm(false);
          onClose();
        }}
      />
    </>
  );
}
