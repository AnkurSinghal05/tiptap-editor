import type { JSONContent } from "@tiptap/core";
import { DOMParser as PMDOMParser, type Schema } from "@tiptap/pm/model";
import { MAX_CLAUSES_PER_REQUEST } from "../api/kb/config";

// Splits a T&C-style file (TXT, DOCX or PDF) into clauses for a new
// document. Everything happens in the browser; nothing is sent anywhere.
//
// - Each paragraph becomes a clause. A list joins the paragraph before it.
// - A heading (a short line on its own, a Word heading, or a bold Word
//   paragraph) becomes a tag on the clauses below it, e.g. "2. Cancellation"
//   → `cancellation`. Subsections need a catalog type and id, which a file
//   can't provide, so every clause goes directly under the vertical.
// - A first line that looks like the document's title is left out: the
//   document's title is the vertical's name.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FILES = ".pdf,.docx,.txt";

export interface FileImport {
  fileName: string;
  // A doc with one section holding only clauses; the vertical's id and title
  // are filled in when it's opened.
  doc: JSONContent;
  clauses: number;
  // Headings that became tags, in order.
  tags: { heading: string; tag: string; clauses: number }[];
  title?: string;
  imagesSkipped: number;
}

type Block = { kind: "heading"; text: string } | { kind: "content"; node: JSONContent; list: boolean };

const SYMBOL_BULLET = /^[-•*–—·▪◦●○■□➢►]\s+/;
const BULLET = /^(?:[-•*–—·▪◦●○■□➢►]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[ivxIVX]{1,4}[.)])\s+/;
const ORDERED_MARKER = /^\(?(?:\d|[a-zA-Z]|[ivxIVX])/;
const TITLE_WORDS = /\b(?:terms|conditions|t\s*&\s*c|faqs?|frequently asked|sla|service level|redemption)\b/i;
const PAGE_NUMBER = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });

// A short line without sentence punctuation, e.g. "Cancellation" or
// "2. Booking:". A longer line ending in a colon introduces a list instead.
const looksLikeHeading = (line: string) => {
  const t = line.trim().replace(/:$/, "");
  const words = t.split(/\s+/).length;
  return t.length > 0 && t.length <= 60 && !/[.;,!?]$/.test(t) && words <= (line.trim().endsWith(":") ? 3 : 8);
};

// "2.1 Cancellation policy" → "cancellation-policy"
const tagOf = (heading: string) =>
  heading
    .replace(/^(?:section|clause|part)\s+/i, "")
    .replace(/^(?:\d+(?:\.\d+)*|[ivxIVX]{1,4}|[a-zA-Z])[.)]?\s+/, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

// Joins hard-wrapped lines, keeping words split by a line-end hyphen whole.
const joinLines = (lines: string[]) =>
  lines.reduce((text, line) => (!text ? line : /[a-z]-$/.test(text) && /^[a-z]/.test(line) ? text.slice(0, -1) + line : `${text} ${line}`), "");

