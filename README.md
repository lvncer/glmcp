# glmcp

[LICENSE](./LICENSES/)

gltf モデルを AI が自然言語で制御できる MCP サーバー。
Claude Desktop などの MCP クライアントから自然言語で指示するだけで、Web ブラウザで gltf モデルがリアルタイムに動きます。

## セットアップ

このプロジェクトは 2 つの運用モードをサポートしています：

1. ローカルモード: ローカル環境で MCP サーバーを起動（推奨）

   - [ローカルセットアップガイド](./documents/LOCAL_SETUP.md)

2. リモートモード（停止中）

   - [リモートセットアップガイド](./documents/REMOTE_SETUP.md)

## 開発者向けドキュメント

- [ツール一覧](./documents/tools.md)

## プロジェクト構造

```sh
coeur/
├── src/
│   ├── app/
│   │   └── server.ts
│   ├── services/
│   │   └── index.ts             # モデル/アニメーション用サービス
│   ├── mcp/
│   │   ├── resourceHandlers.ts  # MCPリソースハンドラー
│   │   ├── resources.ts         # MCPリソース
│   │   ├── toolHandlers.ts      # MCPツールハンドラー
│   │   └── tools.ts             # MCPツール
│   ├── client/
│   │   ├── AppR3F.tsx           # R3F+Drei ベースのビューア
│   │   └── main.tsx             # クライアントエントリ
│   ├── mcp-server.ts            # MCPサーバー実装（stdio + SSE）
│   ├── gateway.ts               # stdio↔SSEゲートウェイ（Claude Desktop用）
│   └── redis-client.ts
├── public/
│   ├── models/                  # モデル配置（.glb/.gltf）
│   ├── animations/              # glTFアニメーション配置（.glb/.gltf）
│   └── index.html               # glTFビューア
├── package.json
└── README.md
```
