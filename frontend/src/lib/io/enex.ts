import type { ParsedImport, RawNote } from "./import.ts";

export function parseEnexFile(bytes: Uint8Array): ParsedImport {
  return parseEnexText(new TextDecoder().decode(bytes));
}

export function parseEnexEntries(
  entries: Record<string, Uint8Array>,
): ParsedImport {
  const dec = new TextDecoder();
  const notes: RawNote[] = [];
  const attachments = new Map<string, Uint8Array<ArrayBuffer>>();

  for (const [p, bytes] of Object.entries(entries)) {
    if (!/\.enex$/i.test(p)) continue;

    const part = parseEnexText(dec.decode(bytes));
    notes.push(...part.notes);
    for (const [k, v] of part.attachments) {
      if (!attachments.has(k)) attachments.set(k, v);
    }
  }

  return { notes, attachments, source: "evernote" };
}

function parseEnexText(xml: string): ParsedImport {
  const notes: RawNote[] = [];
  const attachments = new Map<string, Uint8Array<ArrayBuffer>>();
  const usedNames = new Set<string>();

  for (const block of splitXmlBlocks(xml, "note")) {
    const title = decodeXmlEntities(extractXmlTag(block, "title") ?? "").trim();
    if (!title) continue;
    if (/<active>\s*false\s*<\/active>/i.test(block)) continue;

    const created = parseEnexDate(extractXmlTag(block, "created"));
    const updated = parseEnexDate(extractXmlTag(block, "updated"));
    const tags = [...block.matchAll(/<tag>([\s\S]*?)<\/tag>/gi)]
      .map((m) => decodeXmlEntities(m[1]).trim())
      .filter(Boolean);

    const resources = new Map<string, EnexResource>();
    for (const rb of splitXmlBlocks(block, "resource")) {
      const data = /<data[^>]*>([\s\S]*?)<\/data>/i.exec(rb)?.[1] ?? "";
      if (!data.trim()) continue;

      const bytes = base64ToBytes(data);
      const mime =
        (extractXmlTag(rb, "mime") ?? "").trim() || "application/octet-stream";
      const fileName = decodeXmlEntities(
        extractXmlTag(rb, "file-name") ?? "",
      ).trim();
      const hash = md5Hex(bytes);

      resources.set(hash, {
        hash,
        mime,
        fileName:
          fileName || `attachment-${hash.slice(0, 8)}.${extFromMime(mime)}`,
        bytes,
      });
    }

    const body = enmlToMarkdown(extractEnml(block), (hash) => {
      const res = resources.get(hash);
      if (!res) return "";

      const name = uniqueAttachmentName(usedNames, res.fileName);
      const target = `assets/${name}`;
      if (!attachments.has(target)) {
        attachments.set(target, Uint8Array.from(res.bytes));
      }

      return res.mime.startsWith("image/")
        ? `![${name}](assets/${name})`
        : `[${name}](assets/${name})`;
    });

    const lines = ["---"];
    lines.push(`title: ${title.replace(/\n/g, " ")}`);
    if (created) lines.push(`created: ${new Date(created).toISOString()}`);
    if (updated) lines.push(`updated: ${new Date(updated).toISOString()}`);
    if (tags.length) lines.push(`tags: [${tags.join(", ")}]`);
    lines.push("---", "", body);

    notes.push({
      path: `${title.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-") || "untitled"}.md`,
      folder: "",
      content: lines.join("\n"),
    });
  }

  return { notes, attachments, source: "evernote" };
}

interface EnexResource {
  hash: string;
  mime: string;
  fileName: string;
  bytes: Uint8Array;
}

function splitXmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  let i = 0;

  while (true) {
    const start = xml.indexOf(`<${tag}`, i);
    if (start < 0) break;

    const after = xml[start + tag.length + 1] ?? "";
    if (
      after !== ">" &&
      after !== " " &&
      after !== "\n" &&
      after !== "\t" &&
      after !== "\r"
    ) {
      i = start + tag.length + 1;
      continue;
    }

    const close = xml.indexOf(`</${tag}>`, start);
    if (close < 0) break;

    blocks.push(xml.slice(start, close + tag.length + 3));
    i = close + tag.length + 3;
  }

  return blocks;
}

function extractXmlTag(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);

  return m ? m[1] : null;
}

