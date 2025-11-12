import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { getTools } from "./tools.js";

export async function handleResourceRead(server: any, uri: string) {
  if (uri === "mcp://vrm/capabilities") {
    const tools = getTools().map((t) => t.name);
    const payload = {
      server: {
        name: "vrm-mcp-server",
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

  if (uri === "mcp://vrm/status") {
    const status = {
      isLoaded: server.vrmState?.isLoaded,
      modelPath: server.vrmState?.modelPath,
      expressions: Object.fromEntries(server.vrmState?.expressions || []),
      pose: server.vrmState?.pose,
      loadedAnimations: server.vrmState?.loadedAnimations,
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(status, null, 2) }],
    };
  }

  if (uri === "mcp://vrm/files") {
    const result: any = {};
    try {
      const modelFiles = await fs.readdir(server.vrmModelsDir);
      result.models = modelFiles.filter((f: string) => f.endsWith(".vrm"));
    } catch {
      result.models = [];
    }
    try {
      const animFiles = await fs.readdir(server.vrmaAnimationsDir);
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

  if (uri === "mcp://vrm/docs") {
    const md = `# VRM MCP Docs\n\n## 概要\nVRMモデルの読み込み・制御・アニメーションを提供します。\n\n## 主なツール\n- load_vrm_model(filePath)\n- set_vrm_expression(expression, weight)\n- set_vrm_pose(position?, rotation?)\n- animate_vrm_bone(boneName, rotation)\n- get_vrm_status()\n- list_vrm_files(type?)\n- load_gltf_animation(animationPath, animationName)\n- play_gltf_animation(animationName, loop?, fadeInDuration?)\n- stop_gltf_animation(fadeOutDuration?)\n\n## 典型フロー\n1. list_vrm_files → モデル名確認\n2. load_vrm_model → set_vrm_expression → set_vrm_pose\n3. load_gltf_animation → play_gltf_animation\n`;
    return { contents: [{ type: "text", text: md }] };
  }

  if (uri === "mcp://vrm/examples") {
    const examples = {
      examples: [
        {
          name: "基本ロードと表情・ポーズ",
          calls: [
            { tool: "list_vrm_files", arguments: { type: "models" } },
            { tool: "load_vrm_model", arguments: { filePath: "lvncer.vrm" } },
            {
              tool: "set_vrm_expression",
              arguments: { expression: "happy", weight: 0.8 },
            },
            {
              tool: "set_vrm_pose",
              arguments: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
              },
            },
          ],
        },
        {
          name: "アニメーション再生",
          calls: [
            { tool: "list_vrm_files", arguments: { type: "animations" } },
            {
              tool: "load_gltf_animation",
              arguments: { animationPath: "standard.glb", animationName: "standard" },
            },
            {
              tool: "play_gltf_animation",
              arguments: { animationName: "standard", loop: true, fadeInDuration: 0.2 },
            },
          ],
        },
      ],
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(examples, null, 2) }],
    };
  }

  if (uri === "mcp://vrm/health") {
    const health = {
      version: "0.1.0",
      startedAt: new Date(server.serverStartTime).toISOString(),
      uptimeSec: Math.floor((Date.now() - server.serverStartTime) / 1000),
      sseSessions: server.sseTransports?.size || 0,
      viewerClients: server.viewerSSEClients?.size || 0,
      wsClients: server.connectedClients?.size || 0,
      redis: server.sessionManager?.isAvailable?.() ? "ENABLED" : "DISABLED (in-memory)",
    };
    return {
      contents: [{ type: "text", text: JSON.stringify(health, null, 2) }],
    };
  }

  if (uri === "mcp://vrm/session") {
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

  if (uri === "mcp://vrm/logs") {
    const logs = {
      total: (server.recentEvents || []).length,
      latest: (server.recentEvents || []).slice(-50),
    };
    return { contents: [{ type: "text", text: JSON.stringify(logs, null, 2) }] };
  }

  if (uri.startsWith("mcp://vrm/file/")) {
    const name = uri.substring("mcp://vrm/file/".length);
    let baseDir = "";
    let servedPrefix = "";
    if (name.endsWith(".vrm")) {
      baseDir = server.vrmModelsDir;
      servedPrefix = "/models/";
    } else if (name.endsWith(".glb") || name.endsWith(".gltf")) {
      baseDir = server.vrmaAnimationsDir;
      servedPrefix = "/animations/";
    } else {
      throw new McpError(ErrorCode.InvalidRequest, `Unsupported file type: ${name}`);
    }
    const fullPath = path.join(baseDir, name);
    try {
      const stat = await fs.stat(fullPath);
      const info = {
        name,
        path: `${servedPrefix}${name}`,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      };
      return { contents: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    } catch {
      throw new McpError(ErrorCode.InvalidRequest, `File not found: ${name}`);
    }
  }

  if (uri === "mcp://vrm/schema") {
    const schema = { tools: getTools() };
    return { contents: [{ type: "text", text: JSON.stringify(schema, null, 2) }] };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
}
