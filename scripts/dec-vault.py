#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import re
import sys
import unicodedata
from pathlib import Path

_PBKDF2_ITERATIONS = 600_000
SCHEME = 1

_SBOX = [
    0x63,
    0x7C,
    0x77,
    0x7B,
    0xF2,
    0x6B,
    0x6F,
    0xC5,
    0x30,
    0x01,
    0x67,
    0x2B,
    0xFE,
    0xD7,
    0xAB,
    0x76,
    0xCA,
    0x82,
    0xC9,
    0x7D,
    0xFA,
    0x59,
    0x47,
    0xF0,
    0xAD,
    0xD4,
    0xA2,
    0xAF,
    0x9C,
    0xA4,
    0x72,
    0xC0,
    0xB7,
    0xFD,
    0x93,
    0x26,
    0x36,
    0x3F,
    0xF7,
    0xCC,
    0x34,
    0xA5,
    0xE5,
    0xF1,
    0x71,
    0xD8,
    0x31,
    0x15,
    0x04,
    0xC7,
    0x23,
    0xC3,
    0x18,
    0x96,
    0x05,
    0x9A,
    0x07,
    0x12,
    0x80,
    0xE2,
    0xEB,
    0x27,
    0xB2,
    0x75,
    0x09,
    0x83,
    0x2C,
    0x1A,
    0x1B,
    0x6E,
    0x5A,
    0xA0,
    0x52,
    0x3B,
    0xD6,
    0xB3,
    0x29,
    0xE3,
    0x2F,
    0x84,
    0x53,
    0xD1,
    0x00,
    0xED,
    0x20,
    0xFC,
    0xB1,
    0x5B,
    0x6A,
    0xCB,
    0xBE,
    0x39,
    0x4A,
    0x4C,
    0x58,
    0xCF,
    0xD0,
    0xEF,
    0xAA,
    0xFB,
    0x43,
    0x4D,
    0x33,
    0x85,
    0x45,
    0xF9,
    0x02,
    0x7F,
    0x50,
    0x3C,
    0x9F,
    0xA8,
    0x51,
    0xA3,
    0x40,
    0x8F,
    0x92,
    0x9D,
    0x38,
    0xF5,
    0xBC,
    0xB6,
    0xDA,
    0x21,
    0x10,
    0xFF,
    0xF3,
    0xD2,
    0xCD,
    0x0C,
    0x13,
    0xEC,
    0x5F,
    0x97,
    0x44,
    0x17,
    0xC4,
    0xA7,
    0x7E,
    0x3D,
    0x64,
    0x5D,
    0x19,
    0x73,
    0x60,
    0x81,
    0x4F,
    0xDC,
    0x22,
    0x2A,
    0x90,
    0x88,
    0x46,
    0xEE,
    0xB8,
    0x14,
    0xDE,
    0x5E,
    0x0B,
    0xDB,
    0xE0,
    0x32,
    0x3A,
    0x0A,
    0x49,
    0x06,
    0x24,
    0x5C,
    0xC2,
    0xD3,
    0xAC,
    0x62,
    0x91,
    0x95,
    0xE4,
    0x79,
    0xE7,
    0xC8,
    0x37,
    0x6D,
    0x8D,
    0xD5,
    0x4E,
    0xA9,
    0x6C,
    0x56,
    0xF4,
    0xEA,
    0x65,
    0x7A,
    0xAE,
    0x08,
    0xBA,
    0x78,
    0x25,
    0x2E,
    0x1C,
    0xA6,
    0xB4,
    0xC6,
    0xE8,
    0xDD,
    0x74,
    0x1F,
    0x4B,
    0xBD,
    0x8B,
    0x8A,
    0x70,
    0x3E,
    0xB5,
    0x66,
    0x48,
    0x03,
    0xF6,
    0x0E,
    0x61,
    0x35,
    0x57,
    0xB9,
    0x86,
    0xC1,
    0x1D,
    0x9E,
    0xE1,
    0xF8,
    0x98,
    0x11,
    0x69,
    0xD9,
    0x8E,
    0x94,
    0x9B,
    0x1E,
    0x87,
    0xE9,
    0xCE,
    0x55,
    0x28,
    0xDF,
    0x8C,
    0xA1,
    0x89,
    0x0D,
    0xBF,
    0xE6,
    0x42,
    0x68,
    0x41,
    0x99,
    0x2D,
    0x0F,
    0xB0,
    0x54,
    0xBB,
    0x16,
]
_RCON = [
    0x01,
    0x02,
    0x04,
    0x08,
    0x10,
    0x20,
    0x40,
    0x80,
    0x1B,
    0x36,
    0x6C,
    0xD8,
    0xAB,
    0x4D,
    0x9A,
]


