import type { Editor } from "@tiptap/core";

export interface FmtState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
}

export function fmtState(editor: Editor): FmtState {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    heading1: editor.isActive("heading", { level: 1 }),
    heading2: editor.isActive("heading", { level: 2 }),
    heading3: editor.isActive("heading", { level: 3 }),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
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

export const toggleBulletList = (e: Editor) =>
  e.chain().focus().toggleBulletList().run();

export const toggleOrderedList = (e: Editor) =>
  e.chain().focus().toggleOrderedList().run();

export const toggleTaskList = (e: Editor) =>
  e.chain().focus().toggleTaskList().run();

export const toggleBlockquote = (e: Editor) =>
  e.chain().focus().toggleBlockquote().run();

export const toggleCodeBlock = (e: Editor) =>
  e.chain().focus().toggleCodeBlock().run();

export const undo = (e: Editor) => e.chain().focus().undo().run();

export const redo = (e: Editor) => e.chain().focus().redo().run();

export const insertHr = (e: Editor) =>
  e.chain().focus().setHorizontalRule().run();

export const setHeading =
  (level: 1 | 2 | 3) =>
  (e: Editor): void => {
    e.chain().focus().toggleHeading({ level }).run();
  };

export const insertWikiLink =
  (target: string, alias?: string) =>
  (e: Editor): void => {
    e.chain().focus().insertWikiLink(target, alias).run();
  };