// Lines that each end a sentence are paragraphs of their own (text saved
// with one paragraph per line); otherwise they're one hard-wrapped paragraph.
const paragraphsOf = (lines: string[]): string[] =>
  lines.length === 0 ? [] : lines.length > 1 && lines.slice(0, -1).every((l) => /[.!?]["')\]]?$/.test(l)) ? lines : [joinLines(lines)];

// Plain text: paragraphs are separated by blank lines.
const textBlocks = (text: string): Block[] => {
  const blocks: Block[] = [];
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length > 0);

  for (const lines of paragraphs) {
    // "2. Booking" on its own is a heading; "- Cart hire" on its own isn't.
    if (lines.length === 1 && looksLikeHeading(lines[0]) && !SYMBOL_BULLET.test(lines[0])) {
      blocks.push({ kind: "heading", text: lines[0].replace(/:$/, "") });
      continue;
    }
    const bullets = lines.filter((l) => BULLET.test(l)).length;
    // A single numbered line ("1. Members must…") is a numbered clause, not a list.
    if (bullets === 0 || (bullets === 1 && BULLET.test(lines[0]))) {
      for (const text of paragraphsOf(lines)) blocks.push({ kind: "content", node: paragraph(text), list: false });
      continue;
    }
    let intro: string[] = [];
    let list: { ordered: boolean; items: string[][] } | null = null;
    const flushList = () => {
      if (!list) return;
      blocks.push({
        kind: "content",
        list: true,
        node: {
          type: list.ordered ? "orderedList" : "bulletList",
          content: list.items.map((item) => ({ type: "listItem", content: [paragraph(joinLines(item))] })),
        },
      });
      list = null;
    };
    for (const line of lines) {
      const marker = BULLET.exec(line);
      if (marker) {
        if (intro.length > 0) {
          for (const text of paragraphsOf(intro)) blocks.push({ kind: "content", node: paragraph(text), list: false });
          intro = [];
        }
        list ??= { ordered: ORDERED_MARKER.test(marker[0]), items: [] };
        list.items.push([line.slice(marker[0].length)]);
      } else if (list) {
        // A wrapped list item.
        list.items[list.items.length - 1].push(line);
      } else {
        intro.push(line);
      }
    }
    flushList();
    for (const text of paragraphsOf(intro)) blocks.push({ kind: "content", node: paragraph(text), list: false });
  }
  return blocks;
};

// Word: headings and bold paragraphs are headings; everything else keeps its
// formatting (bold, italic, lists) by going through the editor's own parser.
const docxBlocks = async (buffer: ArrayBuffer, schema: Schema): Promise<{ blocks: Block[]; images: number }> => {
  const { default: mammoth } = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const parser = PMDOMParser.fromSchema(schema);
  const blocks: Block[] = [];
  let images = 0;
  // Bullets typed as text ("• Cart hire") rather than as a Word list.
  let typedBullets: string[] = [];
  const flushTypedBullets = () => {
    if (typedBullets.length === 0) return;
    const items = typedBullets.map((t) => ({ type: "listItem", content: [paragraph(t)] }));
    blocks.push({ kind: "content", list: true, node: { type: "bulletList", content: items } });
    typedBullets = [];
  };

  for (const el of Array.from(body.children)) {
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim() ?? "";
    images += el.querySelectorAll("img").length + (tag === "img" ? 1 : 0);
    if (!text) continue;
    const typed = tag === "p" ? /^[•·▪◦●○■□➢►]\s*(.+)$/.exec(text) : null;
    if (typed) {
      typedBullets.push(typed[1].trim());
      continue;
    }
    flushTypedBullets();
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ kind: "heading", text: text.replace(/:$/, "") });
      continue;
    }
    const boldText = Array.from(el.querySelectorAll("strong, b"))
      .map((b) => b.textContent ?? "")
      .join("")
      .trim();
    if (tag === "p" && looksLikeHeading(text) && boldText === text) {
      blocks.push({ kind: "heading", text: text.replace(/:$/, "") });
      continue;
    }
    // parseSlice reads a node's children, so wrap the element to keep it a block.
    const wrapper = document.createElement("div");
    wrapper.appendChild(el.cloneNode(true));
    parser.parseSlice(wrapper).content.forEach((node) => {
      if (node.type.name === "image" || !node.textContent.trim()) return;
      const list = node.type.name === "bulletList" || node.type.name === "orderedList";
      blocks.push({ kind: "content", node: node.toJSON(), list });
    });
  }
  flushTypedBullets();
  return { blocks, images };
};