def _gfmul2(b: int) -> int:
    r = b << 1
    return (r ^ 0x11B) & 0xFF if b & 0x80 else r & 0xFF


class AES256:
    def __init__(self, key: bytes):
        if len(key) != 32:
            raise ValueError("aes-256 requires a 32-byte key")
        self._round_keys = self._expand(key)

    @staticmethod
    def _expand(key: bytes):
        w = list(key)
        rcon = 0
        for i in range(8, 60):
            t = w[(i - 1) * 4 : i * 4]
            if i % 8 == 0:
                t = t[1:] + t[:1]
                t = [_SBOX[b] for b in t]
                t[0] ^= _RCON[rcon]
                rcon += 1
            elif i % 8 == 4:
                t = [_SBOX[b] for b in t]
            for j in range(4):
                w.append(w[(i - 8) * 4 + j] ^ t[j])
        return [bytes(w[i * 16 : (i + 1) * 16]) for i in range(15)]

    def encrypt_block(self, block: bytes) -> bytes:
        if len(block) != 16:
            raise ValueError("block must be 16 bytes")
        s = [block[i] ^ self._round_keys[0][i] for i in range(16)]
        for rnd in range(1, 14):
            s = [_SBOX[b] for b in s]
            s = [
                s[0],
                s[5],
                s[10],
                s[15],
                s[4],
                s[9],
                s[14],
                s[3],
                s[8],
                s[13],
                s[2],
                s[7],
                s[12],
                s[1],
                s[6],
                s[11],
            ]
            out = [0] * 16
            for c in range(4):
                i = c * 4
                a0, a1, a2, a3 = s[i], s[i + 1], s[i + 2], s[i + 3]
                out[i] = _gfmul2(a0) ^ _gfmul2(a1) ^ a1 ^ a2 ^ a3
                out[i + 1] = a0 ^ _gfmul2(a1) ^ _gfmul2(a2) ^ a2 ^ a3
                out[i + 2] = a0 ^ a1 ^ _gfmul2(a2) ^ _gfmul2(a3) ^ a3
                out[i + 3] = _gfmul2(a0) ^ a0 ^ a1 ^ a2 ^ _gfmul2(a3)
            s = out
            rk = self._round_keys[rnd]
            s = [s[j] ^ rk[j] for j in range(16)]
        s = [_SBOX[b] for b in s]
        s = [
            s[0],
            s[5],
            s[10],
            s[15],
            s[4],
            s[9],
            s[14],
            s[3],
            s[8],
            s[13],
            s[2],
            s[7],
            s[12],
            s[1],
            s[6],
            s[11],
        ]
        rk = self._round_keys[14]
        return bytes(s[j] ^ rk[j] for j in range(16))


_GHASH_REDUCTION = 0xE1000000000000000000000000000000


def _gf128_mul(a: int, b: int) -> int:
    res = 0
    for _ in range(128):
        if b & (1 << 127):
            res ^= a
        carry = a & 1
        a >>= 1
        if carry:
            a ^= _GHASH_REDUCTION
        b = (b << 1) & ((1 << 128) - 1)
    return res


def _ghash(h: int, blocks: list) -> int:
    x = 0
    for blk in blocks:
        x = _gf128_mul(x ^ blk, h)
    return x


