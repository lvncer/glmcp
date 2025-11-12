export function getTools() {
  return [
    {
      name: "load_model",
      description: "モデルファイル(.gltf/.glb)を読み込む",
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "モデルファイル名（例: model.glb）環境変数 VRM_MODELS_DIR からの相対パス",
          },
        },
        required: ["filePath"],
      },
    },
    {
      name: "list_assets",
      description:
        "利用可能なモデル(.gltf/.glb)とアニメ(.gltf/.glb)の一覧を取得する",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["models", "animations", "all"],
            description: "取得するファイルの種類（デフォルト: all）",
          },
        },
      },
    },
    {
      name: "load_animation",
      description: "glTFファイルからアニメーションを読み込む（汎用名）",
      inputSchema: {
        type: "object",
        properties: {
          animationPath: {
            type: "string",
            description:
              "glTFファイル名（例: walk.glb）環境変数 VRMA_ANIMATIONS_DIR からの相対パス",
          },
          animationName: {
            type: "string",
            description: "アニメーション識別名（再生時に使用）",
          },
        },
        required: ["animationPath", "animationName"],
      },
    },
    {
      name: "play_animation",
      description: "読み込み済みのアニメーションを再生する（汎用名）",
      inputSchema: {
        type: "object",
        properties: {
          animationName: {
            type: "string",
            description: "再生するアニメーション名",
          },
          loop: { type: "boolean", description: "ループ再生するか" },
          fadeInDuration: {
            type: "number",
            description: "フェードイン時間（秒）",
          },
        },
        required: ["animationName"],
      },
    },
    {
      name: "stop_animation",
      description: "再生中のアニメーションを停止する（汎用名）",
      inputSchema: {
        type: "object",
        properties: {
          fadeOutDuration: {
            type: "number",
            description: "フェードアウト時間（秒）",
          },
        },
      },
    },
  ];
}
