/**
 * Facts mini-framework for template-first AI lines.
 *
 *   const facts = [
 *     deltaVsPrevious({ id: "commits.delta", … }),
 *     concentration({ id: "commits.burst", series, windowSize: 5, … }),
 *   ];
 *   const fact = pickOne(facts);            // null → render no AI line
 *   <AiLine fact={fact} />                  // renderTemplate + factRows inside
 *
 * See `chooser.ts` for the extension point a future LLM chooser plugs into.
 */
export * from "./chooser";
export * from "./evidence";
export * from "./face";
export * from "./helpers";
export * from "./pick";
export * from "./template";
export * from "./types";