def gcm_decrypt(key: bytes, nonce: bytes, ct: bytes, aad: bytes) -> bytes:
    if len(nonce) != 12:
        raise ValueError("gcm nonce must be 12 bytes")
    if len(ct) < 16:
        raise ValueError("ciphertext too short")
    cipher = AES256(key)
    tag = ct[-16:]
    body = ct[:-16]
    h = int.from_bytes(cipher.encrypt_block(b"\x00" * 16), "big")
    j0 = (int.from_bytes(nonce, "big") << 32) | 1
    counter = (j0 + 1) & ((1 << 128) - 1)
    out = bytearray()
    for i in range(0, len(body), 16):
        e = cipher.encrypt_block(counter.to_bytes(16, "big"))
        block = body[i : i + 16]
        out += bytes(x ^ y for x, y in zip(block, e))
        counter = (counter + 1) & ((1 << 128) - 1)
    bits_a = len(aad) * 8
    bits_c = len(body) * 8
    data = aad + b"\x00" * ((-len(aad)) % 16) + body + b"\x00" * ((-len(body)) % 16)
    data += bits_a.to_bytes(8, "big") + bits_c.to_bytes(8, "big")
    blocks = [int.from_bytes(data[i : i + 16], "big") for i in range(0, len(data), 16)]
    s = _ghash(h, blocks)
    t = int.from_bytes(cipher.encrypt_block(j0.to_bytes(16, "big")), "big") ^ s
    expected = t.to_bytes(16, "big")
    if not hmac.compare_digest(expected, tag):
        raise ValueError("auth tag mismatch (wrong passphrase or corrupt data)")
    return bytes(out)


def _master_key(passphrase: str) -> bytes:
    normalized = unicodedata.normalize("NFC", passphrase)
    return hashlib.pbkdf2_hmac(
        "sha256",
        normalized.encode("utf-8"),
        b"folio:master-key",
        _PBKDF2_ITERATIONS,
        32,
    )


def _vault_id(master: bytes) -> str:
    return (
        base64.urlsafe_b64encode(
            hmac.new(master, b"folio:vault-id", hashlib.sha256).digest()
        )
        .decode("ascii")
        .rstrip("=")
    )


def b64decode(s: str) -> bytes:
    s = s.strip()
    s += "=" * (-len(s) % 4)
    return base64.b64decode(s, validate=False)


