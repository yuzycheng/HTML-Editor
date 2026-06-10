<div align="center">

# HTML Editor

**给 AI 生成的 HTML 用的协作编辑器 —— 改文字、留批注、再一键交回 AI。**

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

AI 生成的 HTML（幻灯片、PRD、文档、落地页）改起来很麻烦：

- 直接改源码对非开发者太底层
- 每个小改动都回到对话框让 AI 重写，太慢
- 没有好办法留下「结构性」的反馈让 AI 照着改
- 团队没有一个能一起 review、一起改 HTML 的协作空间

这个工具夹在 AI 和团队之间：人来 review、批注，然后把「HTML + 批注」整个打包交回给 AI 再优化一轮。

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
