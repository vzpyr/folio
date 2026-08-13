import MiniSearch, { type SearchResult } from "minisearch";

export interface SearchHit {
  id: string;
  score: number;
  snippet: Snippet | null;
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

interface Doc {
  id: string;
  title: string;
  content: string;
}

const SNIPPET_BEFORE = 48;
const SNIPPET_AFTER = 88;

function fold(term: string): string {
  return term
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function makeIndex(): MiniSearch<Doc> {
  return new MiniSearch<Doc>({
    fields: ["title", "content"],
    storeFields: ["content"],
    searchOptions: { boost: { title: 3 } },
    processTerm: fold,
  });
}

export class SearchIndex {
  private ms = makeIndex();
  private ids = new Set<string>();

  add(id: string, title: string, content: string): void {
    const doc = { id, title, content };

    if (this.ids.has(id)) this.ms.replace(doc);
    else {
      this.ids.add(id);
      this.ms.add(doc);
    }
  }

  remove(id: string): void {
    if (!this.ids.delete(id)) return;

    this.ms.discard(id);
  }

  search(query: string): SearchHit[] {
    return this.ms.search(query, { prefix: true, fuzzy: 0.2 }).map((r) => ({
      id: r.id,
      score: r.score,
      snippet: makeSnippet(r),
    }));
  }
}

function contentTerms(match: Record<string, string[]>): string[] {
  const terms: string[] = [];

  for (const [term, fields] of Object.entries(match)) {
    if (fields.includes("content")) terms.push(term);
  }

  return terms;
}

function makeSnippet(r: SearchResult): Snippet | null {
  const body: string = r.content;
  const terms = contentTerms(r.match);

  if (!body || terms.length === 0) return null;

  const lower = body.toLowerCase();
  let best: { term: string; pos: number } | null = null;

  for (const term of terms) {
    if (term.length < 2) continue;

    const pos = lower.indexOf(term);
    if (pos === -1) continue;

    if (
      !best ||
      term.length > best.term.length ||
      (term.length === best.term.length && pos < best.pos)
    ) {
      best = { term, pos };
    }
  }

  if (!best) return null;

  const start = Math.max(0, best.pos - SNIPPET_BEFORE);
  const end = Math.min(
    body.length,
    best.pos + best.term.length + SNIPPET_AFTER,
  );

  return {
    before: (start > 0 ? "…" : "") + body.slice(start, best.pos),
    match: body.slice(best.pos, best.pos + best.term.length),
    after:
      body.slice(best.pos + best.term.length, end) +
      (end < body.length ? "…" : ""),
  };
}