def sanitize_name(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[/\\:*?"<>|\x00-\x1f]', "-", name)
    cleaned = re.sub(r"[ \t.]+$", "", cleaned)[:200]
    return cleaned or fallback


def parse_frontmatter_title(content: str) -> str | None:
    if not content.startswith("---\n"):
        return None
    end = content.find("\n---\n", 4)
    if end < 0:
        return None
    for line in content[4:end].split("\n"):
        if line.startswith("title:"):
            title = line[6:].strip()
            if title.startswith('"') and title.endswith('"') and len(title) >= 2:
                title = title[1:-1]
            if title.startswith("'") and title.endswith("'") and len(title) >= 2:
                title = title[1:-1]
            return title or None
    return None


def sniff_ext(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:2] == b"BM":
        return "bmp"
    head = data[:512]
    if b"<svg" in head.lower() or b"<?xml" in head.lower():
        return "svg"
    return "bin"


_REF_RE = re.compile(r"assets/([0-9a-f-]{8,36})\.[A-Za-z0-9]+")


def recover_envelope(
    path, vault_dir_name, master, notes_dir, assets_dir, asset_map, stats
):
    try:
        env = json.loads(path.read_text("utf-8"))
    except Exception as exc:
        print(f"warning: unreadable envelope {path}: {exc}", file=sys.stderr)
        stats["failed"] += 1
        return
    if env.get("v") != SCHEME:
        why = "" if "v" in env else " (missing scheme version)"
        print(
            f"warning: {path}: unsupported scheme v={env.get('v')!r}{why}, skipping",
            file=sys.stderr,
        )
        stats["failed"] += 1
        return
    opaque = path.stem
    try:
        key = hmac.new(
            master, f"folio:item-key:{opaque}".encode("utf-8"), hashlib.sha256
        ).digest()
        aad = f"{vault_dir_name}:{opaque}".encode("utf-8")
        plain = gcm_decrypt(key, b64decode(env["nonce"]), b64decode(env["blob"]), aad)
        obj = json.loads(plain.decode("utf-8"))
        kind = obj.get("kind")
        payload_b64 = obj.get("payload")
        if kind not in ("note", "attachment") or not isinstance(payload_b64, str):
            raise ValueError("bad envelope payload")
        if obj.get("deleted"):
            return
        payload = b64decode(payload_b64)
        real_id = obj.get("id") or opaque
    except Exception as exc:
        print(f"warning: could not decrypt {path}: {exc}", file=sys.stderr)
        stats["failed"] += 1
        return
    if kind == "note":
        text = payload.decode("utf-8", errors="replace")
        title = parse_frontmatter_title(text) or real_id
        base = sanitize_name(title, real_id)
        target = notes_dir / f"{base}.md"
        n = 2
        while target.exists():
            target = notes_dir / f"{base} {n}.md"
            n += 1
        target.write_text(text, "utf-8")
    else:
        ext = sniff_ext(payload)
        target = assets_dir / f"{real_id or opaque}.{ext}"
        target.write_bytes(payload)
        asset_map[real_id or opaque] = target.name
    stats["recovered"] += 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="dec-vault.py",
        description="recover folio vault contents from a server DATA_DIR",
    )
    ap.add_argument(
        "data_dir", help="server DATA_DIR (one folder per vault, named by vault id)"
    )
    ap.add_argument(
        "passphrase",
        help="vault passphrase as entered (NFC-normalized); '-' reads from stdin",
    )
    ap.add_argument(
        "--vault-id",
        help="vault id (base64url); defaults to the id derived from the passphrase",
    )
    ap.add_argument(
        "-o",
        "--out",
        default="./recovered",
        help="output directory (default: ./recovered)",
    )
    args = ap.parse_args(argv)
    passphrase = args.passphrase
    if passphrase == "-":
        passphrase = sys.stdin.readline().rstrip("\n")
    if not passphrase:
        print("empty passphrase", file=sys.stderr)
        return 1
    master = _master_key(passphrase)
    data_dir = Path(args.data_dir)
    if args.vault_id:
        candidates = [(args.vault_id, data_dir / args.vault_id)]
    else:
        vault_id = _vault_id(master)
        candidates = [(vault_id, data_dir / vault_id)]
    out_dir = Path(args.out)
    notes_dir = out_dir / "notes"
    assets_dir = out_dir / "assets"
    notes_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)
    stats = {"recovered": 0, "failed": 0}
    asset_map: dict[str, str] = {}
    for vault_id, vault_dir in candidates:
        if not vault_dir.is_dir():
            print(f"no data for vault {vault_id} in {data_dir}", file=sys.stderr)
            return 1
        print(f"vault: {vault_id} ({vault_dir})", file=sys.stderr)
        for pattern in ("*.json", "note/*.json", "attachment/*.json"):
            for path in sorted(vault_dir.glob(pattern)):
                recover_envelope(
                    path, vault_id, master, notes_dir, assets_dir, asset_map, stats
                )
    for note in notes_dir.glob("*.md"):
        text = note.read_text("utf-8")

        def _replace(m: re.Match) -> str:
            name = asset_map.get(m.group(1))
            return f"assets/{name}" if name else m.group(0)

        rewritten = _REF_RE.sub(_replace, text)
        if rewritten != text:
            note.write_text(rewritten, "utf-8")
    if stats["recovered"] == 0:
        print(
            "no envelopes could be decrypted (wrong passphrase or vault id?)",
            file=sys.stderr,
        )
        return 1
    print(
        f"recovered {stats['recovered']} items ({stats['failed']} failed) in {out_dir}"
    )
    if stats["failed"]:
        print(
            f"{stats['failed']} envelopes failed (see warnings above)", file=sys.stderr
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
