import * as fs from "fs/promises";
import * as path from "path";

export interface ModelState {
  modelPath: string | null;
  isLoaded: boolean;
  loadedAnimations: string[];
}

export interface AssetDirectories {
  modelsDir: string;
  animationsDir: string;
}

export type BroadcastFn = (message: any) => void;
export type LogEventFn = (event: string, data: any) => void;

export class ModelService {
  constructor(
    private readonly state: ModelState,
    private readonly dirs: AssetDirectories,
    private readonly broadcast: BroadcastFn,
    private readonly logEvent: LogEventFn
  ) {}

  async loadModel(args: { filePath: string }) {
    const { filePath } = args;
    const fullPath = path.join(this.dirs.modelsDir, filePath);
    try {
      await fs.access(fullPath);
      this.state.modelPath = filePath;
      this.state.isLoaded = true;
      this.broadcast({ type: "load_model", data: { filePath: `/models/${filePath}` } });
      this.logEvent("load_model", { filePath });
      return {
        content: [
          { type: "text", text: `✓ モデルを読み込みました: ${filePath}` },
        ],
      };
    } catch {
      throw new Error(`モデルの読み込みに失敗しました: ${filePath}`);
    }
  }

  async listAssets(args: { type?: string }) {
    const type = args.type || "all";
    const result: any = {};
    if (type === "models" || type === "all") {
      try {
        const files = await fs.readdir(this.dirs.modelsDir);
        result.models = files.filter(
          (f) => f.endsWith(".glb") || f.endsWith(".gltf")
        );
      } catch {
        result.models = [];
      }
    }
    if (type === "animations" || type === "all") {
      try {
        const files = await fs.readdir(this.dirs.animationsDir);
        result.animations = files.filter(
          (f) => f.endsWith(".glb") || f.endsWith(".gltf")
        );
      } catch {
        result.animations = [];
      }
    }
    const summary: string[] = [];
    if (result.models) {
      summary.push(`📦 モデル (${result.models.length}件):`);
      result.models.forEach((f: string) => summary.push(`  - ${f}`));
    }
    if (result.animations) {
      summary.push(`🎬 glTFアニメーション (${result.animations.length}件):`);
      result.animations.forEach((f: string) => summary.push(`  - ${f}`));
    }
    this.logEvent("list_assets", { type });
    return {
      content: [
        {
          type: "text",
          text: summary.join("\n") || "利用可能なファイルがありません",
        },
      ],
    };
  }

  async loadAnimation(args: { animationPath: string; animationName: string }) {
    const { animationPath, animationName } = args;
    const fullPath = path.join(this.dirs.animationsDir, animationPath);
    try {
      await fs.access(fullPath);
      if (!this.state.loadedAnimations.includes(animationName)) {
        this.state.loadedAnimations.push(animationName);
      }
      this.broadcast({ type: "load_animation", data: { animationPath: `/animations/${animationPath}`, animationName } });
      this.logEvent("load_animation", { animationName, animationPath });
      return {
        content: [
          {
            type: "text",
            text: `✓ アニメーション "${animationName}" を読み込みました: ${animationPath}`,
          },
        ],
      };
    } catch {
      throw new Error(`アニメーションの読み込みに失敗しました: ${animationPath}`);
    }
  }

  async playAnimation(args: { animationName: string; loop?: boolean; fadeInDuration?: number }) {
    const { animationName, loop, fadeInDuration } = args;
    if (!this.state.isLoaded) throw new Error("モデルが読み込まれていません");
    if (!this.state.loadedAnimations.includes(animationName)) {
      throw new Error(`アニメーションが未ロードです: ${animationName}`);
    }
    this.broadcast({ type: "play_animation", data: { animationName, loop, fadeInDuration } });
    this.logEvent("play_animation", {
      animationName,
      loop,
      fadeInDuration,
    });
    return {
      content: [
        {
          type: "text",
          text: `▶ アニメーション "${animationName}" を再生しました${
            loop ? "（ループ）" : ""
          }`,
        },
      ],
    };
  }

  async stopAnimation(args: { fadeOutDuration?: number }) {
    const { fadeOutDuration } = args;
    this.broadcast({ type: "stop_animation", data: { fadeOutDuration } });
    this.logEvent("stop_animation", { fadeOutDuration });
    return {
      content: [{ type: "text", text: "⏹ アニメーションを停止しました" }],
    };
  }
}
