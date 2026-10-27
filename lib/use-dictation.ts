import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Dictado con la Web Speech API del navegador: gratis y sin backend (la API de
// Claude no transcribe audio). Ojo (privacidad): Chrome procesa el audio en
// servidores de Google y Safari en los de Apple, no en el equipo del usuario.
// Firefox no la tiene: ahí el botón del micrófono no aparece.

type RecognitionAlternative = { readonly transcript: string };

type RecognitionResult = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative | undefined;
};

type RecognitionResultEvent = {
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult | undefined };
};

type RecognitionErrorEvent = { readonly error: string };

// TypeScript no trae los tipos de SpeechRecognition: solo lo que se usa acá.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const noSubscription = () => () => {};

// Si tras pedir el corte nunca llega `onend`, se corta en seco para no dejar el campo bloqueado.
const FINISH_TIMEOUT_MS = 4000;

// Une los trozos con un solo espacio, sin espacios sobrantes en los bordes.
function joinParts(...parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/** Lo que va en el campo: lo que ya estaba escrito + lo reconocido (final e interino). */
export function mergeDictation(base: string, finalText: string, interimText: string) {
  return joinParts(base, finalText, interimText);
}

/** Aviso para el usuario según el error del reconocimiento; null si no hay error. */
export function dictationErrorMessage(error: string | null) {
  if (error === null) return null;
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permití el micrófono para dictar.";
    case "no-speech":
      return "No escuché nada. Probá de nuevo.";
    case "network":
      return "El dictado necesita conexión a internet.";
    case "audio-capture":
      return "No encontré un micrófono para dictar.";
    default:
      return "No se pudo dictar. Probá de nuevo.";
  }
}

/**
 * Etapas del dictado. `starting`: se pidió empezar y el micrófono todavía no
 * está listo (puede estar esperando el permiso). `finishing`: se pidió cortar y
 * se espera la última palabra confirmada y el cierre.
 */
export type DictationPhase = "idle" | "starting" | "listening" | "finishing";

export type DictationEvent = "start" | "started" | "stop" | "end" | "fail";

/** Tope de reanudaciones en un mismo dictado, para no entrar en un bucle. */
export const MAX_DICTATION_RESTARTS = 20;

/**
 * Chrome y Safari cortan la sesión solos (silencio largo, ~1 minuto de audio)
 * aunque se pida `continuous`. Si el usuario no pidió cortar y no hubo error,
 * se abre otra sesión y el dictado sigue sin que se note.
 */
export function shouldResumeDictation({
  phase,
  error,
  restarts
}: {
  phase: DictationPhase;
  error: string | null;
  restarts: number;
}) {
  return phase === "listening" && error === null && restarts < MAX_DICTATION_RESTARTS;
}

/** Transición de fase; los eventos que no corresponden a la fase actual no la cambian. */
export function nextDictationPhase(phase: DictationPhase, event: DictationEvent): DictationPhase {
  switch (event) {
    case "start":
      return phase === "idle" ? "starting" : phase;
    case "started":
      return phase === "starting" ? "listening" : phase;
    case "stop":
      // Sin micrófono todavía no hay nada que esperar: se cierra directo.
      return phase === "listening" ? "finishing" : phase === "starting" ? "idle" : phase;
    case "end":
    case "fail":
      return "idle";
  }
}

const PHASE_LABELS: Record<DictationPhase, string> = {
  idle: "",
  starting: "Preparando el micrófono…",
  listening: "Escuchando…",
  finishing: "Procesando dictado…"
};

/** Texto del estado visible para cada fase; vacío en reposo. */
export function dictationPhaseLabel(phase: DictationPhase) {
  return PHASE_LABELS[phase];
}

