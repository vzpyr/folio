const ESC_RE = /[&<>"']/g;
const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string, preserveUnderline = false): string {
  if (!preserveUnderline) return s.replace(ESC_RE, (c) => ESC_MAP[c] ?? c);

  const tags: string[] = [];
  const protected_ = s.replace(/<\/?u>/g, (m) => {
    tags.push(m);

    return `\x00U${tags.length - 1}\x00`;
  });

  return protected_
    .replace(ESC_RE, (c) => ESC_MAP[c] ?? c)
    .replace(/\x00U(\d+)\x00/g, (_m, i) => tags[Number(i)] ?? "");
}

let _phN = 0;
const _phMap = new Map<string, string>();

function ph(html: string): string {
  const key = `\x00PH${_phN++}\x00`;

  _phMap.set(key, html);

  return key;
}

function restorePlaceholders(out: string): string {
  for (const [key, html] of [..._phMap.entries()].reverse()) {
    out = out.replaceAll(key, html);
  }

  return out;
}

function safeHref(href: string, allowDataImage = false): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(href);

  if (m) {
    const scheme = m[1].toLowerCase();

    if (scheme === "http" || scheme === "https" || scheme === "mailto")
      return href;
    if (scheme === "blob") return href;
    if (
      allowDataImage &&
      scheme === "data" &&
      href.toLowerCase().startsWith("data:image/")
    )
      return href;

    return "#";
  }

  return href;
}

function renderInline(
  s: string,
  resolveImage?: (ref: string) => string,
): string {
  let out = s;

  out = out.replace(/`([^`]+)`/g, (_m: string, code: string) =>
    ph(`<code>${code}</code>`),
  );
  out = out.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m: string, alt: string, ref: string) => {
      const src = resolveImage ? resolveImage(ref) : "#";

      return `<img src="${safeHref(src, true)}" alt="${alt}" loading="lazy">`;
    },
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^"]*)&quot;)?\)/g,
    (_m: string, text: string, href: string) => {
      return `<a href="${safeHref(href)}" target="_blank" rel="noopener">${text}</a>`;
    },
  );
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");
  out = out.replace(/_(.+?)_/g, "<em>$1</em>");

  return out;
}

export interface RenderOptions {
  resolveImage?: (ref: string) => string;
  tasks?: boolean;
}

function renderCodeFences(out: string): string {
  out = out.replace(
    /^```(\w*)\n([\s\S]*?)^```/gm,
    (_m: string, lang: string, code: string) => {
      const cls = lang ? ` class="lang-${esc(lang)}"` : "";

      return ph(`<pre${cls}><code>${esc(code)}</code></pre>\n`);
    },
  );

  return out.replace(/`([^`]+)`/g, (_m: string, code: string) => {
    return ph(`<code>${esc(code)}</code>`);
  });
}

function renderSizedImages(
  out: string,
  resolveImage?: (ref: string) => string,
): string {
  return out.replace(
    /<img src="([^"]+)" width="(\d+)" alt="([^"]*)">/g,
    (_m: string, ref: string, width: string, alt: string) => {
      const src = resolveImage ? resolveImage(ref) || ref : ref;

      return ph(
        `<img src="${safeHref(src, true)}" width="${width}" alt="${alt}" loading="lazy">`,
      );
    },
  );
}

function escapeAll(out: string): string {
  return esc(out, true);
}

function extractFootnotes(
  out: string,
  footnotes: Map<string, string>,
  fnOrder: string[],
  resolveImage?: (ref: string) => string,
): string {
  return out.replace(
    /^\[\^([\w-]+)\]: (.+)$/gm,
    (_m: string, name: string, def: string) => {
      if (!footnotes.has(name)) fnOrder.push(name);
      footnotes.set(name, renderInline(def.trim(), resolveImage));

      return "";
    },
  );
}

function renderTables(
  out: string,
  resolveImage?: (ref: string) => string,
): string {
  return out.replace(/(?:^\|.*\|\s*$\n?)+/gm, (block: string) => {
    const lines = block
      .trimEnd()
      .split("\n")
      .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, ""));
    const rows = lines.map((l) => l.split("|").map((c) => c.trim()));
    let header: string[] | null = null;
    let body: string[][] = [];

    if (
      rows.length >= 2 &&
      rows[1].length > 0 &&
      rows[1].every((c) => /^:?-{3,}:?$/.test(c))
    ) {
      header = rows[0];
      body = rows.slice(2);
    } else {
      body = rows;
    }

    const ncols = Math.max(
      header?.length ?? 0,
      ...body.map((r) => r.length),
      1,
    );
    const pad = (r: string[]) => {
      const cells = [...r];
      while (cells.length < ncols) cells.push("");

      return cells;
    };
    let html = "<table>";

    if (header) {
      html +=
        "<thead><tr>" +
        pad(header)
          .map((c) => `<th>${renderInline(c, resolveImage)}</th>`)
          .join("") +
        "</tr></thead>";
    }

    html +=
      "<tbody>" +
      body
        .map(
          (r) =>
            "<tr>" +
            pad(r)
              .map((c) => `<td>${renderInline(c, resolveImage)}</td>`)
              .join("") +
            "</tr>",
        )
        .join("") +
      "</tbody></table>";

    return ph(html) + "\n";
  });
}

