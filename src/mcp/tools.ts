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
      description: "利用可能なモデル(.gltf/.glb)とアニメ(.gltf/.glb)の一覧を取得する",
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
          animationName: { type: "string", description: "再生するアニメーション名" },
          loop: { type: "boolean", description: "ループ再生するか" },
          fadeInDuration: { type: "number", description: "フェードイン時間（秒）" },
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
          fadeOutDuration: { type: "number", description: "フェードアウト時間（秒）" },
        },
      },
    },
    {
      name: "load_vrm_model",
      description: "VRMモデルファイルを読み込む",
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "VRMファイル名（例: character.vrm）環境変数 VRM_MODELS_DIR からの相対パス",
          },
        },
        required: ["filePath"],
      },
    },
    {
      name: "set_vrm_expression",
      description: "VRMモデルの表情を設定する",
      inputSchema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description:
              "設定する表情（例: happy, angry, sad, surprised, neutral）",
          },
          weight: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "表情の強さ (0.0-1.0)",
          },
        },
        required: ["expression", "weight"],
      },
    },
    {
      name: "set_vrm_pose",
      description: "VRMモデルの位置と回転を設定する",
      inputSchema: {
        type: "object",
        properties: {
          position: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            description: "モデルの位置",
          },
          rotation: {
            type: "object",
            properties: {
              x: { type: "number", description: "ラジアン" },
              y: { type: "number", description: "ラジアン" },
              z: { type: "number", description: "ラジアン" },
            },
            description: "モデルの回転",
          },
        },
      },
    },
    {
      name: "animate_vrm_bone",
      description: "指定されたボーンを回転させる",
      inputSchema: {
        type: "object",
        properties: {
          boneName: {
            type: "string",
            description:
              "ボーン名（例: leftUpperArm, rightUpperArm, head, spine）",
          },
          rotation: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
              w: { type: "number" },
            },
            description: "クォータニオン回転",
          },
        },
        required: ["boneName", "rotation"],
      },
    },
    {
      name: "get_vrm_status",
      description: "VRMモデルの現在の状態を取得する",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_vrm_files",
      description:
        "利用可能なVRMモデルとglTFアニメーションファイルの一覧を取得する",
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
      name: "load_gltf_animation",
      description: "glTFファイルからアニメーションを読み込む",
      inputSchema: {
        type: "object",
        properties: {
          animationPath: {
            type: "string",
            description:
              "glTFファイル名（例: walk.glb または walk.gltf）環境変数 VRMA_ANIMATIONS_DIR からの相対パス",
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
      name: "play_gltf_animation",
      description: "読み込み済みのglTFアニメーションを再生する",
      inputSchema: {
        type: "object",
        properties: {
          animationName: {
            type: "string",
            description: "再生するアニメーション名",
          },
          loop: {
            type: "boolean",
            description: "ループ再生するか",
          },
          fadeInDuration: {
            type: "number",
            description: "フェードイン時間（秒）",
          },
        },
        required: ["animationName"],
      },
    },
    {
      name: "stop_gltf_animation",
      description: "再生中のglTFアニメーションを停止する",
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
