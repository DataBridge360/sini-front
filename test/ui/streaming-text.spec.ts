import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreamingText, type StreamingEmbed } from "@/components/ui/streaming-text";

const TEXT = "Primero el resumen.\n\n• uno\n• dos\n\nAl final, el cierre.";
const BEFORE_LIST = TEXT.indexOf("\n\n• uno");

const chart = (key: string, position: number | undefined, label = key): StreamingEmbed => ({
  key,
  position,
  node: createElement("figure", { "data-chart": label }, label)
});

function render(embeds: StreamingEmbed[], props: { final?: boolean; instant?: boolean; text?: string } = {}): string {
  return renderToStaticMarkup(
    createElement(StreamingText, {
      text: props.text ?? TEXT,
      final: props.final ?? true,
      instant: props.instant ?? true,
      embeds
    })
  );
}

const at = (html: string, needle: string) => html.indexOf(needle);

describe("StreamingText embeds", () => {
  it("renders a chart between the blocks where Gesti showed it, above the action row", () => {
    const html = render([chart("a", BEFORE_LIST)]);

    expect(at(html, "Primero el resumen.")).toBeLessThan(at(html, 'data-chart="a"'));
    expect(at(html, 'data-chart="a"')).toBeLessThan(at(html, "uno"));
    expect(at(html, "Al final, el cierre.")).toBeGreaterThan(at(html, 'data-chart="a"'));
    expect(at(html, 'data-chart="a"')).toBeLessThan(at(html, "gesti-stream-actions"));
  });

  it("never splits a paragraph or a list: a position inside a block lands after it", () => {
    const insideList = TEXT.indexOf("• dos") + 3;
    const html = render([chart("a", insideList)]);

    expect(at(html, "dos")).toBeLessThan(at(html, 'data-chart="a"'));
    expect(at(html, 'data-chart="a"')).toBeLessThan(at(html, "Al final, el cierre."));
  });

  it("puts a chart called before any text above it, and keeps several in the order they were shown", () => {
    const html = render([chart("first", 0), chart("second", BEFORE_LIST), chart("third", BEFORE_LIST)]);

    expect(at(html, 'data-chart="first"')).toBeLessThan(at(html, "Primero el resumen."));
    expect(at(html, 'data-chart="second"')).toBeLessThan(at(html, 'data-chart="third"'));
    expect(at(html, 'data-chart="third"')).toBeLessThan(at(html, "uno"));
  });

  it("renders charts without a position (old messages) after the text and still above the actions", () => {
    const html = render([chart("old", undefined)]);

    expect(at(html, "Al final, el cierre.")).toBeLessThan(at(html, 'data-chart="old"'));
    expect(at(html, 'data-chart="old"')).toBeLessThan(at(html, "gesti-stream-actions"));
  });

  it("clamps a position past the end of the text to after the last block", () => {
    const html = render([chart("late", 99_999)]);

    expect(at(html, "Al final, el cierre.")).toBeLessThan(at(html, 'data-chart="late"'));
    expect(at(html, 'data-chart="late"')).toBeLessThan(at(html, "gesti-stream-actions"));
  });

  it("holds back charts whose position the revealed text has not reached yet while streaming", () => {
    // Recién montado y con el texto todavía llegando: no se reveló nada.
    const html = render([chart("now", 0), chart("later", BEFORE_LIST), chart("old", undefined)], { final: false, instant: false });

    expect(html).toContain('data-chart="now"');
    expect(html).not.toContain('data-chart="later"');
    expect(html).not.toContain('data-chart="old"');
  });

  it("renders nothing extra when there are no charts", () => {
    expect(render([])).not.toContain("gesti-stream-embed");
  });
});
