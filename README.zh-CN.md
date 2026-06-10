<div align="center">

<img src="./web/assets/logo-mark.svg" width="84" alt="HTML Editor logo">

# HTML Editor

**AI 写的 HTML，拖进来就能一起改 —— 改文字、调样式、留批注，再一键交回 AI。**

[![立即体验](https://img.shields.io/badge/▸_立即体验-yuzycheng.github.io%2FHTML--Editor-0969da?style=for-the-badge)](https://yuzycheng.github.io/HTML-Editor/)

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/status-beta-fde68a?style=flat-square)](#)
[![Stack](https://img.shields.io/badge/stack-Yjs_·_PartyKit-7c3aed?style=flat-square)](#技术栈)

[English](./README.md) · **中文**

</div>

---

## 工作流程

```
   ┌──────────────┐      ┌──────────────────────┐      ┌────────────────┐
   │  拖入任意    │ ───▶ │   编辑 · 批注 ·      │ ───▶ │  下载 HTML 或  │
   │  HTML 文件   │      │      多人协作        │      │   打包给 AI    │
   └──────────────┘      └──────────────────────┘      └────────────────┘
```

## ✨ 功能

|   | 能做什么 |
|---|---|
| ✏️ | **原地改任意文字** —— 不会破坏 HTML 的结构与排版 |
| ➕ | **增删区块** —— 段落、卡片、表格行、列 |
| 🎨 | **点哪改哪的样式** —— 字体颜色、填充、描边、字号，连小色块 / 表格 / SVG 都能改 |
| 💬 | **任意位置批注** —— 单个元素、多选、或整篇文档；勾选元素后批注，交回 AI 时它知道改哪一块 |
| 👥 | **多人实时协作** —— 分享一个链接，改动即时同步 |
| 🖼️ | **幻灯片翻页** —— 识别到交互式 slides 后，⬅️➡️ 或顶部按钮直接翻页 |
| ↩️ | **撤销 / 重做** —— 文字与结构改动都可回退 |
| 📤 | **交回 AI** —— 导出干净的 HTML，或导出成给 Claude / GPT 的 Markdown 提示词 |

## 为什么做这个

用 AI 生成网页、幻灯片、PRD、落地页是越来越快了，可一到「改」就开始头疼：

- 想改源码？对不写代码的人来说太底层了
- 想让 AI 改？每个小改动都得回对话框重写一版，来回拉扯
- 想留点意见？又没地方把「这块要怎么改」精准地标给 AI
- 想拉同事一起看？根本没有一个能一起改 HTML 的地方

所以做了这个小工具，让它夹在 AI 和团队中间：人这边看一看、改一改、标几句批注，再把「HTML + 批注」整个打包丢回给 AI 接着优化。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 JS · iframe 承载编辑 |
| 实时同步 | [Yjs](https://docs.yjs.dev/) CRDT |
| 后端 | [PartyKit](https://www.partykit.io/)（基于 Cloudflare Durable Objects） |

## 本地开发

```bash
npm install
npm run dev
```

启动后访问 `http://localhost:1999`。

## 许可证

[MIT](./LICENSE) · 由 [@yuzycheng](https://github.com/yuzycheng) 创建
