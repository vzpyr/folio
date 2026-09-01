let _mobile = $state(false);

function mobileBreakpoint(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--mobile-breakpoint")
    .trim();
  const px = parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : 800;
}

function setup(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return;

  const mql = window.matchMedia(`(max-width: ${mobileBreakpoint()}px)`);
  _mobile = mql.matches;
  mql.addEventListener("change", (e) => (_mobile = e.matches));
}

setup();

export function mobile(): boolean {
  return _mobile;
}
