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
