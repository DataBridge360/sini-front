import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingState } from "@/components/ui/states";

describe("LoadingState", () => {
  it("shows Gesti thinking and the text as a status, without the card box", () => {
    const html = renderToStaticMarkup(createElement(LoadingState, { text: "Cargando pólizas" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("/gesti/poses/gesti-think.webp");
    expect(html).toContain("Cargando pólizas");
    expect(html).not.toContain("sp-state");
  });

  it("renders the compact local presentation when no page overlay is mounted", () => {
    const html = renderToStaticMarkup(createElement(LoadingState, { text: "Cargando archivadas", variant: "local" }));
    expect(html).toContain("sp-loading local");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
});
