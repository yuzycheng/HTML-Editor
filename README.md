<div align="center">

<img src="./web/assets/logo-mark.svg" width="84" alt="HTML Editor logo">

# HTML Editor

**Drop in AI-generated HTML and revise it together — edit text, restyle, comment, then hand it back to the AI.**

[![Try it](https://img.shields.io/badge/▸_try_it-yuzycheng.github.io%2FHTML--Editor-0969da?style=for-the-badge)](https://yuzycheng.github.io/HTML-Editor/)

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/status-beta-fde68a?style=flat-square)](#)
[![Stack](https://img.shields.io/badge/stack-Yjs_·_PartyKit-7c3aed?style=flat-square)](#stack)

**English** · [中文](./README.zh-CN.md)

</div>

---

## How it works

```
   ┌──────────────┐      ┌──────────────────────┐      ┌────────────────┐
   │  Upload any  │ ───▶ │  Edit · Comment ·    │ ───▶ │  Download HTML │
   │  HTML file   │      │     Collaborate      │      │  or send to AI │
   └──────────────┘      └──────────────────────┘      └────────────────┘
```

## ✨ Features

|   | What it does |
|---|---|
| ✏️ | **Edit any text** in place — without breaking the HTML framework |
| ➕ | **Add or remove blocks** — paragraphs, cards, table rows, columns |
| 🎨 | **Restyle anything** — text / fill / border color, font size; even small chips, tables, SVG |
| 💬 | **Comment anywhere** — single elements, multi-selection, or whole-doc; anchored notes tell the AI exactly which block to change |
| 👥 | **Real-time collab** — share a link, see edits live |
| 🖼️ | **Slide decks** — when an interactive deck is detected, flip with ←/→ or the pager |
| ↩️ | **Undo / redo** across text and structural changes |
| 📤 | **Export to AI** — clean HTML download or Markdown prompt for Claude / GPT |

## Why

AI-generated HTML (slides, PRDs, docs, landing pages) is hard to revise:
- Direct editing in raw code is too low-level for non-developers
- Round-tripping every small tweak through chat is slow
- There's no good way to leave structural feedback that the AI can act on
- No shared workspace for teams to review and revise the HTML together

This tool sits between the AI and the team: humans review and annotate, then hand the whole package back to the AI for one more pass.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS · iframe-hosted editing |
| Real-time sync | [Yjs](https://docs.yjs.dev/) CRDT |
| Backend | [PartyKit](https://www.partykit.io/) on Cloudflare Durable Objects |

## Local development

```bash
npm install
npm run dev
```

Opens at `http://localhost:1999`.

## License

[MIT](./LICENSE) · Created by [@yuzycheng](https://github.com/yuzycheng)
