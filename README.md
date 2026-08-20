<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/folio400-transparent-letterbounds-ffffff.png">
    <source media="(prefers-color-scheme: light)" srcset="media/folio400-transparent-letterbounds-0f0f0f.png">
    <img alt="folio" src="media/folio400-transparent-letterbounds-0f0f0f.png" height="80">
  </picture>
</p>

<p align="center">
  Minimal local-first Markdown notes app with WYSIWYG editing and optional end-to-end encrypted (E2EE) sync.
</p>

## Features

### Editor

- **Markdown-Native WYSIWYG:** Built on TipTap with strict, lossless Markdown round-tripping. Notes are plain `.md` files.
- **Rich Media & Files:** Resizable embedded images, inline file attachments, and drag-and-drop or clipboard paste uploads.
- **Advanced Content:** Interactive tables (with hover controls & context menus), KaTeX math (inline/block), syntax-highlighted code blocks, callouts, and footnotes.
- **Speed & Navigation:** Slash commands (`/`), floating selection bar, and find & replace.

### Organization

- **Structured Storage:** Folders, tags, automated backlinks, note pinning, and trashing.
- **Deep Search:** Full-text fuzzy search with title boosting and contextual result snippets.
- **Batch Actions:** Multi-select notes for bulk moving, tagging, or deletion.

### Privacy & Security

- **Local-First Architecture:** Your data remains strictly on-device by default.
- **Zero-Knowledge Encryption:** Notes and attachments are encrypted client-side using AES-GCM + PBKDF2-SHA256 (600,000 iterations). Servers only store opaque ciphertext.
- **Secure Storage:** Sensitive keys (passphrase, sync token, AI API key) are stored in the system keychain and are not synced.

### Import & Export

- **Smart Importer:** Auto-detects and imports from raw Markdown, Obsidian, Notion, Affine, Google Keep, and Evernote.
- **Flexible Export:** Export individual notes, multi-select subsets, or complete vault backups as `.md`/`.zip` (with attachments preserved).

### AI Assistant

- **Chat:** Connect any OpenAI-compatible provider (e.g. OpenRouter) to query your knowledge base (`search_notes`, `read_note`).
- **Privacy:** Prompt interactions stay entirely on-device (temporarily) and are never synced.

### Platforms & Storage

- **Persistence:** Real-time autosave.
- **Cross-Platform:** Available on Desktop (Linux, macOS, Windows), Mobile (Android, iOS), and Web.
- **Flexible Backends:** Uses direct local filesystem storage on Desktop, and sandboxed IndexedDB on Web and Mobile.
- **Adaptive UI:** Fully responsive interface featuring dedicated desktop-optimized and mobile-optimized layouts.

### Sync (Optional & Self-Hosted)

- **Real-Time Replication:** Driven by a lightweight Rust server using SSE + polling.
- **Offline-First:** Optimistic local edits with exponential backoff reconnection.
- **Conflict Handling:** Revision-based resolution that automatically preserves competing edits as conflict copies.

## Installation

### Pre-built Releases

Download the latest binaries from the [Releases](https://github.com/vzpyr/folio/releases) page:

- **Linux:** `.deb`, `.rpm`, `.AppImage`
- **macOS:** `.dmg`
- **Windows:** `.exe` (NSIS)
- **Android:** `.apk`
- **iOS:** `.ipa`

### iOS (AltStore / SideStore)

Add the source URL below in AltStore or SideStore to install and receive updates:

```
https://raw.githubusercontent.com/vzpyr/folio/master/apps.json
```

## Self-Hosted Sync Server

The sync server is an optional, lightweight Rust service that handles encrypted note synchronization and backups.

### Docker (Recommended)

```bash
cd docker
cp .env.example .env
cp docker-compose.example.yml docker-compose.yml
docker compose up -d # use --build to compile image from source
```

### From Source

Requirements: Cargo/Rust.

```bash
cd server
cargo build --release
```

The compiled binary will be in `server/target/release/folio-server`.

## Build from Source

### Prerequisites

- Node.js 22+ and npm
- Rust and Cargo
- Tauri CLI: `cargo install tauri-cli --locked`
- **Linux dependencies:**
  ```bash
  sudo apt-get install -y build-essential libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf file
  ```
- **macOS / iOS:** Xcode and command line tools
- **Android:** Android SDK/NDK and a recent JDK

### Desktop (Linux, macOS, Windows)

```bash
cd frontend
npm install
cd ..
cargo tauri build
```

Bundled packages land in `src-tauri/target/release/bundle/`.

### Mobile (Android, iOS)

```bash
cd frontend
npm install
cd ..
cargo tauri android build
cargo tauri ios build
```

Outputs land in `src-tauri/gen/`:

- **Android:** `./android/app/build/outputs/apk/universal/release/`
- **iOS:** `./apple/build/arm64/`

## License

MIT
