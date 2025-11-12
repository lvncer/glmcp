import * as fs from "fs/promises";
import * as path from "path";

export interface VRMState {
  modelPath: string | null;
  isLoaded: boolean;
  expressions: Map<string, number>;
  pose: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  };
  bones: Map<string, { x: number; y: number; z: number; w?: number }>;
  loadedAnimations: string[];
}

export interface VRMDirectories {
  vrmModelsDir: string;
  vrmaAnimationsDir: string;
}

export type BroadcastFn = (message: any) => void;
export type LogEventFn = (event: string, data: any) => void;

export class VRMService {
  constructor(
    private readonly state: VRMState,
    private readonly dirs: VRMDirectories,
    private readonly broadcast: BroadcastFn,
    private readonly logEvent: LogEventFn
  ) {}

  async loadVRMModel(args: { filePath: string }) {
    const { filePath } = args;
    const fullPath = path.join(this.dirs.vrmModelsDir, filePath);
    try {
      await fs.access(fullPath);
      this.state.modelPath = filePath;
      this.state.isLoaded = true;
      // Broadcast generic and legacy event names for compatibility
      this.broadcast({
        type: "load_model",
        data: { filePath: `/models/${filePath}` },
      });
      this.broadcast({
        type: "load_vrm_model",
        data: { filePath: `/models/${filePath}` },
      });
      this.logEvent("load_vrm_model", { filePath });
      return {
        content: [
          { type: "text", text: `✓ VRMモデルを読み込みました: ${filePath}` },
        ],
      };
    } catch {
      throw new Error(`VRMモデルの読み込みに失敗しました: ${filePath}`);
    }
  }

  async setVRMExpression(args: { expression: string; weight: number }) {
    const { expression, weight } = args;
    if (!this.state.isLoaded)
      throw new Error("VRMモデルが読み込まれていません");
    this.state.expressions.set(expression, weight);
    this.broadcast({
      type: "set_vrm_expression",
      data: { expression, weight },
    });
    this.logEvent("set_vrm_expression", { expression, weight });
    return {
      content: [
        {
          type: "text",
          text: `✓ 表情 "${expression}" を強さ ${weight} で設定しました`,
        },
      ],
    };
  }

  async setVRMPose(args: { position?: any; rotation?: any }) {
    const { position, rotation } = args;
    if (!this.state.isLoaded)
      throw new Error("VRMモデルが読み込まれていません");
    if (position)
      this.state.pose.position = { ...this.state.pose.position, ...position };
    if (rotation)
      this.state.pose.rotation = { ...this.state.pose.rotation, ...rotation };
    this.broadcast({ type: "set_vrm_pose", data: { position, rotation } });
    this.logEvent("set_vrm_pose", { position, rotation });
    return {
      content: [{ type: "text", text: "✓ VRMモデルのポーズを更新しました" }],
    };
  }

  async animateVRMBone(args: { boneName: string; rotation: any }) {
    const { boneName, rotation } = args;
    if (!this.state.isLoaded)
      throw new Error("VRMモデルが読み込まれていません");
    this.state.bones.set(boneName, rotation);
    this.broadcast({ type: "animate_vrm_bone", data: { boneName, rotation } });
    this.logEvent("animate_vrm_bone", { boneName });
    return {
      content: [
        {
          type: "text",
          text: `✓ ボーン "${boneName}" をアニメーションしました`,
        },
      ],
    };
  }

  async getVRMStatus() {
    const status = {
      isLoaded: this.state.isLoaded,
      modelPath: this.state.modelPath,
      expressions: Object.fromEntries(this.state.expressions),
      pose: this.state.pose,
      loadedAnimations: this.state.loadedAnimations,
    };
    this.logEvent("get_vrm_status", {});
    return {
      content: [
        {
          type: "text",
          text: `VRMモデルの状態:\n${JSON.stringify(status, null, 2)}`,
        },
      ],
    };
  }

