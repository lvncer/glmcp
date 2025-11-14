# Coeur MCP Server

gltf モデルを AI が自然言語で制御できる MCP サーバー。
Claude Desktop から自然言語で指示するだけで、Web ブラウザで gltf モデルがリアルタイムに動きます。

**IMPORTANT!!!**: CHECK [LICENSE](./LICENSES/LICENSE.default-model.md) YOU USE [default.glb](./public/models/default.glb).

## セットアップ

このプロジェクトは 2 つの運用モードをサポートしています：

1. **ローカルモード**: ローカル環境で MCP サーバーを起動（従来の方法）

   - [ローカルセットアップガイド](./documents/LOCAL_SETUP.md)

2. **リモートモード**（推奨）

   - [リモートセットアップガイド](./documents/REMOTE_SETUP.md)

     ```json
     {
       "mcpServers": {
         "coeur": {
           "url": "https://coeur.up.railway.app/api/mcp/sse",
           "headers": {
             "x-api-key": "your-super-secret-key-12345"
           }
         }
       }
     }
     ```

## 使い方

利用可能なツールと使い方をまとめています。

- [ツールとユースケース](./documents/tool-usecases.md)

## 利用可能なツール（汎用）

| Tool             | 説明                              | 例                                                                |
| ---------------- | --------------------------------- | ----------------------------------------------------------------- |
| `list_assets`    | 利用可能なモデル/アニメの一覧取得 | `{ "type": "models" }`                                            |
| `load_model`     | モデル(.glb/.gltf)を読み込み      | `{ "filePath": "standard.glb" }`                                  |
| `load_animation` | 外部アニメ(.glb/.gltf)を読み込み  | `{ "animationPath": "CesiumMan.glb", "animationName": "cesium" }` |
| `play_animation` | 読み込み済みアニメを再生          | `{ "animationName": "cesium", "loop": true }`                     |
| `stop_animation` | 再生中のアニメーションを停止      | `{ "fadeOutDuration": 0.2 }`                                      |

## プロジェクト構造

```sh
coeur/
├── src/
│   ├── app/
│   │   └── server.ts
│   ├── services/
│   │   └── index.ts            # モデル/アニメーション用サービス
│   ├── mcp/
│   │   ├── resourceHandlers.ts # MCPリソースハンドラー
│   │   ├── resources.ts        # MCPリソース
│   │   ├── toolHandlers.ts     # MCPツールハンドラー
│   │   └── tools.ts            # MCPツール
│   ├── client/
│   │   ├── AppR3F.tsx          # R3F+Drei ベースのビューア
│   │   └── main.tsx            # クライアントエントリ
│   ├── mcp-server.ts           # MCPサーバー実装（stdio + SSE）
│   ├── gateway.ts              # stdio↔SSEゲートウェイ（Claude Desktop用）
│   └── redis-client.ts
├── public/
│   ├── models/                 # モデル配置（.glb/.gltf）
│   ├── animations/             # glTFアニメーション配置（.glb/.gltf）
│   └── index.html              # glTFビューア
├── package.json
└── README.md
```
