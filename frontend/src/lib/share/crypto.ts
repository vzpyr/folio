import type { SharePayload } from "./types.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array {
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

export function fromBase64url(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return fromBase64(b64);
}

export function generateRandomKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

const WORDS = [
  "acorn",
  "amber",
  "anchor",
  "arrow",
  "autumn",
  "badge",
  "beacon",
  "breeze",
  "bridge",
  "bronze",
  "cabin",
  "canyon",
  "castle",
  "cedar",
  "cipher",
  "cliff",
  "cloud",
  "clover",
  "comet",
  "coral",
  "crater",
  "crest",
  "crystal",
  "dawn",
  "delta",
  "desert",
  "dune",
  "eagle",
  "echo",
  "ember",
  "falcon",
  "fern",
  "field",
  "flame",
  "flint",
  "forest",
  "fossil",
  "frost",
  "galaxy",
  "garden",
  "glacier",
  "glade",
  "grove",
  "harbor",
  "haven",
  "hawk",
  "hazel",
  "hearth",
  "horizon",
  "island",
  "jasper",
  "jungle",
  "lagoon",
  "lantern",
  "leaf",
  "lotus",
  "lunar",
  "maple",
  "marble",
  "meadow",
  "meteor",
  "mist",
  "monarch",
  "moon",
  "moss",
  "mountain",
  "nebula",
  "nest",
  "nexus",
  "oasis",
  "ocean",
  "olive",
  "onyx",
  "opal",
  "orbit",
  "otter",
  "pebble",
  "pine",
  "planet",
  "plaza",
  "plume",
  "polar",
  "prairie",
  "prism",
  "pulse",
  "pyramid",
  "quantum",
  "quarry",
  "quartz",
  "radar",
  "radiant",
  "rain",
  "raven",
  "reef",
  "ridge",
  "river",
  "robin",
  "ruby",
  "saddle",
  "safari",
  "sahara",
  "sail",
  "sapphire",
  "shadow",
  "shield",
  "sierra",
  "silver",
  "solar",
  "spark",
  "spring",
  "spruce",
  "star",
  "stone",
  "storm",
  "stream",
  "summit",
  "sunset",
  "surge",
  "swift",
  "talon",
  "temple",
  "thistle",
  "thunder",
  "tide",
  "timber",
  "topaz",
  "torch",
  "tower",
  "trail",
  "tulip",
  "tundra",
  "valley",
  "vapor",
  "vector",
  "velvet",
  "vessel",
  "violet",
  "vortex",
  "voyage",
  "walnut",
  "wave",
  "whisper",
  "willow",
  "winter",
  "zenith",
  "zephyr",
];

export function generatePassphrase(wordCount = 4): string {
  const bytes = new Uint8Array(wordCount);
  crypto.getRandomValues(bytes);
  const picked: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    picked.push(WORDS[bytes[i] % WORDS.length]);
  }
  return picked.join("-");
}

export function generateRandomPassword(wordCount = 4): string {
  return generatePassphrase(wordCount);
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
): Promise<{ key: CryptoKey; verifier: string }> {
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey", "deriveBits"],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 600_000,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const verifierBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode("folio:share-verifier:" + toBase64(salt)),
      iterations: 600_000,
      hash: "SHA-256",
    },
    passKey,
    256,
  );
  const verifier = toBase64(new Uint8Array(verifierBits));

  return { key, verifier };
}

export async function deriveVerifierOnly(
  password: string,
  saltB64: string,
): Promise<string> {
  const salt = fromBase64(saltB64);
  const { verifier } = await derivePasswordKey(password, salt);
  return verifier;
}

export async function encryptShare(
  payload: SharePayload,
  shareKey: Uint8Array,
  password?: string,
): Promise<{
  blob: string;
  nonce: string;
  has_password: boolean;
  salt?: string;
  wrapped_key?: string;
  verifier?: string;
}> {
  const key = await importAesKey(shareKey);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const jsonBytes = enc.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    jsonBytes,
  );

  const blob = toBase64(new Uint8Array(ciphertext));
  const nonce = toBase64(iv);

  if (!password || !password.trim()) {
    return {
      blob,
      nonce,
      has_password: false,
    };
  }

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const { key: pwdKey, verifier } = await derivePasswordKey(
    password.trim(),
    salt,
  );

  const wrapIv = new Uint8Array(12);
  crypto.getRandomValues(wrapIv);
  const wrappedCipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapIv },
    pwdKey,
    shareKey as BufferSource,
  );

  const wrappedCombined = new Uint8Array(
    wrapIv.length + wrappedCipher.byteLength,
  );
  wrappedCombined.set(wrapIv, 0);
  wrappedCombined.set(new Uint8Array(wrappedCipher), wrapIv.length);

  return {
    blob,
    nonce,
    has_password: true,
    salt: toBase64(salt),
    wrapped_key: toBase64(wrappedCombined),
    verifier,
  };
}

export async function decryptShare(
  blobB64: string,
  nonceB64: string,
  shareKey: Uint8Array,
): Promise<SharePayload> {
  const key = await importAesKey(shareKey);
  const iv = fromBase64(nonceB64);
  const ciphertext = fromBase64(blobB64);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );

  const jsonStr = dec.decode(decrypted);
  return JSON.parse(jsonStr) as SharePayload;
}

export async function unwrapShareKey(
  wrappedKeyB64: string,
  password: string,
  saltB64: string,
): Promise<Uint8Array> {
  const salt = fromBase64(saltB64);
  const wrapped = fromBase64(wrappedKeyB64);
  const { key: pwdKey } = await derivePasswordKey(password.trim(), salt);

  const iv = wrapped.slice(0, 12);
  const ciphertext = wrapped.slice(12);

  const rawKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    pwdKey,
    ciphertext as BufferSource,
  );

  return new Uint8Array(rawKey);
}
