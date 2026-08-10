"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  FileText,
  Loader2,
  ScanText,
  Sparkles,
  Upload,
  UserPlus
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiUploadForm, type ApiCommonOptions, type Client, type InsuranceCompany } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  ANALYSIS_ACCEPT,
  matchClient,
  matchCompany,
  toClientPayload,
  toPolicyFormValues,
  type PolicyAnalysis,
  type PolicyAnalysisExtraction
} from "@/lib/policy-analysis";
import type { PolicyFormValues } from "@/lib/shell-types";
import { Modal } from "@/components/ui/modal";
import { WhatsAppPreview } from "@/components/notices/whatsapp-preview";
import { SearchableSelect } from "@/components/ui/selects";

/** Vigencia leída del PDF; alimenta los atajos de fecha de cobro del alta. */
export type CoverageDates = { from: string | null; to: string | null };

type Stage =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number }
  | { kind: "analyzing" }
  | { kind: "done"; result: PolicyAnalysis }
  | { kind: "error"; message: string };

// El análisis tarda entre 20 y 60 segundos. Un spinner mudo todo ese rato se
// lee como app colgada, así que se va contando lo que está pasando.
const PROGRESS_STEPS = [
  "Leyendo el documento…",
  "Identificando al tomador y al asegurado…",
  "Revisando las coberturas…",
  "Anotando sumas y franquicias…",
  "Armando el mensaje para el cliente…",
  "Falta poco…"
];

export function PolicyAnalysisModal({
  isOpen,
  common,
  clients,
  companies,
  onClose,
  onUseData,
  onCreateClient
}: {
  isOpen: boolean;
  common: ApiCommonOptions;
  clients: Client[];
  companies: InsuranceCompany[];
  onClose: () => void;
  onUseData: (values: PolicyFormValues, coverageDates: CoverageDates) => void;
  onCreateClient: (body: Record<string, string>) => Promise<Client>;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Nada se persiste: al cerrar, el análisis se descarta (reset de estado
  // derivado durante el render, sin efecto).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setStage({ kind: "idle" });
  }

  const analyze = async (file: File) => {
    setStage({ kind: "uploading", progress: 0 });
    try {
      const result = await apiUploadForm<PolicyAnalysis>(
        "/policies/analyze",
        () => {
          const form = new FormData();
          form.set("file", file);
          return form;
        },
        {
          ...common,
          onProgress: (fraction) => {
            setStage(
              fraction >= 1 ? { kind: "analyzing" } : { kind: "uploading", progress: fraction }
            );
          }
        }
      );
      setStage({ kind: "done", result });
    } catch (error) {
      setStage({
        kind: "error",
        message: error instanceof Error ? error.message : "No se pudo analizar la póliza."
      });
    }
  };

  const pickFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void analyze(file);
  };

  return (
    <Modal title="Analizar póliza" isOpen={isOpen} onClose={onClose} size="wide">
      {stage.kind === "idle" ? (
        <div className="flex flex-col gap-3">
          <div
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
              isDragging ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-slate-50/60"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              pickFile(event.dataTransfer.files);
            }}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm">
              <Upload size={20} />
            </span>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-800">
                Arrastrá el PDF de la póliza o elegilo de tu compu
              </p>
              <p className="m-0 mt-1 text-xs text-slate-500">
                No se guarda en ningún lado: se analiza y se descarta.
              </p>
            </div>
            <button
              type="button"
              className="sp-secondary-action"
              onClick={() => inputRef.current?.click()}
            >
              <FileText size={14} />
              Elegir PDF
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ANALYSIS_ACCEPT}
              className="hidden"
              onChange={(event) => {
                pickFile(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      ) : null}

      {stage.kind === "uploading" || stage.kind === "analyzing" ? (
        <AnalyzingState stage={stage} />
      ) : null}

      {stage.kind === "error" ? (
        <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle size={20} />
          </span>
          <p className="m-0 max-w-md text-sm leading-relaxed text-slate-600">{stage.message}</p>
          <button
            type="button"
            className="sp-secondary-action"
            onClick={() => setStage({ kind: "idle" })}
          >
            Probar con otro PDF
          </button>
        </div>
      ) : null}

      {stage.kind === "done" ? (
        <AnalysisResult
          result={stage.result}
          clients={clients}
          companies={companies}
          onDiscard={onClose}
          onUseData={onUseData}
          onCreateClient={onCreateClient}
        />
      ) : null}
    </Modal>
  );
}

