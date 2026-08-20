import assert from "node:assert/strict";

const {
  generateRandomKey,
  generateRandomPassword,
  encryptShare,
  decryptShare,
  deriveVerifierOnly,
  unwrapShareKey,
  toBase64,
  fromBase64,
  base64url,
  fromBase64url,
} = await import("../src/lib/share/crypto.ts");

let passed = 0;
let failed = 0;

function check(name, ok, extra = "") {
  if (ok) {
    passed++;
    console.log(`pass: ${name}`);
  } else {
    failed++;
    console.error(`FAIL: ${name} ${extra}`);
  }
}

function done(suite) {
  console.log(`\n${suite}: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

{
  const k1 = generateRandomKey();
  const k2 = generateRandomKey();
  check("generates 32-byte random key", k1.length === 32);
  check("random keys are unique", toBase64(k1) !== toBase64(k2));

  const p1 = generateRandomPassword();
  const p2 = generateRandomPassword();
  check("generates 4-word passphrase", p1.split("-").length === 4);
  check("random passphrases are unique", p1 !== p2);
}

{
  const b64 = toBase64(new Uint8Array([1, 2, 3, 255]));
  const bytes = fromBase64(b64);
  check("base64 round-trip", bytes[0] === 1 && bytes[1] === 2 && bytes[2] === 3 && bytes[3] === 255);

  const b64u = base64url(new Uint8Array([251, 255, 254]));
  const fromB64u = fromBase64url(b64u);
  check("base64url round-trip", fromB64u[0] === 251 && fromB64u[1] === 255 && fromB64u[2] === 254);
}

{
  const payload = {
    version: 1,
    title: "Secret Note",
    body: "# Secret Note\n\nThis is private content.",
    tags: ["confidential", "test"],
    created: 1700000000000,
    updated: 1700000000000,
    attachments: [
      {
        id: "assets/img-1.png",
        name: "img-1.png",
        mime: "image/png",
        data: toBase64(new Uint8Array([137, 80, 78, 71])),
      },
    ],
  };

  const key = generateRandomKey();
  const enc = await encryptShare(payload, key);

  check("encrypt without password has_password=false", enc.has_password === false);
  check("encrypted payload has blob and nonce", !!enc.blob && !!enc.nonce);

  const dec = await decryptShare(enc.blob, enc.nonce, key);
  check("decrypt without password restores title", dec.title === "Secret Note");
  check("decrypt without password restores body", dec.body === payload.body);
  check("decrypt without password restores tags", dec.tags.length === 2 && dec.tags[0] === "confidential");
  check("decrypt without password restores attachments", dec.attachments.length === 1 && dec.attachments[0].id === "assets/img-1.png");
}

{
  const payload = {
    version: 1,
    title: "Password Protected Note",
    body: "Top secret content with password.",
    tags: ["secure"],
    created: 1700000000000,
    updated: 1700000000000,
    attachments: [],
  };

  const shareKey = generateRandomKey();
  const password = "mySecretPassword123";

  const enc = await encryptShare(payload, shareKey, password);

  check("encrypt with password has_password=true", enc.has_password === true);
  check("encrypt with password provides salt", !!enc.salt);
  check("encrypt with password provides wrapped_key", !!enc.wrapped_key);
  check("encrypt with password provides verifier", !!enc.verifier);

  const derivedVerifier = await deriveVerifierOnly(password, enc.salt);
  check("derived verifier matches expected verifier", derivedVerifier === enc.verifier);

  const wrongVerifier = await deriveVerifierOnly("wrongPassword", enc.salt);
  check("wrong password generates different verifier", wrongVerifier !== enc.verifier);

  const unwrappedKey = await unwrapShareKey(enc.wrapped_key, password, enc.salt);
  check("unwrapped key matches original share key", toBase64(unwrappedKey) === toBase64(shareKey));

  let wrongPassFailed = false;
  try {
    await unwrapShareKey(enc.wrapped_key, "wrongPassword", enc.salt);
  } catch {
    wrongPassFailed = true;
  }
  check("unwrapping with wrong password fails", wrongPassFailed === true);

  const dec = await decryptShare(enc.blob, enc.nonce, unwrappedKey);
  check("decrypt with unwrapped key restores payload", dec.title === "Password Protected Note" && dec.body === payload.body);
}

done("share");