function parseEnexDate(s: string | null): number | null {
  if (!s) return null;

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(s.trim());
  if (!m) return Date.parse(s) || null;

  const [, y, mo, d, h, mi, se] = m;

  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`) || null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));
}

function extractEnml(block: string): string {
  const content = extractXmlTag(block, "content") ?? "";
  let inner = content;
  const cdataStart = content.indexOf("<![CDATA[");

  if (cdataStart >= 0) {
    const cdataEnd = content.lastIndexOf("]]>");
    if (cdataEnd > cdataStart) inner = content.slice(cdataStart + 9, cdataEnd);
  }

  const start = inner.indexOf("<en-note");
  if (start < 0) return "";

  const tagEnd = inner.indexOf(">", start);
  const close = inner.lastIndexOf("</en-note>");
  if (close < 0) return inner.slice(tagEnd + 1);

  return inner.slice(tagEnd + 1, close);
}

function base64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  return bytes;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
  "image/avif": "avif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
};

function extFromMime(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? "bin";
}

function uniqueAttachmentName(used: Set<string>, fileName: string): string {
  let name = fileName;
  let n = 1;

  while (used.has(name)) {
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    n += 1;
    name = `${base} ${n}${ext}`;
  }

  used.add(name);

  return name;
}

export function md5Hex(bytes: Uint8Array): string {
  const K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
    0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
    0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);
  const SHIFT = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
  ];
  const len = bytes.length;
  const bitLenLo = (len * 8) >>> 0;
  const bitLenHi = Math.floor(len / 0x20000000);
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenLo, true);
  view.setUint32(paddedLen - 4, bitLenHi, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const rot = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

  for (let off = 0; off < paddedLen; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;

      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      F = (F + A + K[i] + M[g]) >>> 0;
      const tmp = D;
      D = C;
      C = B;
      B = (B + rot(F, SHIFT[i])) >>> 0;
      A = tmp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const hex = (n: number) => {
    const b = (i: number) =>
      ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");

    return b(0) + b(1) + b(2) + b(3);
  };

  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

interface EnmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<EnmlNode | string>;
}

interface EnmlCtx {
  depth: number;
  onMedia: (hash: string) => string;
}

const ENML_VOID = new Set([
  "br",
  "hr",
  "img",
  "en-media",
  "en-todo",
  "input",
  "meta",
  "link",
]);

function parseEnml(html: string): Array<EnmlNode | string> {
  const root: Array<EnmlNode | string> = [];
  const stack: Array<Array<EnmlNode | string>> = [root];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].push(html.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].push(html.slice(i, lt));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt);
      if (end < 0) break;
      stack[stack.length - 1].push(html.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (html.startsWith("<!", lt)) {
      const end = html.indexOf(">", lt);
      if (end < 0) break;
      i = end + 1;
      continue;
    }

    const gt = html.indexOf(">", lt);
    if (gt < 0) {
      stack[stack.length - 1].push(html.slice(lt));
      break;
    }
    const raw = html.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (!raw || raw.startsWith("/")) {
      if (raw.startsWith("/")) {
        const tag = raw.slice(1).trim().split(/\s+/)[0];
        for (let k = stack.length - 1; k >= 0; k--) {
          const top = stack[k][stack[k].length - 1];
          if (typeof top !== "string" && top.tag === tag) {
            stack.length = k + 1;
            break;
          }
        }
      }
      continue;
    }

    const m = /^([a-zA-Z][\w-]*)([\s\S]*)$/.exec(raw);
    if (!m) continue;
    const tag = m[1];
    const attrs: Record<string, string> = {};
    const am =
      m[2].match(
        /([a-zA-Z_:][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g,
      ) ?? [];
    for (const a of am) {
      const kv =
        /^([a-zA-Z_:][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?$/.exec(a);
      if (!kv) continue;
      attrs[kv[1].toLowerCase()] = kv[2] ?? kv[3] ?? kv[4] ?? "";
    }

    if (raw.endsWith("/") || ENML_VOID.has(tag)) {
      stack[stack.length - 1].push({ tag, attrs, children: [] });
      continue;
    }

    const node: EnmlNode = { tag, attrs, children: [] };
    stack[stack.length - 1].push(node);
    stack.push(node.children);
  }

  return root;
}

function renderEnmlNodes(
  nodes: Array<EnmlNode | string>,
  ctx: EnmlCtx,
): string {
  return nodes
    .map((n) => (typeof n === "string" ? n : renderEnmlNode(n, ctx)))
    .join("");
}

function enmlInline(node: EnmlNode, ctx: EnmlCtx): string {
  return renderEnmlNodes(node.children, ctx).replace(/\s*\n+\s*/g, " ");
}

function textOf(node: EnmlNode): string {
  return node.children
    .map((c) => (typeof c === "string" ? c : textOf(c)))
    .join("");
}

function renderEnmlNode(node: EnmlNode, ctx: EnmlCtx): string {
  switch (node.tag) {
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "en-todo":
      return node.attrs["checked"] === "true" ? "- [x] " : "- [ ] ";
    case "en-media": {
      const hash = (node.attrs["hash"] ?? "").toLowerCase();

      return hash ? ctx.onMedia(hash) : "";
    }
    case "img": {
      const src = node.attrs["src"] ?? "";
      const alt = node.attrs["alt"] ?? "";

      return src ? `![${alt}](${src})` : "";
    }
    case "b":
    case "strong":
      return `**${enmlInline(node, ctx)}**`;
    case "i":
    case "em":
      return `*${enmlInline(node, ctx)}*`;
    case "u":
      return `<u>${enmlInline(node, ctx)}</u>`;
    case "s":
    case "strike":
    case "del":
      return `~~${enmlInline(node, ctx)}~~`;
    case "a": {
      const href = node.attrs["href"] ?? "";

      return href
        ? `[${enmlInline(node, ctx)}](${href})`
        : enmlInline(node, ctx);
    }
    case "code":
      return `\`${enmlInline(node, ctx)}\``;
    case "span":
    case "font":
    case "mark":
    case "sub":
    case "sup":
      return enmlInline(node, ctx);
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const inner = enmlInline(node, ctx).trim();

      return inner ? `\n\n${"#".repeat(Number(node.tag[1]))} ${inner}\n\n` : "";
    }
    case "p":
    case "div": {
      const inner = renderEnmlNodes(node.children, ctx).trim();

      return inner ? `\n\n${inner}\n\n` : "";
    }
    case "blockquote": {
      const inner = renderEnmlNodes(node.children, ctx).trim();
      if (!inner) return "";

      return `\n\n${inner
        .split("\n")
        .map((l) => (l.trim() ? `> ${l}` : ">"))
        .join("\n")}\n\n`;
    }
    case "ul":
    case "ol":
      return renderList(node, ctx);
    case "pre": {
      const inner = node.children
        .map((c) => (typeof c === "string" ? c : textOf(c)))
        .join("")
        .replace(/\n$/, "");

      return `\n\n\`\`\`\n${inner}\n\`\`\`\n\n`;
    }
    case "table":
      return renderTable(node, ctx);
    case "thead":
    case "tbody":
    case "tfoot":
    case "tr":
    case "td":
    case "th":
    case "li":
      return renderEnmlNodes(node.children, ctx);
    default:
      return renderEnmlNodes(node.children, ctx);
  }
}

