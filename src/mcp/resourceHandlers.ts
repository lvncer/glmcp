import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { getTools } from "./tools.js";

export async function handleResourceRead(server: any, uri: string) {
  if (uri === "mcp://viewer/capabilities") {
    const tools = getTools().map((t) => t.name);
    const payload = {
      server: {
        name: "viewer-mcp-server",
        version: "0.1.0",
      },
      endpoints: {
        sse: "/api/mcp/sse",
        messages: "/api/mcp/messages",
      },
      tools,
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }

  if (uri === "mcp://viewer/status") {
    const status = {
      isLoaded: server.modelState?.isLoaded,
      modelPath: server.modelState?.modelPath,
      loadedAnimations: server.modelState?.loadedAnimations,
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(status, null, 2) }],
    };
  }

  if (uri === "mcp://viewer/files") {
    const result: any = {};
    try {
      const modelFiles = await fs.readdir(server.modelsDir);
      result.models = modelFiles.filter(
        (f: string) => f.endsWith(".glb") || f.endsWith(".gltf")
      );
    } catch {
      result.models = [];
    }
    try {
      const animFiles = await fs.readdir(server.animationsDir);
      result.animations = animFiles.filter(
        (f: string) => f.endsWith(".glb") || f.endsWith(".gltf")
      );
    } catch {
      result.animations = [];
    }
    return {
      contents: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  if (uri === "mcp://viewer/docs") {
    const md = `# Viewer MCP Docs\n\n## 概要\nR3F + glTF ビューア。モデル(.glb/.gltf)の読み込みと外部アニメ(.glb/.gltf)の適用を提供します。\n\n## 主なツール\n- load_model(filePath)\n- list_assets(type?)\n- load_animation(animationPath, animationName)\n- play_animation(animationName, loop?, fadeInDuration?)\n- stop_animation(fadeOutDuration?)\n\n## 典型フロー\n1. list_assets({ type: \"models\" }) → モデル名確認\n2. load_model({ filePath })\n3. list_assets({ type: \"animations\" })\n4. load_animation({ animationPath, animationName })\n5. play_animation({ animationName, loop: true })\n`;
    return { contents: [{ type: "text", text: md }] };
  }

  if (uri === "mcp://viewer/examples") {
    const examples = {
      examples: [
        {
          name: "基本: モデル読み込み",
          calls: [
            { tool: "list_assets", arguments: { type: "models" } },
            { tool: "load_model", arguments: { filePath: "standard.glb" } },
          ],
        },
        {
          name: "アニメーション再生",
          calls: [
            { tool: "list_assets", arguments: { type: "animations" } },
            {
              tool: "load_animation",
              arguments: {
                animationPath: "CesiumMan.glb",
                animationName: "cesium",
              },
            },
            {
              tool: "play_animation",
              arguments: {
                animationName: "cesium",
                loop: true,
                fadeInDuration: 0.2,
              },
            },
          ],
        },
      ],
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(examples, null, 2) }],
    };
  }

  if (uri === "mcp://viewer/health") {
    const health = {
      version: "0.1.0",
      startedAt: new Date(server.serverStartTime).toISOString(),
      uptimeSec: Math.floor((Date.now() - server.serverStartTime) / 1000),
      sseSessions: server.sseTransports?.size || 0,
      viewerClients: server.viewerSSEClients?.size || 0,
      wsClients: server.connectedClients?.size || 0,
      redis: server.sessionManager?.isAvailable?.()
        ? "ENABLED"
        : "DISABLED (in-memory)",
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(health, null, 2) }],
    };
  }

  if (uri === "mcp://viewer/session") {
    const session = {
      sseSessionIds: Array.from(server.sseTransports?.keys?.() || []),
      totals: {
        sseSessions: server.sseTransports?.size || 0,
        viewerClients: server.viewerSSEClients?.size || 0,
        wsClients: server.connectedClients?.size || 0,
      },
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(session, null, 2) }],
    };
  }

  if (uri === "mcp://viewer/logs") {
    const logs = {
      total: (server.recentEvents || []).length,
      latest: (server.recentEvents || []).slice(-50),
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(logs, null, 2) }],
    };
  }

  if (uri.startsWith("mcp://viewer/file/")) {
    const name = uri.substring("mcp://viewer/file/".length);
    if (!(name.endsWith(".glb") || name.endsWith(".gltf"))) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unsupported file type: ${name}`
      );
    }
    // Search models first, then animations
    const candidates: Array<{ baseDir: string; servedPrefix: string }> = [
      { baseDir: server.modelsDir, servedPrefix: "/models/" },
      { baseDir: server.animationsDir, servedPrefix: "/animations/" },
    ];
    for (const c of candidates) {
      const fullPath = path.join(c.baseDir, name);
      try {
        const stat = await fs.stat(fullPath);
        const info = {
          name,
          path: `${c.servedPrefix}${name}`,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        };
        return {
          contents: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        };
      } catch {}
    }
    throw new McpError(ErrorCode.InvalidRequest, `File not found: ${name}`);
  }

  if (uri === "mcp://viewer/schema") {
    const schema = { tools: getTools() };
    return {
      contents: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
}
