function stamp(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

export function formatTimestamp(ms: number): string {
  if (!ms) return "";
  return stamp(new Date(ms));
}

export function formatRelative(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;

  if (diff < 0) return "just now";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatTimestamp(ms);
}

export function conflictTitle(title: string): string {
  return `${title} (conflict ${stamp(new Date())})`;
}

export function isConflictTitle(title: string): boolean {
  return title.endsWith(")") && title.includes("(conflict ");
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "";

  if (bytes < 1024) return `${bytes} b`;

  const units = ["kb", "mb", "gb"];
  let v = bytes / 1024;
  let u = 0;

  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }

  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}