  async listVRMFiles(args: { type?: string }) {
    const type = args.type || "all";
    const result: any = {};
    if (type === "models" || type === "all") {
      try {
        const files = await fs.readdir(this.dirs.vrmModelsDir);
        // glTF/GLB models (VRM is deprecated)
        result.models = files.filter(
          (f) => f.endsWith(".glb") || f.endsWith(".gltf")
        );
      } catch {
        result.models = [];
      }
    }
    if (type === "animations" || type === "all") {
      try {
        const files = await fs.readdir(this.dirs.vrmaAnimationsDir);
        result.animations = files.filter(
          (f) => f.endsWith(".glb") || f.endsWith(".gltf")
        );
      } catch {
        result.animations = [];
      }
    }
    const summary: string[] = [];
    if (result.models) {
      summary.push(`📦 VRMモデル (${result.models.length}件):`);
      result.models.forEach((f: string) => summary.push(`  - ${f}`));
    }
    if (result.animations) {
      summary.push(`🎬 glTFアニメーション (${result.animations.length}件):`);
      result.animations.forEach((f: string) => summary.push(`  - ${f}`));
    }
    this.logEvent("list_vrm_files", { type });
    return {
      content: [
        {
          type: "text",
          text: summary.join("\n") || "利用可能なファイルがありません",
        },
      ],
    };
  }

  async loadGLTFAnimation(args: {
    animationPath: string;
    animationName: string;
  }) {
    const { animationPath, animationName } = args;
    const fullPath = path.join(this.dirs.vrmaAnimationsDir, animationPath);
    try {
      await fs.access(fullPath);
      if (!this.state.loadedAnimations.includes(animationName)) {
        this.state.loadedAnimations.push(animationName);
      }
      // Broadcast generic and legacy event names for compatibility
      this.broadcast({
        type: "load_animation",
        data: { animationPath: `/animations/${animationPath}`, animationName },
      });
      this.broadcast({
        type: "load_gltf_animation",
        data: { animationPath: `/animations/${animationPath}`, animationName },
      });
      this.logEvent("load_gltf_animation", { animationName, animationPath });
      return {
        content: [
          {
            type: "text",
            text: `✓ glTFアニメーション "${animationName}" を読み込みました: ${animationPath}`,
          },
        ],
      };
    } catch {
      throw new Error(
        `glTFアニメーションの読み込みに失敗しました: ${animationPath}`
      );
    }
  }

  async playGLTFAnimation(args: {
    animationName: string;
    loop?: boolean;
    fadeInDuration?: number;
  }) {
    const { animationName, loop, fadeInDuration } = args;
    if (!this.state.isLoaded)
      throw new Error("VRMモデルが読み込まれていません");
    if (!this.state.loadedAnimations.includes(animationName)) {
      throw new Error(`アニメーションが未ロードです: ${animationName}`);
    }
    // Broadcast generic and legacy event names for compatibility
    this.broadcast({
      type: "play_animation",
      data: { animationName, loop, fadeInDuration },
    });
    this.broadcast({
      type: "play_gltf_animation",
      data: { animationName, loop, fadeInDuration },
    });
    this.logEvent("play_gltf_animation", {
      animationName,
      loop,
      fadeInDuration,
    });
    return {
      content: [
        {
          type: "text",
          text: `▶ glTFアニメーション "${animationName}" を再生しました${
            loop ? "（ループ）" : ""
          }`,
        },
      ],
    };
  }

  async stopGLTFAnimation(args: { fadeOutDuration?: number }) {
    const { fadeOutDuration } = args;
    // Broadcast generic and legacy event names for compatibility
    this.broadcast({ type: "stop_animation", data: { fadeOutDuration } });
    this.broadcast({ type: "stop_gltf_animation", data: { fadeOutDuration } });
    this.logEvent("stop_gltf_animation", { fadeOutDuration });
    return {
      content: [{ type: "text", text: "⏹ glTFアニメーションを停止しました" }],
    };
  }
}
