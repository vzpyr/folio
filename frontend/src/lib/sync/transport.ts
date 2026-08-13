import type { Envelope } from "../util/crypto.ts";
import type { ManifestItem } from "./types.ts";
import { MAX_RECONNECT_BACKOFF_MS } from "./types.ts";

type PutResult =
  { ok: true; rev: number } | { ok: false; status: number; body: string };

export class ApiClient {
  readonly url: string;
  readonly vaultId: string;
  private token: string;

  constructor(url: string, token: string, vaultId: string) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.vaultId = vaultId;
  }

  get base(): string {
    return `${this.url}/api/vaults/${this.vaultId}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.base}${path}`, { ...init, headers: this.headers() });
  }

  async fetchManifest(): Promise<ManifestItem[]> {
    const res = await this.request("/manifest");
    if (!res.ok) throw new Error(`manifest ${res.status}`);

    const data = (await res.json()) as { items: ManifestItem[] };

    return data.items;
  }

  async fetchItem(opaque: string): Promise<Envelope | null> {
    try {
      const res = await this.request(`/items/${opaque}`);
      if (!res.ok) return null;

      return (await res.json()) as Envelope;
    } catch {
      return null;
    }
  }

  async fetchItems(opaqueIds: string[]): Promise<Map<string, Envelope>> {
    const out = new Map<string, Envelope>();
    const CHUNK = 400;

    for (let i = 0; i < opaqueIds.length; i += CHUNK) {
      const chunk = opaqueIds.slice(i, i + CHUNK);
      let ok = false;

      try {
        const res = await this.request("/batch", {
          method: "POST",
          body: JSON.stringify({ ids: chunk }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            items: (Envelope & { id: string })[];
          };

          for (const item of data.items) {
            if (item?.id && item.rev !== undefined) out.set(item.id, item);
          }

          ok = true;
        }
      } catch {}

      if (!ok) {
        for (const id of chunk) {
          const env = await this.fetchItem(id);
          if (env) out.set(id, env);
        }
      }
    }

    return out;
  }

  async putItem(
    opaque: string,
    baseRev: number,
    nonce: string,
    blob: string,
  ): Promise<PutResult> {
    const res = await this.request(`/items/${opaque}`, {
      method: "PUT",
      body: JSON.stringify({ base_rev: baseRev, nonce, blob }),
    });

    if (res.ok) {
      const data = (await res.json()) as { rev: number };

      return { ok: true, rev: data.rev };
    }

    const body = (await res.text().catch(() => "")).slice(0, 300);

    return { ok: false, status: res.status, body };
  }

  async streamEvents(onChange: () => void, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}/events`, {
      headers: this.headers(),
      signal,
    });

    if (!res.ok || !res.body) throw new Error(`events ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (block.startsWith("event: change")) onChange();
      }
    }
  }
}

export class Backoff {
  private ms = 1000;

  next(): number {
    const v = this.ms;

    this.ms = Math.min(this.ms * 2, MAX_RECONNECT_BACKOFF_MS);

    return v;
  }

  reset(): void {
    this.ms = 1000;
  }
}
