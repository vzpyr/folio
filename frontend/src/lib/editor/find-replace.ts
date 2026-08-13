import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindReplaceState {
  term: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  current: number;
}

interface FindMeta {
  term?: string;
  caseSensitive?: boolean;
  current?: number;
  clear?: boolean;
}

export const findReplaceKey = new PluginKey<FindReplaceState>("findReplace");

interface Block {
  text: string;
  map: number[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectBlocks(doc: ProseMirrorNode): Block[] {
  const blocks: Block[] = [];
  let buf: { node: ProseMirrorNode; pos: number }[] = [];

  const flush = () => {
    if (!buf.length) return;
    let text = "";
    const map: number[] = [];
    for (const { node, pos } of buf) {
      const t = node.text ?? "";
      for (let i = 0; i < t.length; i++) map.push(pos + i);
      text += t;
    }
    blocks.push({ text, map });
    buf = [];
  };

  doc.descendants((node, pos) => {
    if (node.isBlock) flush();
    else if (node.isText) {
      if (node.text) buf.push({ node, pos });
    } else flush();
    return true;
  });
  flush();

  return blocks;
}

function findInBlock(
  block: Block,
  term: string,
  caseSensitive: boolean,
): FindMatch[] {
  const re = new RegExp(escapeRegExp(term), caseSensitive ? "g" : "gi");
  const out: FindMatch[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(block.text)) !== null) {
    out.push({
      from: block.map[m.index],
      to: block.map[m.index + m[0].length - 1] + 1,
    });
    if (m.index === re.lastIndex) re.lastIndex++;
  }

  return out;
}

function computeMatches(
  doc: ProseMirrorNode,
  term: string,
  caseSensitive: boolean,
): FindMatch[] {
  if (!term) return [];
  return collectBlocks(doc).flatMap((b) => findInBlock(b, term, caseSensitive));
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function scrollToCurrentMatch(editor: Editor): void {
  const st = findReplaceKey.getState(editor.state);
  const m = st && st.current >= 0 ? st.matches[st.current] : undefined;
  if (!m) return;

  const view = editor.view;
  const start = view.coordsAtPos(m.from);
  const end = view.coordsAtPos(m.to);
  if (!start || !end || (start.top === 0 && start.left === 0)) return;

  const scroller = findScrollParent(view.dom.parentElement);
  if (!scroller) return;

  const rect = scroller.getBoundingClientRect();
  const pad = 24;
  const top = Math.min(start.top, end.top);
  const bottom = Math.max(start.bottom, end.bottom);

  if (top < rect.top + pad) {
    scroller.scrollTop -= rect.top + pad - top;
  } else if (bottom > rect.bottom - pad) {
    scroller.scrollTop += bottom - (rect.bottom - pad);
  }
}

const plugin = new Plugin<FindReplaceState>({
  key: findReplaceKey,
  state: {
    init: () => ({ term: "", caseSensitive: false, matches: [], current: -1 }),
    apply(tr, value) {
      const meta = tr.getMeta(findReplaceKey) as FindMeta | undefined;

      let term = value.term;
      let caseSensitive = value.caseSensitive;
      if (meta?.clear) term = "";
      if (meta?.term !== undefined) term = meta.term;
      if (meta?.caseSensitive !== undefined) caseSensitive = meta.caseSensitive;

      let matches = value.matches;
      const rescanned =
        tr.docChanged ||
        (meta !== undefined && (meta.term !== undefined || meta.clear));
      if (rescanned) {
        matches = term ? computeMatches(tr.doc, term, caseSensitive) : [];
      }

      let current = value.current;
      if (meta?.clear) current = -1;
      else if (meta?.current !== undefined) current = meta.current;
      else if (rescanned) {
        current = matches.length
          ? Math.min(Math.max(current, 0), matches.length - 1)
          : -1;
      }
      if (current >= matches.length) {
        current = matches.length ? matches.length - 1 : -1;
      }

      return { term, caseSensitive, matches, current };
    },
  },
  props: {
    decorations(state: EditorState): DecorationSet {
      const st = findReplaceKey.getState(state);
      const matches = st?.matches ?? [];
      const current = st?.current ?? -1;
      if (!matches.length) return DecorationSet.empty;

      const decos = matches.map((m, i) =>
        Decoration.inline(m.from, m.to, {
          class: i === current ? "search-result-current" : "search-result",
        }),
      );

      return DecorationSet.create(state.doc, decos);
    },
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findReplace: {
      find: (term: string, caseSensitive?: boolean) => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replace: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [plugin];
  },
  addCommands() {
    return {
      find:
        (term: string, caseSensitive?: boolean) =>
        ({ state, tr, dispatch }) => {
          const cs =
            caseSensitive ??
            findReplaceKey.getState(state)?.caseSensitive ??
            false;
          const matches = computeMatches(tr.doc, term, cs);
          const current = matches.length ? 0 : -1;

          if (dispatch) {
            tr.setMeta(findReplaceKey, { term, caseSensitive: cs, current });
            if (current >= 0) {
              const m = matches[current];
              tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
              tr.scrollIntoView();
            }
            dispatch(tr);
          }

          return true;
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) => {
          const st = findReplaceKey.getState(state);
          const matches = st?.matches ?? [];
          if (!matches.length) return false;

          const current =
            st && st.current >= 0 ? (st.current + 1) % matches.length : 0;

          if (dispatch) {
            const m = matches[current];
            tr.setMeta(findReplaceKey, { current });
            tr.setSelection(TextSelection.create(state.doc, m.from, m.to));
            tr.scrollIntoView();
            dispatch(tr);
          }

          return true;
        },
      findPrev:
        () =>
        ({ state, tr, dispatch }) => {
          const st = findReplaceKey.getState(state);
          const matches = st?.matches ?? [];
          if (!matches.length) return false;

          const current =
            st && st.current >= 0
              ? (st.current - 1 + matches.length) % matches.length
              : matches.length - 1;

          if (dispatch) {
            const m = matches[current];
            tr.setMeta(findReplaceKey, { current });
            tr.setSelection(TextSelection.create(state.doc, m.from, m.to));
            tr.scrollIntoView();
            dispatch(tr);
          }

          return true;
        },
      replace:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const st = findReplaceKey.getState(state);
          const matches = st?.matches ?? [];
          const current = st?.current ?? -1;
          const m = current >= 0 ? matches[current] : undefined;
          if (!m) return false;
          if (!dispatch) return true;

          if (replacement)
            tr.replaceWith(m.from, m.to, state.schema.text(replacement));
          else tr.delete(m.from, m.to);

          const term = st?.term ?? "";
          const cs = st?.caseSensitive ?? false;
          const next = computeMatches(tr.doc, term, cs);
          const nc = next.length
            ? Math.min(Math.max(current, 0), next.length - 1)
            : -1;

          if (nc >= 0) {
            const nm = next[nc];
            tr.setSelection(TextSelection.create(tr.doc, nm.from, nm.to));
          }

          tr.setMeta(findReplaceKey, {
            term,
            caseSensitive: cs,
            current: nc,
          });
          dispatch(tr);

          return true;
        },
      replaceAll:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const st = findReplaceKey.getState(state);
          const matches = st?.matches ?? [];
          if (!matches.length) return false;
          if (!dispatch) return true;

          for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            if (replacement)
              tr.replaceWith(m.from, m.to, state.schema.text(replacement));
            else tr.delete(m.from, m.to);
          }

          const term = st?.term ?? "";
          const cs = st?.caseSensitive ?? false;
          const next = computeMatches(tr.doc, term, cs);
          const nc = next.length ? 0 : -1;

          if (nc >= 0) {
            const nm = next[nc];
            tr.setSelection(TextSelection.create(tr.doc, nm.from, nm.to));
          }

          tr.setMeta(findReplaceKey, {
            term,
            caseSensitive: cs,
            current: nc,
          });
          dispatch(tr);

          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(findReplaceKey, { clear: true });
            dispatch(tr);
          }

          return true;
        },
    };
  },
});
