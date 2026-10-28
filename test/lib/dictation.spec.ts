import { describe, expect, it } from "vitest";
import {
  dictationErrorMessage,
  dictationPhaseLabel,
  MAX_DICTATION_RESTARTS,
  mergeDictation,
  nextDictationPhase,
  shouldResumeDictation
} from "@/lib/use-dictation";

describe("mergeDictation", () => {
  it("joins what was already typed with the recognized text using one space", () => {
    expect(mergeDictation("Hola", "gesti", "cómo estás")).toBe("Hola gesti cómo estás");
  });

  it("returns only the recognized text when the box was empty", () => {
    expect(mergeDictation("", "hola gesti", "")).toBe("hola gesti");
    expect(mergeDictation("", "", "hola")).toBe("hola");
  });

  it("returns only the base when nothing was recognized yet", () => {
    expect(mergeDictation("Escribí esto", "", "")).toBe("Escribí esto");
  });

  it("never leaves leading, trailing or doubled spaces", () => {
    expect(mergeDictation("  Hola  ", "  gesti ", " ")).toBe("Hola gesti");
    expect(mergeDictation("Hola ", " gesti", " cómo")).toBe("Hola gesti cómo");
  });

  it("returns an empty string when everything is empty", () => {
    expect(mergeDictation("", "", "")).toBe("");
    expect(mergeDictation("   ", " ", "  ")).toBe("");
  });

  it("keeps the line breaks of the base text", () => {
    expect(mergeDictation("Primera línea\nSegunda", "tercera", "")).toBe("Primera línea\nSegunda tercera");
  });
});

describe("dictationErrorMessage", () => {
  it("asks for the microphone permission when it was denied", () => {
    expect(dictationErrorMessage("not-allowed")).toBe("Permití el micrófono para dictar.");
    expect(dictationErrorMessage("service-not-allowed")).toBe("Permití el micrófono para dictar.");
  });

  it("explains silence and network failures", () => {
    expect(dictationErrorMessage("no-speech")).toBe("No escuché nada. Probá de nuevo.");
    expect(dictationErrorMessage("network")).toBe("El dictado necesita conexión a internet.");
  });

  it("has no message without an error", () => {
    expect(dictationErrorMessage(null)).toBeNull();
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(dictationErrorMessage("whatever")).toBe("No se pudo dictar. Probá de nuevo.");
  });
});

describe("nextDictationPhase", () => {
  it("goes idle → starting → listening → finishing → idle", () => {
    let phase = nextDictationPhase("idle", "start");
    expect(phase).toBe("starting");
    phase = nextDictationPhase(phase, "started");
    expect(phase).toBe("listening");
    phase = nextDictationPhase(phase, "stop");
    expect(phase).toBe("finishing");
    phase = nextDictationPhase(phase, "end");
    expect(phase).toBe("idle");
  });

  it("does not restart while it is already running", () => {
    expect(nextDictationPhase("starting", "start")).toBe("starting");
    expect(nextDictationPhase("listening", "start")).toBe("listening");
    expect(nextDictationPhase("finishing", "start")).toBe("finishing");
  });

  it("only starts listening from the starting phase", () => {
    expect(nextDictationPhase("idle", "started")).toBe("idle");
    expect(nextDictationPhase("finishing", "started")).toBe("finishing");
    expect(nextDictationPhase("listening", "started")).toBe("listening");
  });

  it("stopping before the microphone is ready has nothing to wait for", () => {
    expect(nextDictationPhase("starting", "stop")).toBe("idle");
  });

  it("ignores stop when it is idle or already finishing", () => {
    expect(nextDictationPhase("idle", "stop")).toBe("idle");
    expect(nextDictationPhase("finishing", "stop")).toBe("finishing");
  });

  it("goes back to idle from any phase when the recognition ends or fails", () => {
    for (const phase of ["idle", "starting", "listening", "finishing"] as const) {
      expect(nextDictationPhase(phase, "end")).toBe("idle");
      expect(nextDictationPhase(phase, "fail")).toBe("idle");
    }
  });
});

describe("dictationPhaseLabel", () => {
  it("describes each active phase and nothing when idle", () => {
    expect(dictationPhaseLabel("idle")).toBe("");
    expect(dictationPhaseLabel("starting")).toBe("Preparando el micrófono…");
    expect(dictationPhaseLabel("listening")).toBe("Escuchando…");
    expect(dictationPhaseLabel("finishing")).toBe("Procesando dictado…");
  });
});

describe("shouldResumeDictation", () => {
  it("resumes when the browser ends the session on its own while listening", () => {
    expect(shouldResumeDictation({ phase: "listening", error: null, restarts: 0 })).toBe(true);
  });

  it("does not resume after the user asked to stop or cancelled", () => {
    expect(shouldResumeDictation({ phase: "finishing", error: null, restarts: 0 })).toBe(false);
    expect(shouldResumeDictation({ phase: "idle", error: null, restarts: 0 })).toBe(false);
  });

  it("does not resume before the microphone was ready", () => {
    expect(shouldResumeDictation({ phase: "starting", error: null, restarts: 0 })).toBe(false);
  });

  it("does not resume after an error, so the message stays visible", () => {
    expect(shouldResumeDictation({ phase: "listening", error: "no-speech", restarts: 0 })).toBe(false);
    expect(shouldResumeDictation({ phase: "listening", error: "network", restarts: 0 })).toBe(false);
  });

  it("stops resuming after MAX_DICTATION_RESTARTS to avoid a loop", () => {
    expect(shouldResumeDictation({ phase: "listening", error: null, restarts: MAX_DICTATION_RESTARTS - 1 })).toBe(true);
    expect(shouldResumeDictation({ phase: "listening", error: null, restarts: MAX_DICTATION_RESTARTS })).toBe(false);
  });
});
