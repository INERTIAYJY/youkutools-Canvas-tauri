# AI Canvas Tauri

[简体中文](README.md) · [English](README.en.md) · **日本語** · [한국어](README.ko.md)

<p align="center">
  <img src="public/icons.svg" alt="AI Canvas Tauri Icon" width="140" height="140" />
</p>

> **Tauri 2 + React 19 + React Flow 12** で構築した、ローカルファーストの AI マルチモーダルキャンバス＆対話エージェントデスクトップアプリ。

AI Canvas Tauri は、テキスト・画像・動画・音声・コマ撮りアニメーション・Markdown・ショットリスト・360° パノラマ・手描きノートを、接続可能なキャンバスノードとして整理します。ひとつのプロジェクト内で生成パイプラインを構成し、キャラクターライブラリとローカル素材を管理し、ComfyUI ワークフローを実行し、対話アシスタントでキャンバスの参照・編集、メディア生成、読み取り専用サブエージェントの派遣、許可済みファイルの読み取り、プロジェクトメモリの蓄積ができます。プロジェクトはシリーズとエピソードに分割でき、短編ドラマの各話ごとにキャンバスを持ち、キャラクターライブラリと素材はシリーズ全体で共有します。

![Version](https://img.shields.io/badge/version-0.8.9-6366f1)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
![React](https://img.shields.io/badge/React-19-61dafb)
![React Flow](https://img.shields.io/badge/React_Flow-12-ff0072)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6)
![License](https://img.shields.io/badge/license-source--available-f59e0b)

**オンライン体験:** <https://tenney95.github.io/AI-Canvas-tauri/>（トップ画面ですぐ試せます。デモキャンバス内蔵）

**ダウンロード:** <https://github.com/tenney95/AI-Canvas-tauri/releases>（デスクトップインストーラー）

[オンライン体験](https://tenney95.github.io/AI-Canvas-tauri/) · [ダウンロード](https://github.com/tenney95/AI-Canvas-tauri/releases) · [主な機能](#主な機能) · [クイックスタート](#クイックスタート) · [ドキュメント](#ドキュメント) · [ライセンス](#ライセンス)

> Web 版はキャンバスと UI の体験に適しています。ファイルシステム、認証情報ストレージ、独立ウィンドウ、3D ディレクターデスク、ローカルモデルなどは Tauri デスクトップ環境に依存します。完全な体験をご希望の場合は、以下の手順でデスクトップアプリを起動してください。

## 画面プレビュー

![AI Canvas Tauri Screenshot](public/screenshot.png)

## 主な機能

| 機能 | 説明 |
| --- | --- |
| マルチモーダルノードキャンバス | テキスト・画像・動画・音声・コマ撮りアニメーション・Markdown・ショットリスト・パノラマ・3D ディレクターデスク・ソースファイル・キャンバスノートの各ノードを統一的に接続・構成。 |
| AI とワークフロー | クラウドモデル、カスタムモデル実行プロトコル、ComfyUI ワークフロー、Dreamina ログイン連携、ローカル ONNX 推論に対応。 |
| 内蔵ビデオ編集 | ビデオノードを独立エディターで開き、マルチトラック編集、トリミング・分割、変形、トランジション、テキスト・ステッカー、音量調整、ロスレスパススルーまたは合成エクスポートを実行。 |
| 対話エージェント | マルチセッション、ストリーミング応答、Plan/B/C の 3 つの実行モード、ツール呼び出し、承認カード、タスクタイムライン、コンテキスト圧縮、プロジェクトメモリ。 |
| 読み取り専用サブエージェント | アシスタント内でドメイン役割をユーザーが定義し、メインタスクが並列の読み取り専用サブエージェントを必要に応じて派遣。出力はサニタイズ後に返却。 |
| キャラクターライブラリと短編ドラマ素材 | グローバル／プロジェクトレベルのキャラクターカード、複数参照画像、音声バインド、ボイスオーバー出力、および短編ドラマの人物・シーン・小道具素材。 |
| ローカル MCP コントロールブリッジ | 手動で有効化するセッション単位の stdio MCP アダプター。外部クライアントが同じツール・Policy・承認・タスクタイムラインを再利用可能。 |
| ローカルファースト＆セキュリティ | メディアはプロジェクトデータディレクトリに保存され、構造化データは IndexedDB で永続化。API キーは Rust 認証情報ストアに隔離保管。 |
| シリーズとエピソード | プロジェクトをシリーズとエピソードに分割。各話がキャンバスを占有し、キャラクターライブラリ・プロジェクトメモリ・素材ディレクトリを共有。アシスタントが脚本を読了後に一括で話を作成可能。 |
| プロジェクトとアセット | マルチプロジェクト、アセットライブラリ、復元可能な削除、`.aicanvas` プロジェクト全体のインポート／エクスポート。 |
| はじめてガイドとヘルプセンター | 初回起動時にガイドを表示し、ホバー表示やスペースキーでダイアログを開く、長押し一括生成などの隠れた操作を集中解説。ヘルプセンターはシーン別に分類され、実際の @ チップで ComfyUI 入力ノードへの書き込みを実演。 |
| オンデマンド 3D ディレクターデスク | ディレクターデスクノードを初めて作成するときに固定かつ検証済みの実行リソースをダウンロードし、Tauri 独立ウィンドウでシーンレイアウト、カメラプリビズ、スクリーンショット返却を実行。 |

機能の詳細と段階的な進捗は[機能方案](doc/对话式画布助手-功能方案.md)と[Agent 能力实施方案](doc/对话助手-Agent能力实施方案.md)（中国語）をご覧ください。

## 技術スタック

| 技術 | 用途 |
| --- | --- |
| [Tauri 2](https://tauri.app/) + Rust | デスクトップシェル、ウィンドウ、ファイル、アップデート、ローカルモデル、システム機能 |
| [React 19](https://react.dev/) + TypeScript 6 | UI、ドメイン型、厳格な型チェック |
| [React Flow 12](https://reactflow.dev/) | ノードキャンバス、接続、ビュー制御 |
| [Zustand 5](https://zustand.docs.pmnd.rs/) | スライス化されたグローバル状態管理 |
| [Tailwind CSS 3](https://tailwindcss.com/) | コンポーネントスタイルと `canvas-*` デザイントークン |
| [Vitest](https://vitest.dev/) | 自動テスト |
| IndexedDB | ローカル構造化データの永続化 |

## クイックスタート

### 必要環境

- Node.js: Vite 8 の動作要件を満たすもの（現行 LTS 推奨）
- npm
- Rust stable ツールチェーン
- プラットフォーム別の [Tauri システム依存関係](https://v2.tauri.app/start/prerequisites/)

Windows ビルドではさらに Visual Studio Build Tools 2022 と「C++ によるデスクトップ開発」ワークロードが必要です。

### 依存関係のインストール

```bash
npm install
```

### 開発環境の起動

```bash
# Web フロントエンドのみ起動。デフォルトで http://localhost:1420
npm run dev

# 完全な Tauri デスクトップアプリを起動
npm run tauri dev
```

Web モードは UI 開発に適しています。ネイティブダイアログ、ローカルファイルツール、独立ウィンドウ、ローカルモデル、3D ディレクターデスクなどは Tauri デスクトップ環境が必要です。

### チェックとビルド

```bash
# TypeScript 型チェック
npm run typecheck

# ESLint チェック
npm run lint

# ユニットテスト（Vitest）
npm run test

# lint + 型チェック + テスト
npm run check

# フロントエンド本番ビルド
npm run build

# デスクトップアプリのビルド
npm run tauri build
```

リリース時は `package.json` をバージョン源とし、`npm run sync-version` で Rust 設定と README バージョンバッジを同期できます。

## ドキュメント

- [開発指南](doc/开发指南.md): 環境、コマンド、ディレクトリ、開発規約、デバッグ、FAQ（中国語）
- [アーキテクチャ説明](doc/架构说明.md): コアモジュール、データフロー、セキュリティ境界、パフォーマンス設計（中国語）
- [ComfyUI ワークフロー統合説明](doc/ComfyUI工作流集成说明.md): インポート、IO ノード検出、コンテンツ・パラメータ注入、結果取得（中国語）
- [対話式キャンバスアシスタント機能方案](doc/对话式画布助手-功能方案.md)
- [対話アシスタント Agent 能力実施方案](doc/对话助手-Agent能力实施方案.md)
- [パッケージングとリリース手順](doc/打包与发版流程.md)

長期的なエンジニアリング境界はリポジトリ内の [AGENTS.md](AGENTS.md) に準拠し、アーキテクチャ決定記録は [`doc/adr/`](doc/adr/) にあります。

## ライセンス

本プロジェクトは **AI Canvas Tauri Source-Available License** に基づいて提供されます。全文は [LICENSE](LICENSE) をご覧ください。

学習、研究、社内利用、改変、統合利用は許可されています。許可のないスキン販売、ホワイトラベル配布、ソースコード転売、商業再配布、および本プロジェクトを同種製品として商業化することは禁止されています。

本プロジェクトは OSI 定義におけるオープンソースではありません。商用ライセンスをご希望の場合は著作権者にお問い合わせください。

### サードパーティ素材

キャンバスノートのツールバーとプロパティパネルのビジュアルデザインは [Excalidraw](https://github.com/excalidraw/excalidraw) を参考にしています。ライセンスは [doc/licenses/excalidraw-MIT.txt](doc/licenses/excalidraw-MIT.txt) をご覧ください。

## 連絡先

開発コミュニケーション QQ グループ: 873354155

## 共同開発者

<p>
  <a href="https://github.com/zhurui0523" title="zhurui0523"><img src="https://images.weserv.nl/?url=github.com/zhurui0523.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="zhurui0523" /></a>
  <a href="https://github.com/stars-one" title="stars-one"><img src="https://images.weserv.nl/?url=github.com/stars-one.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="stars-one" /></a>
  <a href="https://github.com/luckcatlin2000" title="luckcatlin2000"><img src="https://images.weserv.nl/?url=github.com/luckcatlin2000.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="luckcatlin2000" /></a>
  <a href="https://github.com/xiaozangao" title="xiaozangao"><img src="https://images.weserv.nl/?url=github.com/xiaozangao.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="xiaozangao" /></a>
  <a href="https://github.com/orlova851986-debug" title="orlova851986-debug"><img src="https://images.weserv.nl/?url=github.com/orlova851986-debug.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="orlova851986-debug" /></a>
</p>
