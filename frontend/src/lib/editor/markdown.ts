export interface Frontmatter {
  id: string;
  title: string;
  created: number;
  updated: number;
  tags: string[];
  pinned: boolean;
  folder: string;
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

export function parseFrontmatter(content: string): {
  meta: Partial<Frontmatter>;
  body: string;
} {
  const m = content.match(FM_RE);
  if (!m) return { meta: {}, body: content };

  const body = content.slice(m[0].length).replace(/^\n/, "");
  const meta: Partial<Frontmatter> = {};

  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;

    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();

    if (key === "id") meta.id = val;
    else if (key === "title") meta.title = val;
    else if (key === "created") meta.created = Date.parse(val) || 0;
    else if (key === "updated") meta.updated = Date.parse(val) || 0;
    else if (key === "pinned") meta.pinned = val === "true";
    else if (key === "folder") meta.folder = val;
    else if (key === "tags") {
      meta.tags = val
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  return { meta, body };
}

export function writeFrontmatter(fm: Frontmatter, body: string): string {
  const lines: string[] = ["---"];

  lines.push(`id: ${fm.id}`);
  if (fm.title) lines.push(`title: ${fm.title}`);
  lines.push(`created: ${new Date(fm.created).toISOString()}`);
  lines.push(`updated: ${new Date(fm.updated).toISOString()}`);
  if (fm.tags.length) lines.push(`tags: [${fm.tags.join(", ")}]`);
  if (fm.pinned) lines.push("pinned: true");
  if (fm.folder) lines.push(`folder: ${fm.folder}`);
  lines.push("---");
  lines.push("");
  lines.push(body);

  return lines.join("\n");
}

export function extractTitle(content: string, id: string): string {
  const { meta, body } = parseFrontmatter(content);

  if (meta.title) return meta.title;

  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();

  return id.slice(0, 8);
}

export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    links.push(m[1].trim());
  }

  return links;
}