export function useDictation({
  lang,
  onText
}: {
  lang: string;
  /** Texto reconocido hasta ahora en esta sesión: lo confirmado y lo interino. */
  onText: (finalText: string, interimText: string) => void;
}) {
  // Falso en el servidor: así la hidratación coincide y el botón aparece después.
  const supported = useSyncExternalStore(noSubscription, () => recognitionConstructor() !== null, () => false);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<DictationPhase>("idle");
  const recognitionRef = useRef<Recognition | null>(null);
  const finishTimerRef = useRef<number | undefined>(undefined);
  const onTextRef = useRef(onText);

  useEffect(() => {
    onTextRef.current = onText;
  });

  // La ref guarda la fase vigente para los callbacks del reconocimiento, que
  // llegan fuera de React y no pueden leer el estado de un render viejo.
  const transition = useCallback((event: DictationEvent) => {
    const next = nextDictationPhase(phaseRef.current, event);
    phaseRef.current = next;
    setPhase(next);
    if (next !== "finishing") window.clearTimeout(finishTimerRef.current);
    return next;
  }, []);

  const release = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    window.clearTimeout(finishTimerRef.current);
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onaudiostart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
  }, []);

  // Lo confirmado en sesiones anteriores del mismo dictado (ver shouldResumeDictation).
  const carriedRef = useRef("");
  const restartsRef = useRef(0);
  const errorRef = useRef<string | null>(null);

  const openSession = useCallback(
    (Recognition: RecognitionConstructor) => {
      // Recursiva: al reanudar, abre la siguiente sesión con los mismos callbacks.
      const open = () => {
        const recognition = new Recognition();
        let sessionFinals = "";
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        // Algunos navegadores solo avisan con `onaudiostart`; el primer resultado también cuenta.
        recognition.onstart = () => transition("started");
        recognition.onaudiostart = () => transition("started");
        // Cada evento trae todos los resultados de la sesión: se reconstruye desde cero.
        recognition.onresult = (event) => {
          transition("started");
          const finals: string[] = [];
          let interim = "";
          for (let index = 0; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result?.[0]?.transcript ?? "";
            if (result?.isFinal) finals.push(transcript);
            else interim = joinParts(interim, transcript);
          }
          sessionFinals = joinParts(...finals);
          onTextRef.current(joinParts(carriedRef.current, sessionFinals), interim);
        };
        recognition.onerror = (event) => {
          // "aborted" es cortar a propósito, no un fallo.
          if (event.error === "aborted") return;
          errorRef.current = event.error;
          setError(event.error);
          transition("fail");
        };
        recognition.onend = () => {
          if (recognitionRef.current !== recognition) return;
          recognitionRef.current = null;
          carriedRef.current = joinParts(carriedRef.current, sessionFinals);
          const resume = shouldResumeDictation({
            phase: phaseRef.current,
            error: errorRef.current,
            restarts: restartsRef.current
          });
          if (resume) {
            restartsRef.current += 1;
            open();
            return;
          }
          transition("end");
        };
        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {
          recognitionRef.current = null;
          errorRef.current = "unknown";
          setError("unknown");
          transition("fail");
        }
      };
      open();
    },
    [lang, transition]
  );

  const start = useCallback(() => {
    const Recognition = recognitionConstructor();
    if (!Recognition || phaseRef.current !== "idle") return;
    setError(null);
    errorRef.current = null;
    carriedRef.current = "";
    restartsRef.current = 0;
    transition("start");
    openSession(Recognition);
  }, [openSession, transition]);

  /** Corte normal: todavía llegan las últimas palabras que ya se dijeron. */
  const stop = useCallback(() => {
    const before = phaseRef.current;
    if (before !== "starting" && before !== "listening") return;
    if (transition("stop") === "finishing") {
      recognitionRef.current?.stop();
      // Si el cierre no llega, no se deja el campo bloqueado.
      finishTimerRef.current = window.setTimeout(() => {
        release();
        transition("end");
      }, FINISH_TIMEOUT_MS);
    } else {
      release();
    }
  }, [release, transition]);

  /** Corte en seco: descarta lo pendiente y el error (al enviar, Escape o desmontar). */
  const cancel = useCallback(() => {
    release();
    transition("end");
    setError(null);
  }, [release, transition]);

  useEffect(() => release, [release]);

  return {
    supported,
    phase,
    /** Hay una sesión en curso (preparando, escuchando o cerrando): el campo no se edita. */
    active: phase !== "idle",
    listening: phase === "listening",
    error,
    start,
    stop,
    cancel
  };
}
