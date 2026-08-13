# folio

Minimal local-first Markdown notes app with WYSIWYG editing and optional end-to-end encrypted (E2EE) sync.

## Features

Notes are plain `.md` files.

### Editor
- **Markdown-Native WYSIWYG:** Built on TipTap with strict, lossless Markdown round-tripping.
- **Rich Media & Files:** Resizable embedded images, inline file attachments, and drag-and-drop or clipboard paste uploads.
- **Advanced Content:** Interactive tables (with hover controls & context menus), KaTeX math (inline/block), syntax-highlighted code blocks, callouts, and footnotes.
- **Speed & Navigation:** Slash commands (`/`), floating selection bar, find & replace, and safe link validation.

### Organization
- **Structured Storage:** Folders, tags, note pinning, and soft-delete trashing.
- **Deep Search:** Full-text fuzzy search with title boosting and contextual result snippets.
- **Knowledge Graph:** Automated backlink tracking across your vault.
- **Batch Actions:** Multi-select notes for bulk moving, tagging, or deletion.

### Privacy & Security
- **Local-First Architecture:** Your data remains strictly on-device by default.
- **Zero-Knowledge Encryption:** Notes and attachments are encrypted client-side using AES-GCM + PBKDF2-SHA256 (600,000 iterations). Servers only store opaque ciphertext.
- **Secure Storage:** Sensitive keys (passphrase, sync token, AI API key) are stored in the system keychain.

### Sync (Optional & Self-Hosted)
- **Real-Time Replication:** Driven by a lightweight Rust server using SSE with a polling fallback.
- **Offline-First:** Optimistic local edits with exponential backoff reconnection.
- **Conflict Handling:** Revision-based resolution that automatically preserves competing edits as conflict copies.
- **Full Vault Sync:** Covers notes, folder structures, and binary attachments.

### Import & Export
- **Smart Importer:** Auto-detects and imports from raw Markdown, Obsidian, Notion, Affine, Google Keep, and Evernote (`.enex`).
- **Flexible Export:** Export individual notes, multi-select subsets, or complete vault backups as `.md` or `.zip` archives (with attachments preserved).

### AI Assistant
- **Vault-Aware Chat:** Connect any OpenAI-compatible provider (e.g. OpenRouter) to query your knowledge base (`search_notes`, `read_note`).
- **Privacy Enforcement:** API key and prompt interactions stay entirely on-device and are never synced.

### Platforms & Storage
- **Persistence:** Real-time autosave.
- **Cross-Platform:** Available on Desktop (macOS, Windows, Linux), Mobile (iOS, Android), and Web.
- **Flexible Backends:** Uses direct local filesystem storage on Desktop, and sandboxed IndexedDB on Web and Mobile.
- **Adaptive UI:** Fully responsive interface featuring dedicated desktop navigation and a mobile-optimized layout with a bottom tab bar.

## Install

### Pre-built Releases

Download the latest release from the [Releases](https://github.com/vzpyr/folio/releases) page:

- **Linux:** `.deb`, `.rpm`, `.AppImage`
- **Windows:** `.exe` (NSIS)
- **macOS:** `.dmg`
- **Android:** `.apk`
- **iOS:** `.ipa`

## Sync Server

### Docker

```bash
cd docker
cp .env.example .env
cp docker-compose.example.yml docker-compose.yml
docker compose up -d # --build to build image from source
```

## Build From Source

### Desktop

Requirements: Node.js 22+, npm, Rust, and the Tauri CLI (`cargo install tauri-cli --locked`). macOS requires Xcode. Linux additionally needs:

```bash
sudo apt-get install -y build-essential libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf file
```

```bash
cd frontend
npm install
cd ..
cargo tauri build
```

Binaries land in `src-tauri/target/release/bundle/`. macOS bundles (`.app`, `.dmg`) can only be built on macOS.

### Mobile

Requirements: Android SDK/NDK and a recent JDK. iOS requires macOS with Xcode.

```bash
cd frontend
npm install
cd ..
cargo tauri android build
cargo tauri ios build
```

Outputs land under `src-tauri/gen/`:
- **Android APK:** `gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
- **Android AAB:** `gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`
- **iOS IPA:** `gen/apple/build/arm64/folio.ipa`

### Server

Requirements: Rust.

```bash
cd server
cargo build --release
```

The binary lands in `server/target/release/folio-server`.

## License

MIT