function renderList(node: EnmlNode, ctx: EnmlCtx): string {
  const ordered = node.tag === "ol";
  let out = "\n\n";
  let idx = 1;

  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.tag !== "li") continue;

    const marker = ordered ? `${idx++}.` : "-";
    out += renderListItem(child, ctx, marker, ctx.depth);
  }

  return `${out.replace(/\n+$/, "")}\n\n`;
}

function renderListItem(
  li: EnmlNode,
  ctx: EnmlCtx,
  marker: string,
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  const parts: string[] = [];

  for (const child of li.children) {
    if (typeof child === "string") {
      parts.push(child);
    } else if (child.tag === "ul" || child.tag === "ol") {
      parts.push(renderList(child, { ...ctx, depth: depth + 1 }));
    } else if (child.tag === "div" || child.tag === "p") {
      parts.push(renderEnmlNodes(child.children, ctx));
    } else {
      parts.push(renderEnmlNode(child, ctx));
    }
  }

  const joined = parts.join("").replace(/\n{3,}/g, "\n\n");
  const lines = joined.split("\n");
  let out = `${indent}${marker} ${lines[0].trimStart()}`;

  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    out += "\n" + (l.trim() ? `${indent}  ${l.trimStart()}` : "");
  }

  return `${out}\n`;
}

function renderTable(node: EnmlNode, ctx: EnmlCtx): string {
  const rows: EnmlNode[] = [];

  const collect = (n: EnmlNode) => {
    if (n.tag === "tr") rows.push(n);
    else {
      for (const c of n.children) {
        if (typeof c !== "string") collect(c);
      }
    }
  };
  for (const c of node.children) {
    if (typeof c !== "string") collect(c);
  }
  if (rows.length === 0) return "";

  const cellsOf = (r: EnmlNode): EnmlNode[] =>
    r.children.filter(
      (c): c is EnmlNode =>
        typeof c !== "string" && (c.tag === "td" || c.tag === "th"),
    );
  const cellText = (c: EnmlNode) =>
    enmlInline(c, ctx).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
  const rowLine = (r: EnmlNode) =>
    `| ${cellsOf(r).map(cellText).join(" | ")} |`;

  const header = rowLine(rows[0]);
  const sep = `| ${cellsOf(rows[0])
    .map(() => "---")
    .join(" | ")} |`;
  const body = rows.slice(1).map(rowLine).join("\n");

  return `\n\n${header}\n${sep}\n${body}\n\n`;
}

function enmlToMarkdown(
  html: string,
  onMedia: (hash: string) => string,
): string {
  return renderEnmlNodes(parseEnml(html), { depth: 0, onMedia })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
