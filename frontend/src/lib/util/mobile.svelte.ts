export const MOBILE_BREAKPOINT = 800;

let _mobile = $state(false);

function setup(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return;

  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  _mobile = mql.matches;
  mql.addEventListener("change", (e) => (_mobile = e.matches));
}

setup();

export function mobile(): boolean {
  return _mobile;
}
