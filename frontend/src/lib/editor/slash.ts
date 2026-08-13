import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { mount, unmount } from "svelte";
import SlashMenu from "../components/SlashMenu.svelte";
import type { IconName } from "../util/icons.ts";

export interface SlashItem {
  id: string;
  title: string;
  icon: IconName;
  hint: string;
  run: (editor: Editor, range: Range) => void;
}

export interface SlashState {
  items: SlashItem[];
  selected: number;
  query: string;
  onPick: (item: SlashItem) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  {
    id: "h1",
    title: "Heading 1",
    icon: "heading-1",
    hint: "#",
    run: (e, r) => {
      void e
        .chain()
        .focus()
        .deleteRange(r)
        .setNode("heading", { level: 1 })
        .run();
    },
  },
  {
    id: "h2",
    title: "Heading 2",
    icon: "heading-2",
    hint: "##",
    run: (e, r) => {
      void e
        .chain()
        .focus()
        .deleteRange(r)
        .setNode("heading", { level: 2 })
        .run();
    },
  },
  {
    id: "h3",
    title: "Heading 3",
    icon: "heading-3",
    hint: "###",
    run: (e, r) => {
      void e
        .chain()
        .focus()
        .deleteRange(r)
        .setNode("heading", { level: 3 })
        .run();
    },
  },
  {
    id: "bullet",
    title: "Bulleted list",
    icon: "list",
    hint: "-",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).toggleBulletList().run();
    },
  },
  {
    id: "ordered",
    title: "Numbered list",
    icon: "list-ordered",
    hint: "1.",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).toggleOrderedList().run();
    },
  },
  {
    id: "task",
    title: "Task list",
    icon: "list-todo",
    hint: "- [ ]",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).toggleTaskList().run();
    },
  },
  {
    id: "callout",
    title: "Callout",
    icon: "callout",
    hint: "> [!]",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).insertCallout().run();
    },
  },
  {
    id: "quote",
    title: "Quote",
    icon: "quote",
    hint: ">",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).toggleBlockquote().run();
    },
  },
  {
    id: "code",
    title: "Code block",
    icon: "code",
    hint: "```",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).toggleCodeBlock().run();
    },
  },
  {
    id: "math",
    title: "Math block",
    icon: "braces",
    hint: "$$",
    run: (e, r) => {
      void e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: "blockMath", attrs: { latex: "" } })
        .run();
    },
  },
  {
    id: "table",
    title: "Table",
    icon: "table",
    hint: "|",
    run: (e, r) => {
      void e
        .chain()
        .focus()
        .deleteRange(r)
        .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
        .run();
    },
  },
  {
    id: "divider",
    title: "Divider",
    icon: "minus",
    hint: "---",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).setHorizontalRule().run();
    },
  },
  {
    id: "attachment",
    title: "Attachment",
    icon: "paperclip",
    hint: "file",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).run();
      const storage = e.storage as unknown as {
        slashCommand: { onAttachment: () => void };
      };
      storage.slashCommand.onAttachment();
    },
  },
  {
    id: "footnote",
    title: "Footnote",
    icon: "footnote",
    hint: "[^1]",
    run: (e, r) => {
      void e.chain().focus().deleteRange(r).insertFootnote().run();
    },
  },
];

const filterItems = (query: string): SlashItem[] => {
  const q = query.toLowerCase();

  return SLASH_ITEMS.filter((item) => item.title.toLowerCase().includes(q));
};

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      onAttachment: () => {},
    };
  },

  addStorage() {
    return {
      onAttachment: (): void => {},
      element: null as HTMLDivElement | null,
      component: null as ReturnType<typeof mount> | null,
      menu: writable<SlashState>({
        items: [],
        selected: 0,
        query: "",
        onPick: () => {},
      }),
    };
  },

  onCreate() {
    this.storage.onAttachment = this.options.onAttachment;
  },

  onDestroy() {
    const { component, element, menu } = this.storage;
    if (component) unmount(component);
    element?.remove();
    menu.set({ items: [], selected: 0, query: "", onPick: () => {} });
  },

  addProseMirrorPlugins() {
    const key = new PluginKey("slashMenu");
    const menu = this.storage.menu as Writable<SlashState>;
    const storage = this.storage;

    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        pluginKey: key,
        startOfLine: true,
        allow: ({ state }) => {
          const { $from } = state.selection;

          return (
            $from.parent.type.name !== "codeBlock" &&
            !$from.marks().some((mark) => mark.type.name === "code")
          );
        },
        render: () => {
          let element: HTMLDivElement | null = null;
          let component: ReturnType<typeof mount> | undefined;
          let editor: Editor;
          let range: Range;
          let outside: ((event: PointerEvent) => void) | null = null;

          const close = () => {
            editor.view.dispatch(editor.state.tr.setMeta(key, { exit: true }));
          };

          const pick = (item: SlashItem) => {
            item.run(editor, range);
            close();
          };

          const position = (rect: DOMRect | null | undefined) => {
            if (!element || !rect) return;
            if (rect.top === 0 && rect.left === 0) return;

            const width = Math.min(280, window.innerWidth - 16);
            const height = Math.min(240, window.innerHeight - 16);

            element.style.left = `${Math.min(
              rect.left,
              window.innerWidth - width - 8,
            )}px`;
            element.style.top = `${Math.min(
              rect.bottom + 6,
              window.innerHeight - height - 8,
            )}px`;
          };

          const setState = (props: SuggestionProps<SlashItem, SlashItem>) => {
            editor = props.editor;
            range = props.range;
            const items = filterItems(props.query);
            const current = get(menu);

            menu.set({
              items,
              selected: Math.min(
                current.selected,
                Math.max(items.length - 1, 0),
              ),
              query: props.query,
              onPick: pick,
            });
          };

          return {
            element: (() => {
              element = document.createElement("div");
              element.className = "slash-menu";

              return element;
            })(),
            onStart(props: SuggestionProps<SlashItem, SlashItem>) {
              editor = props.editor;
              if (!element) return;

              (editor.options.element as HTMLElement).appendChild(element);
              element.style.display = "";

              if (!component) {
                component = mount(SlashMenu, {
                  target: element,
                  props: { menu },
                });
                storage.component = component;
              }

              outside = (event: PointerEvent) => {
                const target = event.target as Node | null;
                if (target && element && !element.contains(target)) close();
              };
              document.addEventListener("pointerdown", outside, true);

              setState(props);
              position(props.clientRect?.());
            },
            onUpdate(props: SuggestionProps<SlashItem, SlashItem>) {
              setState(props);
              position(props.clientRect?.());
            },
            onExit() {
              if (outside) {
                document.removeEventListener("pointerdown", outside, true);
                outside = null;
              }
              if (element) element.style.display = "none";
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              const state = get(menu);
              if (state.items.length === 0) return false;

              if (props.event.key === "ArrowDown") {
                menu.update((s) => ({
                  ...s,
                  selected: (s.selected + 1) % s.items.length,
                }));

                return true;
              }

              if (props.event.key === "ArrowUp") {
                menu.update((s) => ({
                  ...s,
                  selected: (s.selected - 1 + s.items.length) % s.items.length,
                }));

                return true;
              }

              if (props.event.key === "Enter") {
                pick(state.items[state.selected]);

                return true;
              }

              return false;
            },
          };
        },
      }),
    ];
  },
});
