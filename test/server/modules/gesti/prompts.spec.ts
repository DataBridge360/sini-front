import { describe, expect, it } from "vitest";
import {
  budgetExhaustedReply,
  ERROR_REPLY,
  MAIN_SYSTEM_PROMPT,
  NOT_CONFIGURED_REPLY,
  STATUS_LABEL
} from "@/server/modules/gesti/prompts";

// Gesti trata siempre de usted: a la persona que usa la app y a quien recibe sus borradores.
const VOSEO_OR_TUTEO =
  /\b(sos|hablás|tenés|podés|querés|necesitás|usá|usalo|respondé|decí|decilo|probá|hablá|avisale|avisame|mandame|mandá|enviame|preferí|elegí|llamá|mostralos|ponelo|leelo|desarrollala|citá|recomendá|te|tu|tus|vos)\b/i;

describe("Gesti prompts", () => {
  it("tells the model to address everyone as usted, including client drafts", () => {
    expect(MAIN_SYSTEM_PROMPT).not.toMatch(/rioplatense/i);
    expect(MAIN_SYSTEM_PROMPT).toContain("Trate siempre de usted");
    expect(MAIN_SYSTEM_PROMPT).toContain("Nunca use voseo ni tuteo");
    expect(MAIN_SYSTEM_PROMPT).toContain('"envíeme la foto"');
    expect(MAIN_SYSTEM_PROMPT).toContain('Nunca "mandame la foto"');
    // Lo citado son ejemplos (los que sí y los que no); el resto del prompt va de usted.
    const outsideQuotes = MAIN_SYSTEM_PROMPT.replace(/"[^"]*"/g, "");
    expect(outsideQuotes).not.toMatch(VOSEO_OR_TUTEO);
  });

  it("writes the fixed replies in usted", () => {
    expect(ERROR_REPLY).toBe("No pude responder ahora. Intente de nuevo en un momento.");
    expect(NOT_CONFIGURED_REPLY).toBe(
      "Gesti todavía no está activada en esta cuenta. Pídale al productor que complete la configuración y podrá usarla."
    );
    expect(budgetExhaustedReply("1 de diciembre")).toBe(
      "Este mes ya se usó todo el presupuesto de Gesti, así que por ahora no puedo responder consultas. Vuelve a estar disponible el 1 de diciembre. Si lo necesita antes, consulte con el productor para ampliarlo."
    );
    expect(STATUS_LABEL.portfolio).toBe("Consultando su cartera…");
    for (const text of [ERROR_REPLY, NOT_CONFIGURED_REPLY, budgetExhaustedReply("1 de diciembre"), ...Object.values(STATUS_LABEL)]) {
      expect(text).not.toMatch(VOSEO_OR_TUTEO);
    }
  });
});
