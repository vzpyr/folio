import type { Editor } from "@tiptap/core";
import { isSafeHref } from "./editor.ts";

interface FmtState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
}

export function fmtState(editor: Editor): FmtState {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    link: editor.isActive("link"),
  };
}

export const toggleBold = (e: Editor) => e.chain().focus().toggleBold().run();

export const toggleItalic = (e: Editor) =>
  e.chain().focus().toggleItalic().run();

export const toggleUnderline = (e: Editor) =>
  e.chain().focus().toggleUnderline().run();

export const toggleStrike = (e: Editor) =>
  e.chain().focus().toggleStrike().run();

export const toggleCode = (e: Editor) => e.chain().focus().toggleCode().run();

export const undo = (e: Editor) => e.chain().focus().undo().run();

export const redo = (e: Editor) => e.chain().focus().redo().run();

export const setLinkHref = (e: Editor, href: string): void => {
  const target = href.trim();
  if (target && !isSafeHref(target)) return;

  if (target) {
    e.chain().focus().extendMarkRange("link").setLink({ href: target }).run();
  } else {
    e.chain().focus().extendMarkRange("link").unsetLink().run();
  }
};

export const insertWikiLink =
  (target: string, alias?: string) =>
  (e: Editor): void => {
    e.chain().focus().insertWikiLink(target, alias).run();
  };
