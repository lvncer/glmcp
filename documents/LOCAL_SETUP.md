# セットアップガイド

このガイドでは、ローカル環境でのセットアップ方法を説明します。

## 環境変数

### ローカル開発用

| 環境変数              | 説明                                      | デフォルト値          |
| --------------------- | ----------------------------------------- | --------------------- |
| `MODELS_DIR`          | モデルファイルのディレクトリ              | `./public/models`     |
| `ANIMATIONS_DIR`      | アニメーションファイルのディレクトリ      | `./public/animations` |
| `VIEWER_PORT`         | Web ビューアのポート番号                  | `3000`                |

## 1. モデル/アニメーションファイルを準備

glTF/GLB モデルとアニメーション（.glb/.gltf）ファイルを用意してください。

## 2. ファイル配置

### オプション A: 環境変数で指定（推奨）

```bash
# 1. 好きな場所にディレクトリ作成
mkdir -p ~/assets/models
mkdir -p ~/assets/animations

# 2. ファイルを配置
cp /path/to/your-model.glb ~/assets/models/
cp /path/to/your-animation.glb ~/assets/animations/

# 3. Claude Desktop設定ファイルを編集
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

`claude_desktop_config.json` に以下を追加:

```json
{
  "mcpServers": {
    "coeur": {
      "command": "node",
      "args": ["/path/to/your-project/dist/app/server.js"],
      "env": {
        "MODELS_DIR": "/Users/your-name/assets/models",
        "ANIMATIONS_DIR": "/Users/your-name/assets/animations",
        "VIEWER_PORT": "3000"
      }
    }
  }
}
```

### オプション B: プロジェクト内に配置（シンプル）

```bash
# モデルファイルを配置
cp /path/to/your-model.glb /path/to/your-project/public/models/

# アニメーションファイルを配置
cp /path/to/your-animation.glb /path/to/your-project/public/animations/
```

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "viewer-control": {
      "command": "node",
      "args": ["/path/to/your-project/dist/app/server.js"]
    }
  }
}
```

## 3. Claude Desktop 起動

1. **Claude Desktop を再起動**（設定を反映）
2. **ブラウザでアクセス**: [http://localhost:3000](http://localhost:3000)
3. **Claude Desktop で試す**:

```text
あなた: どんなモデルがある？

Claude: 📦 モデル (1件):
  - standard.glb
🎬 glTFアニメーション (1件):
  - CesiumMan.glb

あなた: standard.glb を読み込んで

Claude: ✓ モデルを読み込みました: standard.glb
```

## 動作確認

### MCP サーバーが起動しているか確認

Claude Desktop を起動した後:

```bash
# ポート3000が開いているか確認
lsof -i :3000
```

以下のような出力が表示されれば OK:

```text
COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345  user   21u  IPv6  0x...      0t0  TCP *:3000 (LISTEN)
```

### Web ビューアにアクセス

1. ブラウザで [http://localhost:3000](http://localhost:3000) を開く
2. 「glTF Viewer (R3F)」と表示される
3. Status: Connected（緑色の点）になっていれば OK

## 完成

セットアップが完了したら、AI に話しかけるだけで モデル が動きます！

**例**:

- 「キャラクターを左に動かして」
- 「悲しい顔にして」
- 「手を振るアニメーションを再生して」
- 「ダンスを永遠にループして」
