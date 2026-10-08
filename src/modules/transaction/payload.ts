/**
 * MacroDroid forwards Toss notification text with literal LF/CR/TAB inside
 * JSON string values (e.g. multi-line receipts: "체크카드 | 가게\n..."), which
 * makes the payload invalid JSON. JSON.parse throws on the first 0x0a and the
 * caller's silent catch block was dropping every transaction since 4/20. This
 * scanner walks the raw bytes and escapes control chars only while inside a
 * JSON string, leaving structure ("`{`/`}`/`,`/whitespace) untouched. Cheap
 * (single pass) and never makes valid input invalid.
 */
export function sanitizeMacrodroidJson(raw: string): string {
  let out = "";
  let inString = false;
  let inEscape = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inEscape) {
      out += c;
      inEscape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      inEscape = true;
      continue;
    }
    if (c === '"') {
      out += c;
      inString = !inString;
      continue;
    }
    if (inString) {
      if (c === "\n") {
        out += "\\n";
        continue;
      }
      if (c === "\r") {
        out += "\\r";
        continue;
      }
      if (c === "\t") {
        out += "\\t";
        continue;
      }
    }
    out += c;
  }
  return out;
}

/**
 * Decode a stored/raw MacroDroid payload into its notification title/text.
 * Ingestion and reparse must share this: reparse used a bare JSON.parse and so
 * could never recover any multi-line notification (most card payments).
 * Throws on JSON that stays invalid after sanitizing.
 */
export function decodeNotificationPayload(raw: string): { title: string; text: string } {
  const payload = JSON.parse(sanitizeMacrodroidJson(raw));
  return {
    title: typeof payload?.title === "string" ? payload.title : "",
    text: typeof payload?.text === "string" ? payload.text : "",
  };
}