// PDF: rebuilds lines and paragraphs from the text layer. A larger gap
// between lines starts a paragraph, a larger font is a heading, and page
// numbers and headers or footers repeated on most pages are dropped.
const pdfText = async (buffer: ArrayBuffer): Promise<string> => {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  type Line = { text: string; x: number; y: number; size: number; page: number };
  const lines: Line[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    let current: Line | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      if (item.str) {
        current ??= { text: "", x: item.transform[4], y: item.transform[5], size: item.height, page: n };
        // A bullet drawn as its own text item: keep it apart from the text.
        current.text += /^[•·▪◦●○■□➢►]$/.test(current.text.trim()) && !/^\s/.test(item.str) ? ` ${item.str}` : item.str;
        current.size = Math.max(current.size, item.height);
      }
      if (item.hasEOL && current) {
        if (current.text.trim()) lines.push({ ...current, text: current.text.trim() });
        current = null;
      }
    }
    if (current?.text.trim()) lines.push({ ...current, text: current.text.trim() });
  }
  if (lines.length === 0) return "";

  // Headers and footers: the same text on at least half the pages.
  const pages = pdf.numPages;
  const seenOn = new Map<string, Set<number>>();
  for (const l of lines) seenOn.set(l.text, (seenOn.get(l.text) ?? new Set()).add(l.page));
  const kept = lines.filter(
    (l) => !PAGE_NUMBER.test(l.text) && !(pages >= 2 && (seenOn.get(l.text)?.size ?? 0) >= Math.max(2, pages / 2)),
  );

  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const gaps = kept.slice(1).flatMap((l, i) => (l.page === kept[i].page && kept[i].y > l.y ? [kept[i].y - l.y] : []));
  const lineGap = median(gaps);
  const bodySize = median(kept.map((l) => l.size));
  const isHeading = (l: Line) => l.size > bodySize * 1.15;
  // Wrapped lines sit about 1.2 font sizes apart. A paragraph gap is wider;
  // the median gap alone can't tell when most paragraphs are one line long.
  const paragraphGap = (l: Line) => Math.min(lineGap > 0 ? lineGap * 1.3 : Infinity, Math.max(l.size, bodySize) * 1.6);

  // Lists whose bullets are drawn as graphics: their lines are indented.
  const bodyX = median(kept.map((l) => l.x));
  kept.forEach((line, i) => {
    if (line.x <= bodyX + bodySize || BULLET.test(line.text) || isHeading(line)) return;
    const prev = kept[i - 1];
    // A wrapped item continues in lowercase after an unfinished line.
    const continues = prev && prev.x > bodyX + bodySize && !/[.:;!?]$/.test(prev.text) && /^[a-z]/.test(line.text);
    if (!continues) line.text = `• ${line.text}`;
  });

  let text = "";
  kept.forEach((line, i) => {
    const prev = kept[i - 1];
    if (!prev) {
      text = line.text;
      return;
    }
    const newPage = line.page !== prev.page;
    const gap = prev.y - line.y;
    const breakHere =
      isHeading(line) ||
      isHeading(prev) ||
      BULLET.test(line.text) ||
      (newPage ? /[.:;!?]$/.test(prev.text) : gap > paragraphGap(line));
    text += (breakHere && !BULLET.test(line.text) ? "\n\n" : "\n") + line.text;
  });
  return text;
};

const toDocument = (blocks: Block[], images: number, fileName: string): FileImport => {
  const clauses: JSONContent[] = [];
  const tags: FileImport["tags"] = [];
  let title: string | undefined;
  let tag: (typeof tags)[number] | null = null;
  let last: JSONContent | null = null;

  blocks.forEach((block, i) => {
    if (block.kind === "heading") {
      // A heading before any clause that's followed by another heading, or
      // that names the document type, is the document's title.
      if (clauses.length === 0 && tags.length === 0 && !title) {
        if (blocks[i + 1]?.kind === "heading" || TITLE_WORDS.test(block.text)) {
          title = block.text;
          return;
        }
      }
      const slug = tagOf(block.text);
      tag = slug ? { heading: block.text, tag: slug, clauses: 0 } : null;
      if (tag) tags.push(tag);
      last = null;
      return;
    }
    if (block.list && last) {
      last.content!.push(block.node);
      return;
    }
    last = { type: "clause", attrs: { tags: tag ? [tag.tag] : [] }, content: [block.node] };
    clauses.push(last);
    if (tag) tag.clauses++;
  });

  if (clauses.length === 0) {
    throw new Error("No text was found in this file. A scanned PDF has no text layer; use a PDF with selectable text.");
  }
  if (clauses.length > MAX_CLAUSES_PER_REQUEST) {
    throw new Error(
      `This file splits into ${clauses.length} clauses, but a document can be created with at most ${MAX_CLAUSES_PER_REQUEST}.`,
    );
  }
  return {
    fileName,
    doc: { type: "doc", content: [{ type: "section", content: clauses }] },
    clauses: clauses.length,
    tags: tags.filter((t) => t.clauses > 0),
    title,
    imagesSkipped: images,
  };
};

export const readDocumentFile = async (file: File, schema: Schema): Promise<FileImport> => {
  const extension = file.name.toLowerCase().split(".").pop();
  if (!["pdf", "docx", "txt"].includes(extension ?? "")) {
    throw new Error(
      extension === "doc"
        ? "Old Word files (.doc) can't be read. Save it as .docx first."
        : "Only PDF, DOCX and TXT files can be read.",
    );
  }
  if (file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 10 MB.");

  try {
    if (extension === "txt") return toDocument(textBlocks(await file.text()), 0, file.name);
    const buffer = await file.arrayBuffer();
    if (extension === "docx") {
      const { blocks, images } = await docxBlocks(buffer, schema);
      return toDocument(blocks, images, file.name);
    }
    return toDocument(textBlocks(await pdfText(buffer)), 0, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("No text") || message.startsWith("This file splits")) throw err;
    throw new Error(`This file couldn't be read: ${message}`);
  }
};
