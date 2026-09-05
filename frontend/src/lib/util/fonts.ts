import { KEYS } from "./settings.ts";

type FontKind = "sans" | "serif" | "mono";

export interface FontDef {
  id: string;
  label: string;
  family: string;
  kind: FontKind;
  slug?: string;
}

const SYSTEM_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF_STACK = 'Georgia, "Times New Roman", serif';
const MONO_STACK = 'ui-monospace, "Cascadia Code", Consolas, monospace';

function webfont(
  id: string,
  label: string,
  kind: FontKind,
  slug: string,
  stack: string,
): FontDef {
  return { id, label, kind, slug, family: `'${label}', ${stack}` };
}

export const FONTS: FontDef[] = [
  { id: "system", label: "system default", family: SYSTEM_STACK, kind: "sans" },
  webfont("inter", "Inter", "sans", "inter", SYSTEM_STACK),
  webfont(
    "ibm-plex-sans",
    "IBM Plex Sans",
    "sans",
    "ibm-plex-sans",
    SYSTEM_STACK,
  ),
  webfont(
    "source-sans-3",
    "Source Sans 3",
    "sans",
    "source-sans-3",
    SYSTEM_STACK,
  ),
  webfont(
    "space-grotesk",
    "Space Grotesk",
    "sans",
    "space-grotesk",
    SYSTEM_STACK,
  ),
  webfont("manrope", "Manrope", "sans", "manrope", SYSTEM_STACK),
  webfont("figtree", "Figtree", "sans", "figtree", SYSTEM_STACK),
  webfont("public-sans", "Public Sans", "sans", "public-sans", SYSTEM_STACK),
  webfont(
    "instrument-sans",
    "Instrument Sans",
    "sans",
    "instrument-sans",
    SYSTEM_STACK,
  ),
  webfont(
    "plus-jakarta-sans",
    "Plus Jakarta Sans",
    "sans",
    "plus-jakarta-sans",
    SYSTEM_STACK,
  ),
  webfont(
    "source-serif-4",
    "Source Serif 4",
    "serif",
    "source-serif-4",
    SERIF_STACK,
  ),
  webfont("lora", "Lora", "serif", "lora", SERIF_STACK),
  webfont("newsreader", "Newsreader", "serif", "newsreader", SERIF_STACK),
  webfont("spectral", "Spectral", "serif", "spectral", SERIF_STACK),
  webfont("literata", "Literata", "serif", "literata", SERIF_STACK),
  webfont("pt-serif", "PT Serif", "serif", "pt-serif", SERIF_STACK),
  webfont("fraunces", "Fraunces", "serif", "fraunces", SERIF_STACK),
  webfont(
    "jetbrains-mono",
    "JetBrains Mono",
    "mono",
    "jetbrains-mono",
    MONO_STACK,
  ),
  webfont(
    "ibm-plex-mono",
    "IBM Plex Mono",
    "mono",
    "ibm-plex-mono",
    MONO_STACK,
  ),
  webfont("fira-code", "Fira Code", "mono", "fira-code", MONO_STACK),
  webfont("space-mono", "Space Mono", "mono", "space-mono", MONO_STACK),
];

const WEIGHTS = "400,400i,500,600,700,700i";
const APP_LINK_ID = "folio-webfonts";
const CATALOG_LINK_ID = "folio-font-catalog";

function byId(id: string): FontDef | undefined {
  return FONTS.find((f) => f.id === id);
}

function loadWebfonts(id: string, slugs: Set<string>): void {
  let link = document.getElementById(id) as HTMLLinkElement | null;

  if (slugs.size === 0) {
    link?.remove();

    return;
  }

  const families = [...slugs].map((s) => `${s}:${WEIGHTS}`).join("|");
  const href = `https://fonts.bunny.net/css?family=${families}&display=swap`;

  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }

  if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
}

function catalogSlugs(): Set<string> {
  return new Set(FONTS.flatMap((f) => (f.slug ? [f.slug] : [])));
}

export function loadFontCatalog(): void {
  loadWebfonts(CATALOG_LINK_ID, catalogSlugs());
}

export function unloadFontCatalog(): void {
  document.getElementById(CATALOG_LINK_ID)?.remove();
}

export function applyFonts(uiFont: string, editorFont: string): void {
  const ui = byId(uiFont) ?? FONTS[0];
  const ed = byId(editorFont) ?? FONTS[0];
  const root = document.documentElement;
  root.style.setProperty("--font", ui.family);
  root.style.setProperty("--font-editor", ed.family);

  const slugs = new Set<string>();
  if (ui.slug) slugs.add(ui.slug);
  if (ed.slug) slugs.add(ed.slug);
  loadWebfonts(APP_LINK_ID, slugs);

  localStorage.setItem(KEYS.uiFont, ui.id);
  localStorage.setItem(KEYS.editorFont, ed.id);
}