function AnalyzingState({ stage }: { stage: { kind: "uploading"; progress: number } | { kind: "analyzing" } }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const step = PROGRESS_STEPS[Math.min(Math.floor(seconds / 8), PROGRESS_STEPS.length - 1)];

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <Loader2 size={28} className="animate-spin text-sky-600" />
      {stage.kind === "uploading" ? (
        <>
          <p className="m-0 text-sm font-semibold text-slate-800">Subiendo el PDF…</p>
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-sky-500 transition-[width] duration-200"
              style={{ width: `${Math.round(stage.progress * 100)}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-sm font-semibold text-slate-800">{step}</p>
          <p className="m-0 text-xs text-slate-500">
            Suele tardar entre 20 y 60 segundos · {seconds}s
          </p>
        </>
      )}
    </div>
  );
}

function AnalysisResult({
  result,
  clients,
  companies,
  onDiscard,
  onUseData,
  onCreateClient
}: {
  result: PolicyAnalysis;
  clients: Client[];
  companies: InsuranceCompany[];
  onDiscard: () => void;
  onUseData: (values: PolicyFormValues, coverageDates: CoverageDates) => void;
  onCreateClient: (body: Record<string, string>) => Promise<Client>;
}) {
  const { extraccion, mensaje, meta } = result;
  // El padrón entero puede tener miles de filas: no se recorre en cada render.
  const clientMatch = useMemo(() => matchClient(clients, extraccion), [clients, extraccion]);
  const companyMatch = useMemo(() => matchCompany(companies, extraccion), [companies, extraccion]);
  const [clientId, setClientId] = useState(clientMatch?.item.id ?? "");
  const [companyId, setCompanyId] = useState(companyMatch?.item.id ?? "");
  const [createdClientName, setCreatedClientName] = useState<string | null>(null);
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const { tomador } = extraccion;

  const createClientFromPolicy = async () => {
    setIsCreatingClient(true);
    setClientError(null);
    try {
      const created = await onCreateClient(toClientPayload(tomador));
      setClientId(created.id);
      setCreatedClientName(created.full_name);
    } catch (error) {
      setClientError(error instanceof Error ? error.message : "No se pudo crear el asegurado.");
    } finally {
      setIsCreatingClient(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {extraccion.alertas.length > 0 || meta.sinCapaDeTexto ? (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 text-xs leading-relaxed text-amber-900">
            <p className="m-0 font-semibold">Revisá estos datos antes de cargarlos</p>
            {meta.sinCapaDeTexto ? (
              <p className="m-0 mt-1 flex items-center gap-1.5">
                <ScanText size={12} />
                El PDF es un escaneo, así que los datos pueden tener errores de lectura.
              </p>
            ) : null}
            {extraccion.alertas.length > 0 ? (
              <ul className="m-0 mt-1 list-disc pl-4">
                {extraccion.alertas.map((alerta) => (
                  <li key={alerta}>{alerta}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      <Section title="Datos de la póliza">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 max-[560px]:grid-cols-1">
          <Field label="Compañía" value={extraccion.compania} />
          <Field label="N° de póliza" value={extraccion.numeroPoliza} />
          <Field label="Tipo" value={extraccion.tipo} hint={extraccion.tipoDetalle} />
          <Field
            label="Vigencia"
            value={
              extraccion.vigenciaDesde || extraccion.vigenciaHasta
                ? `${extraccion.vigenciaDesde ? formatDate(extraccion.vigenciaDesde) : "—"} → ${
                    extraccion.vigenciaHasta ? formatDate(extraccion.vigenciaHasta) : "—"
                  }`
                : null
            }
          />
          {extraccion.asegurado ? (
            <Field label="Asegurado" value={extraccion.asegurado} />
          ) : null}
          {extraccion.beneficiario ? (
            <Field label="Beneficiario" value={extraccion.beneficiario} />
          ) : null}
        </div>
      </Section>

      <Section title="Tomador">
        <div className="grid grid-cols-3 gap-x-6 gap-y-3 max-[560px]:grid-cols-2">
          <Field label="Nombre" value={tomador.nombre} />
          <Field
            label="Documento"
            value={
              tomador.documentoNumero
                ? `${tomador.documentoTipo ?? "DNI"} ${tomador.documentoNumero}`
                : null
            }
          />
          <Field label="Teléfono" value={tomador.telefono} />
          <Field label="Localidad" value={tomador.localidad} hint={tomador.provincia} />
          <Field label="Dirección" value={tomador.direccion} />
          {tomador.email ? <Field label="Email" value={tomador.email} /> : null}
        </div>
      </Section>

      <Section title="Bien asegurado">
        <BienAsegurado bien={extraccion.bienAsegurado} />
      </Section>

      {extraccion.coberturas.length > 0 ? (
        <Section title={`Coberturas (${extraccion.coberturas.length})`}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {extraccion.coberturas.map((cobertura, index) => (
              <li
                key={`${cobertura.nombre}-${index}`}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-slate-100 pb-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-semibold text-slate-800">{cobertura.nombre}</p>
                  {cobertura.franquicia ? (
                    <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                      Franquicia: {cobertura.franquicia}
                    </span>
                  ) : null}
                </div>
                {cobertura.sumaAsegurada ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">
                    {cobertura.sumaAsegurada}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Mensaje para el cliente">
        <MessageCard message={mensaje} />
      </Section>

      <Section title="Antes de crear la póliza">
        <div className="flex flex-col gap-3">
          <MatchRow
            label="Asegurado"
            extracted={extraccion.asegurado ?? tomador.nombre}
            matched={createdClientName ?? clientMatch?.item.full_name ?? null}
            value={clientId}
            options={clients.map((client) => ({ value: client.id, label: client.full_name }))}
            placeholder="Elegí el asegurado"
            onChange={setClientId}
          />
          {/* Sin match: se puede dar de alta con el teléfono y la localidad que
              ya trae la póliza, sin salir del modal ni tipear nada. */}
          {!clientId && tomador.nombre ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-600">
                {tomador.nombre} no está en tus asegurados.
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                onClick={() => void createClientFromPolicy()}
                disabled={isCreatingClient}
              >
                {isCreatingClient ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <UserPlus size={13} />
                )}
                Darlo de alta con estos datos
              </button>
              <span className="text-[11px] text-slate-500">
                {[tomador.telefono, tomador.localidad].filter(Boolean).join(" · ") || "sin contacto"}
              </span>
            </div>
          ) : null}
          {clientError ? <div className="sp-pay-error">{clientError}</div> : null}
          <MatchRow
            label="Compañía"
            extracted={extraccion.compania}
            matched={companyMatch ? companyMatch.item.name : null}
            value={companyId}
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
            placeholder="Elegí la compañía"
            onChange={setCompanyId}
          />
        </div>
      </Section>

      <div className="sp-modal-actions">
        <button type="button" className="sp-secondary-action" onClick={onDiscard}>
          Descartar
        </button>
        <button
          type="button"
          className="sp-primary-action"
          onClick={() =>
            onUseData(toPolicyFormValues(extraccion, clientId, companyId), {
              from: extraccion.vigenciaDesde,
              to: extraccion.vigenciaHasta
            })
          }
        >
          <ArrowRight size={14} />
          Crear póliza con estos datos
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="m-0 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

// Los campos vacíos se muestran igual, en gris: que se vea qué no trajo el PDF.
function Field({
  label,
  value,
  hint,
  mono
}: {
  label: string;
  value: string | number | null;
  hint?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <p
        className={`m-0 text-sm ${value ? "text-slate-800" : "text-slate-400"} ${
          mono ? "font-mono font-semibold tracking-wider" : ""
        }`}
      >
        {value || "—"}
      </p>
      {hint ? <p className="m-0 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function BienAsegurado({ bien }: { bien: PolicyAnalysisExtraction["bienAsegurado"] }) {
  const grid = "grid grid-cols-3 gap-x-6 gap-y-3 max-[560px]:grid-cols-2";

  if (bien.vehiculo) {
    const { marca, modelo, anio, patente, uso } = bien.vehiculo;
    return (
      <div className={grid}>
        <Field label="Marca" value={marca} />
        <Field label="Modelo" value={modelo} />
        <Field label="Año" value={anio} />
        <Field label="Patente" value={patente} mono />
        <Field label="Uso" value={uso} />
      </div>
    );
  }

  if (bien.ubicacion) {
    const { direccion, localidad, actividad, destino } = bien.ubicacion;
    return (
      <div className={grid}>
        <Field label="Dirección" value={direccion} />
        <Field label="Localidad" value={localidad} />
        <Field label="Actividad" value={actividad} />
        <Field label="Destino" value={destino} />
      </div>
    );
  }

  return <p className="m-0 text-sm text-slate-600">{bien.descripcion ?? "Sin detalle."}</p>;
}

function MessageCard({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);

  const copyMessage = () => {
    void navigator.clipboard
      .writeText(message)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-2">
      <WhatsAppPreview message={message} />
      <button
        type="button"
        className={`inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          copied
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 text-slate-600 hover:bg-slate-50"
        }`}
        onClick={copyMessage}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Mensaje copiado" : "Copiar mensaje"}
      </button>
    </div>
  );
}

/**
 * Una fila del panel de resolución: qué decía el PDF y contra qué registro del
 * padrón quedó. Si no hubo match, queda el selector para elegirlo a mano en el
 * acto, sin salir del modal.
 */
function MatchRow({
  label,
  extracted,
  matched,
  value,
  options,
  placeholder,
  onChange
}: {
  label: string;
  extracted: string | null;
  matched: string | null;
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const isResolved = Boolean(value);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
        <p className="m-0 truncate text-sm text-slate-700">{extracted || "No figura en el PDF"}</p>
      </div>
      {isResolved && matched ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <Check size={12} />
          {matched}
        </span>
      ) : (
        <div className="w-64 max-[560px]:w-full">
          <SearchableSelect
            value={value}
            options={options}
            placeholder={placeholder}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

export function AnalyzePolicyButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="sp-secondary-action" type="button" onClick={onClick}>
      <Sparkles size={14} />
      Analizar póliza
    </button>
  );
}