function renderBlockquotes(
  out: string,
  resolveImage?: (ref: string) => string,
): string {
  return out.replace(/^(?:&gt; .+\n?)+/gm, (block: string) => {
    const inner = block.replace(/^&gt; /gm, "").trimEnd();

    return (
      ph(`<blockquote>${renderInline(inner, resolveImage)}</blockquote>`) + "\n"
    );
  });
}

function renderHeadings(out: string): string {
  return out.replace(/^#{1,6}\s+(.+)$/gm, (m: string, content: string) => {
    const level = m.indexOf(" ");

    return `<h${level}>${content.trim()}</h${level}>`;
  });
}

function renderHr(out: string): string {
  return out.replace(/^[-*_]{3,}[ \t]*$/gm, "<hr>\n");
}

function wrapListItems(out: string): string {
  return out.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
}

function renderLists(out: string, tasks?: boolean): string {
  const listRe = /^([-*]) (.+)$/gm;
  let m: RegExpExecArray | null;
  let rest = "";
  let last = 0;

  while ((m = listRe.exec(out)) !== null) {
    rest += out.slice(last, m.index);

    const lineNo = out.slice(0, m.index).split("\n").length - 1;
    const task = m[2].match(/^\[([ xX])\] (.+)$/);

    if (task) {
      const checked = task[1] !== " " ? " checked" : "";
      const input = tasks
        ? `<input type="checkbox" class="task-toggle" data-task-line="${lineNo}"${checked}>`
        : `<input type="checkbox" disabled${checked}>`;

      rest += `<li class="task">${input} ${task[2]}</li>`;
    } else {
      rest += `<li>${m[2]}</li>`;
    }

    last = m.index + m[0].length;
  }

  out = rest + out.slice(last);

  return wrapListItems(out);
}

function renderOrderedLists(out: string): string {
  out = out.replace(/^\d+\. (.+)$/gm, (_m: string, content: string) => {
    return `<li>${content}</li>`;
  });

  return wrapListItems(out);
}

function renderFootnoteRefs(
  out: string,
  footnotes: Map<string, string>,
): string {
  if (footnotes.size === 0) return out;

  return out.replace(/\[\^([\w-]+)\]/g, (_m: string, name: string) => {
    if (!footnotes.has(name)) return _m;

    return `<sup class="footnote-ref"><a href="#fn-${name}">${name}</a></sup>`;
  });
}

function renderImages(
  out: string,
  resolveImage?: (ref: string) => string,
): string {
  return out.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m: string, alt: string, ref: string) => {
      const src = resolveImage ? resolveImage(ref) : "#";

      return `<img src="${safeHref(src, true)}" alt="${alt}" loading="lazy">`;
    },
  );
}

function renderLinks(out: string): string {
  return out.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^"]*)&quot;)?\)/g,
    (_m: string, text: string, href: string) => {
      return `<a href="${safeHref(href)}" target="_blank" rel="noopener">${text}</a>`;
    },
  );
}

function renderWikiLinks(out: string): string {
  return out.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (_m: string, target: string, alias: string) => {
      const text = alias ?? target;
      const href = `#/note/${encodeURIComponent(target.trim())}`;

      return `<a href="${href}" class="wiki-link">${text.trim()}</a>`;
    },
  );
}

function renderInlineStyles(out: string): string {
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");

  return out.replace(/_(.+?)_/g, "<em>$1</em>");
}

function renderParagraphs(out: string): string {
  return out.replace(
    /^(?!<[a-z/]|\x00)((?:(?!<[a-z/]|\x00).+\n?)+)/gm,
    (block: string) => {
      const trimmed = block.trim();
      if (!trimmed) return "";

      return `<p>${trimmed}</p>`;
    },
  );
}

function appendFootnotes(
  out: string,
  fnOrder: string[],
  footnotes: Map<string, string>,
): string {
  if (fnOrder.length === 0) return out;

  const items = fnOrder
    .map((name) => `<li id="fn-${name}">${footnotes.get(name) ?? ""}</li>`)
    .join("");

  return (
    out +
    `\n<section class="footnotes"><h4>footnotes</h4><ol>${items}</ol></section>`
  );
}

export function renderMarkdown(text: string, opts: RenderOptions = {}): string {
  const resolveImage = opts.resolveImage;

  _phN = 0;
  _phMap.clear();

  const footnotes = new Map<string, string>();
  const fnOrder: string[] = [];
  let out = text;

  out = renderCodeFences(out);
  out = renderSizedImages(out, resolveImage);
  out = escapeAll(out);
  out = extractFootnotes(out, footnotes, fnOrder, resolveImage);
  out = renderTables(out, resolveImage);
  out = renderBlockquotes(out, resolveImage);
  out = renderHeadings(out);
  out = renderHr(out);
  out = renderLists(out, opts.tasks);
  out = renderOrderedLists(out);
  out = renderFootnoteRefs(out, footnotes);
  out = renderImages(out, resolveImage);
  out = renderLinks(out);
  out = renderWikiLinks(out);
  out = renderInlineStyles(out);
  out = renderParagraphs(out);
  out = appendFootnotes(out, fnOrder, footnotes);

  return restorePlaceholders(out);
}
