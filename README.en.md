# AI Canvas Tauri

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

<p align="center">
  <img src="public/icons.svg" alt="AI Canvas Tauri Icon" width="140" height="140" />
</p>

> A local-first AI multimodal canvas and conversational Agent desktop application built on **Tauri 2 + React 19 + React Flow 12**.

AI Canvas Tauri organizes text, images, video, audio, frame-by-frame animation, Markdown, shot lists, 360° panoramas and hand-drawn notes into connectable canvas nodes. In a single project you can orchestrate generation pipelines, manage a character library and local assets, run ComfyUI workflows, and use the conversational assistant to query or modify the canvas, generate media, dispatch read-only sub-agents, read authorized files, and accumulate project memory. Projects can also be split into series and episodes — each episode of a short drama gets its own canvas, while the character library and assets are shared across the whole series.

![Version](https://img.shields.io/badge/version-0.8.9-6366f1)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
![React](https://img.shields.io/badge/React-19-61dafb)
![React Flow](https://img.shields.io/badge/React_Flow-12-ff0072)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6)
![License](https://img.shields.io/badge/license-source--available-f59e0b)

**Live demo:** <https://tenney95.github.io/AI-Canvas-tauri/> (try it right on the landing page, with a built-in demo canvas)

**Download:** <https://github.com/tenney95/AI-Canvas-tauri/releases> (desktop installers)

[Live demo](https://tenney95.github.io/AI-Canvas-tauri/) · [Download](https://github.com/tenney95/AI-Canvas-tauri/releases) · [Capabilities](#capabilities) · [Getting Started](#getting-started) · [Documentation](#documentation) · [License](#license)

> The web version is ideal for exploring the canvas and interface. File system, credential storage, separate windows, the 3D director desk and local models depend on the Tauri desktop environment; for the full experience, launch the desktop app using the steps below.

## Preview

![AI Canvas Tauri Screenshot](public/screenshot.png)

## Capabilities

| Capability | Description |
| --- | --- |
| Multimodal node canvas | Text, image, video, audio, frame-by-frame animation, Markdown, shot list, panorama, 3D director desk, source file and canvas note nodes, connected and orchestrated together. |
| AI & workflows | Cloud models, custom model execution protocols, ComfyUI workflows, Dreamina login-based calls and local ONNX inference. |
| Built-in video editing | Video nodes open in a standalone editor with multi-track arrangement, trimming and splitting, transforms, transitions, text and stickers, volume control, and lossless passthrough or composited export to disk and new nodes. |
| Conversational Agent | Multiple conversations, streaming responses, Plan/B/C execution modes, tool calls, approval cards, task timelines, context compression and project memory. |
| Read-only sub-agents | Users define domain roles inside the assistant; the main task dispatches parallel read-only sub-agents whose sanitized outputs are returned. |
| Character library & drama assets | Global and project-level character cards, multiple reference images, voice binding and voice-over export, plus short-drama characters, scenes and props. |
| Local MCP control bridge | A manually enabled, per-session stdio MCP adapter that lets external clients reuse the same tools, Policy, approvals and task timelines. |
| Local-first & secure | Media lives in the project data directory, structured data is persisted by IndexedDB, and API keys are isolated in the Rust credential store. |
| Series & episodes | Projects can be split into series and episodes, each episode owning its own canvas while sharing the character library, project memory and asset directories; the assistant can create episodes in bulk after reading a script. |
| Projects & assets | Multiple projects, an asset library, recoverable deletion and whole-project `.aicanvas` import/export. |
| Onboarding & Help Center | A first-launch guide covers hover hints and hidden actions such as Space-to-open-dialog and long-press batch generation; the Help Center is organized by scenario and uses a real `@` chip to demonstrate how ComfyUI input nodes are written. |
| On-demand 3D director desk | On first creation of a director-desk node, downloads fixed and verified runtime assets, then does scene layout, camera previz and screenshot handoff in a separate Tauri window. |

See [功能方案](doc/对话式画布助手-功能方案.md) and [Agent 能力实施方案](doc/对话助手-Agent能力实施方案.md) (in Chinese) for detailed feature descriptions and stage progress.

## Tech Stack

| Technology | Purpose |
| --- | --- |
| [Tauri 2](https://tauri.app/) + Rust | Desktop shell, windows, files, updates, local models and system capabilities |
| [React 19](https://react.dev/) + TypeScript 6 | UI, domain types and strict type checking |
| [React Flow 12](https://reactflow.dev/) | Node canvas, connections and view controls |
| [Zustand 5](https://zustand.docs.pmnd.rs/) | Slice-based global state management |
| [Tailwind CSS 3](https://tailwindcss.com/) | Component styling and `canvas-*` design tokens |
| [Vitest](https://vitest.dev/) | Automated testing |
| IndexedDB | Local structured data persistence |

## Getting Started

### Prerequisites

- Node.js: meet Vite 8 runtime requirements; current LTS recommended
- npm
- Rust stable toolchain
- Platform-specific [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)

Windows builds additionally require Visual Studio Build Tools 2022 with the "Desktop development with C++" workload installed.

### Install dependencies

```bash
npm install
```

### Start the development environment

```bash
# Start the web frontend only, available at http://localhost:1420 by default
npm run dev

# Start the full Tauri desktop app
npm run tauri dev
```

Web mode is suited for UI development; native dialogs, local file tools, separate windows, local models and the 3D director desk require the Tauri desktop environment.

### Check and build

```bash
# TypeScript type checking
npm run typecheck

# ESLint
npm run lint

# Unit tests (Vitest)
npm run test

# lint + type check + tests
npm run check

# Frontend production build
npm run build

# Desktop app build
npm run tauri build
```

For releases, `package.json` is the version source; run `npm run sync-version` to sync the Rust config and the README version badge.

## Documentation

- [开发指南](doc/开发指南.md): environment, commands, directories, conventions, debugging and FAQ (in Chinese)
- [架构说明](doc/架构说明.md): core modules, data flow, security boundaries and performance design (in Chinese)
- [ComfyUI 工作流集成说明](doc/ComfyUI工作流集成说明.md): import, IO node detection, content/parameter injection and result retrieval (in Chinese)
- [对话式画布助手功能方案](doc/对话式画布助手-功能方案.md)
- [对话助手 Agent 能力实施方案](doc/对话助手-Agent能力实施方案.md)
- [打包与发版流程](doc/打包与发版流程.md)

Long-term engineering boundaries are defined by [AGENTS.md](AGENTS.md); architecture decision records live in [`doc/adr/`](doc/adr/).

## License

This project is licensed under the **AI Canvas Tauri Source-Available License**; see [LICENSE](LICENSE) for the full terms.

Learning, research, internal use, modification and integration use are permitted. Unauthorized rebranding for sale, white-label distribution, source-code resale, commercial redistribution, and commercializing the project as a competing product are prohibited.

This project is not open source under the OSI definition. For commercial licensing, please contact the copyright holder.

### Third-party assets

The toolbar and properties panel of the canvas note visual design reference [Excalidraw](https://github.com/excalidraw/excalidraw); see [doc/licenses/excalidraw-MIT.txt](doc/licenses/excalidraw-MIT.txt) for its license.

## Contact

Development QQ group: 873354155

## Contributors

<p>
  <a href="https://github.com/zhurui0523" title="zhurui0523"><img src="https://images.weserv.nl/?url=github.com/zhurui0523.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="zhurui0523" /></a>
  <a href="https://github.com/stars-one" title="stars-one"><img src="https://images.weserv.nl/?url=github.com/stars-one.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="stars-one" /></a>
  <a href="https://github.com/luckcatlin2000" title="luckcatlin2000"><img src="https://images.weserv.nl/?url=github.com/luckcatlin2000.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="luckcatlin2000" /></a>
  <a href="https://github.com/xiaozangao" title="xiaozangao"><img src="https://images.weserv.nl/?url=github.com/xiaozangao.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="xiaozangao" /></a>
  <a href="https://github.com/orlova851986-debug" title="orlova851986-debug"><img src="https://images.weserv.nl/?url=github.com/orlova851986-debug.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="orlova851986-debug" /></a>
</p>
