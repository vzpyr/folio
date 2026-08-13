export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
}

export interface PromptOptions extends ConfirmOptions {
  placeholder?: string;
  initial?: string;
}

type Dialog =
  | { kind: "confirm"; id: string; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | {
      kind: "prompt";
      id: string;
      options: PromptOptions;
      resolve: (value: string | null) => void;
    };

let dialog = $state<Dialog | null>(null);

export function getDialog(): Dialog | null {
  return dialog;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => open({ kind: "confirm", id: crypto.randomUUID(), options, resolve }));
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => open({ kind: "prompt", id: crypto.randomUUID(), options, resolve }));
}

export function cancelDialog(): void {
  const d = dialog;
  if (!d) return;
  dialog = null;
  if (d.kind === "prompt") d.resolve(null);
  else d.resolve(false);
}

export function submitDialog(value: string): void {
  const d = dialog;
  if (!d) return;
  dialog = null;
  if (d.kind === "prompt") d.resolve(value);
  else d.resolve(true);
}

function open(d: Dialog): void {
  if (dialog) cancelDialog();
  dialog = d;
}
