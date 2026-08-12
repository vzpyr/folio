export type Keys = { masterKey: CryptoKey; vaultId: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let bin = "";

  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);

  return btoa(bin);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  return bytes;
}

export function base64url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmac(key: CryptoKey, msg: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", key, enc.encode(msg));
}

export async function deriveKeys(passphrase: string): Promise<Keys> {
  const normalized = passphrase.normalize("NFC");
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(normalized),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const salt = enc.encode("folio:master-key");
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    passKey,
    { name: "AES-KW", length: 256 },
    true,
    ["wrapKey", "unwrapKey"],
  );
  const raw = await crypto.subtle.exportKey("raw", aesKey);
  const masterKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const vaultId = base64url(
    new Uint8Array(await hmac(masterKey, "folio:vault-id")),
  );

  return { masterKey, vaultId };
}

export type Kind = "note" | "attachment";

export interface Envelope {
  v: number;
  id: string;
  rev?: number;
  nonce: string;
  blob: string;
}

export interface Opened {
  id: string;
  kind: Kind;
  updated: number;
  deleted: boolean;
  payload: Uint8Array<ArrayBuffer>;
}

export async function opaqueId(keys: Keys, realId: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await hmac(keys.masterKey, `folio:item-id:${keys.vaultId}:${realId}`),
    ),
  );
}

async function itemKey(keys: Keys, opaque: string): Promise<CryptoKey> {
  const sig = await hmac(keys.masterKey, `folio:item-key:${opaque}`);

  return crypto.subtle.importKey(
    "raw",
    sig,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealEnvelope(
  keys: Keys,
  realId: string,
  kind: Kind,
  updated: number,
  deleted: boolean,
  payload: Uint8Array<ArrayBuffer>,
): Promise<{ opaque: string; nonce: string; blob: string }> {
  const opaque = await opaqueId(keys, realId);
  const key = await itemKey(keys, opaque);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(
    JSON.stringify({
      id: realId,
      kind,
      updated,
      deleted,
      payload: toBase64(payload),
    }),
  );
  const aad = enc.encode(`${keys.vaultId}:${opaque}`);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    plaintext,
  );

  return { opaque, nonce: toBase64(nonce), blob: toBase64(new Uint8Array(ct)) };
}

export async function openEnvelope(
  keys: Keys,
  opaque: string,
  env: Envelope,
): Promise<Opened> {
  const key = await itemKey(keys, opaque);
  const aad = enc.encode(`${keys.vaultId}:${opaque}`);
  const pt = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(env.nonce),
      additionalData: aad,
      tagLength: 128,
    },
    key,
    fromBase64(env.blob),
  );
  const obj = JSON.parse(dec.decode(pt)) as {
    id: string;
    kind: Kind;
    updated: number;
    deleted: boolean;
    payload: string;
  };

  return {
    id: obj.id,
    kind: obj.kind,
    updated: obj.updated,
    deleted: !!obj.deleted,
    payload: fromBase64(obj.payload),
  };
}
