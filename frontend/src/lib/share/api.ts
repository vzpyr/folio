import type { CreateShareParams, ShareMeta, ShareResponse } from "./types.ts";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function createRemoteShare(
  serverUrl: string,
  token: string,
  params: CreateShareParams,
): Promise<{ id: string }> {
  const res = await fetch(`${trimSlash(serverUrl)}/api/shares`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to create share: ${res.status}`);
  }

  return (await res.json()) as { id: string };
}

export async function getRemoteShare(
  serverUrl: string,
  shareId: string,
): Promise<ShareResponse> {
  const res = await fetch(`${trimSlash(serverUrl)}/api/shares/${encodeURIComponent(shareId)}`, {
    method: "GET",
  });

  if (res.status === 404) {
    throw new Error("not_found");
  }

  if (res.status === 410) {
    throw new Error("expired");
  }

  if (!res.ok) {
    throw new Error(`error_${res.status}`);
  }

  return (await res.json()) as ShareResponse;
}

export async function unlockRemoteShare(
  serverUrl: string,
  shareId: string,
  verifier: string,
): Promise<ShareResponse> {
  const res = await fetch(`${trimSlash(serverUrl)}/api/shares/${encodeURIComponent(shareId)}/unlock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ verifier }),
  });

  if (res.status === 401) {
    throw new Error("invalid_password");
  }

  if (res.status === 404) {
    throw new Error("not_found");
  }

  if (res.status === 410) {
    throw new Error("expired");
  }

  if (!res.ok) {
    throw new Error(`error_${res.status}`);
  }

  return (await res.json()) as ShareResponse;
}

export async function getRemoteShareByNote(
  serverUrl: string,
  token: string,
  noteId: string,
): Promise<ShareMeta | null> {
  const res = await fetch(`${trimSlash(serverUrl)}/api/shares/by-note/${encodeURIComponent(noteId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { share: ShareMeta | null };
  return data.share;
}

export async function deleteRemoteShare(
  serverUrl: string,
  token: string,
  shareId: string,
): Promise<boolean> {
  const res = await fetch(`${trimSlash(serverUrl)}/api/shares/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.ok;
}
