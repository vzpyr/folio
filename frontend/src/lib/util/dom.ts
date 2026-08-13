export function clickOutside(node: HTMLElement, close: () => void) {
  const onDoc = (e: MouseEvent) => {
    if (!node.contains(e.target as Node)) close();
  };

  document.addEventListener("click", onDoc);

  return {
    destroy() {
      document.removeEventListener("click", onDoc);
    },
  };
}

export function autofocus(node: HTMLElement) {
  node.focus();
}

export function checkedAttr(
  node: HTMLInputElement,
  value: boolean,
): { update: (v: boolean) => void } {
  const apply = (v: boolean) => {
    node.toggleAttribute("checked", v);
    node.checked = v;
  };
  apply(value);

  return { update: apply };
}
