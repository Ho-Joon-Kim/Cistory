import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { glueFacts } from "./AiLine";

const fact = (text: string) => createElement("b", { key: "f" }, text);
const isFact = (node: unknown) =>
  typeof node === "object" && node !== null && (node as { type?: unknown }).type === "b";
const render = (nodes: unknown[]) =>
  renderToStaticMarkup(createElement("p", null, ...glueFacts(nodes as never[], isFact)));

describe("glueFacts", () => {
  it("keeps the particle and closing punctuation on the fact's line", () => {
    expect(render(["정리 작업(", fact("chore 13건"), ")이에요. 다음"])).toBe(
      '<p>정리 작업<span class="whitespace-nowrap">(<b>chore 13건</b>)이에요.</span> 다음</p>'
    );
    expect(render(["공백 ", fact("4일"), "은 재수집하면"])).toBe(
      '<p>공백 <span class="whitespace-nowrap"><b>4일</b>은</span> 재수집하면</p>'
    );
  });

  it("leaves a fact surrounded by spaces alone", () => {
    expect(render(["공백 ", fact("4일"), " 있어요"])).toBe("<p>공백 <b>4일</b> 있어요</p>");
  });
});
