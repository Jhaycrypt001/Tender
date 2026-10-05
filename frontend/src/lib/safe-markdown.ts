/**
 * The only markdown the Ask assistant is allowed to speak: **bold**, `inline
 * code`, and lists whose lines start with "- ". Everything else is shown as
 * the plain text it is.
 *
 * Why a tiny parser instead of a markdown library: the answer is written by a
 * language model that reads merchant-controlled text (invoice references, link
 * labels), so it can be steered by a stranger. A full renderer would turn that
 * into links, images and HTML on the merchant's screen. A markdown image is
 * also a way to send data to another site with no click. This parser has no
 * such output to produce: it returns text runs, and React escapes them.
 *
 * The backend reduces answers to the same subset before they leave the server
 * (backend/src/services/assistant.service.ts, `limitMarkdown`). This is the
 * second lock on the same door.
 */

export type Run = { text: string; bold?: boolean; code?: boolean };
export type Block = { kind: "p"; runs: Run[] } | { kind: "ul"; items: Run[][] };

/** `**bold**` and `` `code` `` runs. An unclosed marker is just text. */
export function parseInline(line: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*(?=\S)([^*]*?\S)\*\*|`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) runs.push({ text: line.slice(last, m.index) });
    runs.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2]!, code: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last) });
  return runs;
}

export function parseAnswer(source: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•]\s+(.*)$/.exec(line);
    if (bullet) {
      const prev = blocks.at(-1);
      const item = parseInline(bullet[1]!);
      if (prev?.kind === "ul") prev.items.push(item);
      else blocks.push({ kind: "ul", items: [item] });
    } else {
      blocks.push({ kind: "p", runs: parseInline(line) });
    }
  }
  return blocks;
}

/** What a screen reader should hear: the words, without the markers. */
export function toPlainText(source: string): string {
  return parseAnswer(source)
    .map((b) => (b.kind === "p" ? b.runs.map((r) => r.text).join("") : b.items.map((i) => i.map((r) => r.text).join("")).join("; ")))
    .join(" ");
}

/** How many `.mo-w` words the renderer will produce, so the reveal is timed to what is shown. */
export function wordCount(source: string): number {
  return toPlainText(source).split(/\s+/).filter(Boolean).length;
}
