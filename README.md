<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/folio400-transparent-letterbounds-ffffff.png">
    <source media="(prefers-color-scheme: light)" srcset="media/folio400-transparent-letterbounds-0f0f0f.png">
    <img alt="folio" src="media/folio400-transparent-letterbounds-0f0f0f.png" height="80">
  </picture>
</p>

<p align="center">
  Minimal local-first Markdown notes app with WYSIWYG editing and optional end-to-end encrypted sync
</p>

## Features

- **Editor:** Lossless Markdown WYSIWYG (TipTap), resizable images, inline file attachments, interactive tables, KaTeX math (inline/block), syntax-highlighted code blocks, callouts, footnotes, slash commands (`/`), floating selection bar, find & replace
- **Organization:** Folders, tags, automatic backlinks, note pinning, trashing, and full-text fuzzy search
- **Privacy & Security:** 100% local-first data ownership, zero-knowledge client-side encryption (AES-GCM + PBKDF2-SHA256), sensitive keys stored in system keychain
- **Import & Export:** Auto-detects and imports vaults from Obsidian, Notion, Affine, Google Keep, Evernote, and raw Markdown; exports individual notes, selections, or full vaults as `.md` or `.zip`
- **AI Assistant:** Connect any OpenAI-compatible provider (e.g. OpenRouter) to query notes locally (`search_notes`, `read_note`) without syncing prompts
- **Sync (Optional):** Lightweight self-hosted Rust server (SSE + polling), offline-first optimistic edits with automatic conflict copies

## Installation

Download pre-built binaries from the [Releases](https://github.com/vzpyr/folio/releases) page:

- **Linux:** `.deb`, `.rpm`, `.AppImage`
- **macOS:** `.dmg`
- **Windows:** `.exe`
- **Android:** `.apk`
- **iOS:** `.ipa`

### iOS (AltStore / SideStore)

Add this source repository URL in AltStore or SideStore to install and receive updates:

```
https://raw.githubusercontent.com/vzpyr/folio/master/apps.json
```

## Sync Server Deployment

### Docker (Recommended)

```bash
cd docker
cp .env.example .env
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

### From Source

Requires Rust and Cargo:

```bash
cd server
cargo build --release
```

Binary output: `server/target/release/folio-server`

## Building from Source

### Prerequisites

- Node.js 22+ and npm
- Rust and Cargo
- Tauri CLI: `cargo install tauri-cli --locked`

### Desktop (Linux, macOS, Windows)

```bash
cd frontend
npm install
cd ..
cargo tauri build
```

Bundled packages land in `src-tauri/target/release/bundle/`

### Mobile (Android, iOS)

```bash
cd frontend
npm install
cd ..
cargo tauri android build
cargo tauri ios build
```

Outputs land in `src-tauri/gen/`

## License

MIT
