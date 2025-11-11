#!/usr/bin/env node

/**
 * VRM Model Context Protocol サーバー
 * VRMモデルの読み込み、制御、アニメーションを提供
 *
 * 環境変数:
 * - VRM_MODELS_DIR: VRMモデルファイルのディレクトリ (デフォルト: ./public/models)
 * - VRMA_ANIMATIONS_DIR: VRMAアニメーションファイルのディレクトリ (デフォルト: ./public/animations)
 * - VIEWER_PORT: Webビューアのポート番号 (デフォルト: 3000)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { getSessionManager } from "./redis-client.js";

// ESM での __dirname 取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// VRMモデルの状態管理
interface VRMState {
  modelPath: string | null;
  isLoaded: boolean;
  expressions: Map<string, number>;
  pose: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  };
  bones: Map<string, { x: number; y: number; z: number; w: number }>;
  loadedAnimations: string[];
}

// セキュリティ: レート制限用トークンバケット
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor(maxTokens = 60, refillRate = 1) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  check(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens - 1, lastRefill: now };
      this.buckets.set(key, bucket);
      return true;
    }

    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.maxTokens,
      bucket.tokens + elapsed * this.refillRate
    );
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }
}

class VRMMCPServer {
  private mcpServer: Server;
  private expressApp: express.Application;
  private wss: WebSocketServer;
  private vrmState: VRMState;
  private connectedClients: Set<WebSocket>;
  private sseTransports = new Map<string, SSEServerTransport>();
  private viewerSSEClients = new Set<express.Response>();
  private rateLimiter = new RateLimiter(60, 1);
  private sessionManager = getSessionManager();
  private serverStartTime: number;
  private recentEvents: any[];
  private maxRecentEvents = 100;

  // 環境変数から読み取り
  private vrmModelsDir: string;
  private vrmaAnimationsDir: string;
  private viewerPort: number;
  private mcpApiKey: string | undefined;
  private allowedOrigins: string[];

  constructor() {
    // 環境変数またはデフォルトパス
    this.vrmModelsDir =
      process.env.VRM_MODELS_DIR || path.join(__dirname, "../public/models");

    this.vrmaAnimationsDir =
      process.env.VRMA_ANIMATIONS_DIR ||
      path.join(__dirname, "../public/animations");

    this.viewerPort = parseInt(process.env.VIEWER_PORT || "3000", 10);
    this.mcpApiKey = process.env.MCP_API_KEY;
    this.allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:3000", "http://localhost:5173"];

    this.serverStartTime = Date.now();
    this.recentEvents = [];

    console.error("=== VRM MCP Server Configuration ===");
    console.error(`VRM Models Dir: ${this.vrmModelsDir}`);
    console.error(`VRMA Animations Dir: ${this.vrmaAnimationsDir}`);
    console.error(`Viewer Port: ${this.viewerPort}`);
    console.error(`MCP API Key: ${this.mcpApiKey ? "SET" : "NOT SET"}`);
    console.error(`Allowed Origins: ${this.allowedOrigins.join(", ")}`);
    console.error(
      `Redis Sessions: ${
        this.sessionManager.isAvailable() ? "ENABLED" : "DISABLED (in-memory)"
      }`
    );
    console.error("====================================");

    // MCP サーバー初期化
    this.mcpServer = new Server(
      {
        name: "vrm-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // VRM 状態初期化
    this.vrmState = {
      modelPath: "lvncer.vrm",
      isLoaded: true,
      expressions: new Map(),
      pose: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      bones: new Map(),
      loadedAnimations: [],
    };

    this.connectedClients = new Set();

    // Express サーバー初期化
    this.expressApp = express();
    const httpServer = createServer(this.expressApp);

    // 静的ファイル配信
    // Viteビルド済みクライアント: dist/client (dist からの相対パスで __dirname/client)
    this.expressApp.use(express.static(path.join(__dirname, "client")));
    // 3Dアセット
    this.expressApp.use("/models", express.static(this.vrmModelsDir));
    this.expressApp.use("/animations", express.static(this.vrmaAnimationsDir));
    // 互換: public 配下（必要に応じて）
    this.expressApp.use(express.static(path.join(__dirname, "../public")));

    // WebSocket サーバー
    this.wss = new WebSocketServer({ server: httpServer });

    // HTTP サーバー起動
    httpServer.listen(this.viewerPort, () => {
      console.error(`🌐 Web viewer: http://localhost:${this.viewerPort}`);
    });

    this.setupHandlers();
    this.setupWebSocket();
    this.setupSSEEndpoints();

    // SPA fallback: 非APIルートはクライアントのindex.htmlを返す
    this.expressApp.get("*", (req, res) => {
      const url = req.path || "";
      if (url.startsWith("/api")) {
        res.status(404).end();
        return;
      }
      const indexPath = path.join(__dirname, "client", "index.html");
      res.sendFile(indexPath, (err) => {
        if (err) {
          res.status(404).end();
        }
      });
    });
  }

  // セキュリティミドルウェア
  private checkAuth(req: express.Request, res: express.Response): boolean {
    if (!this.mcpApiKey) {
      return true; // APIキー未設定なら認証スキップ
    }
    // ヘッダーまたはクエリパラメータからAPIキーを取得
    const providedKey = req.get("x-api-key") || (req.query.apiKey as string);
    if (providedKey !== this.mcpApiKey) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  private checkCORS(req: express.Request, res: express.Response): boolean {
    const origin = req.get("origin") || req.get("referer") || "";
    const allowed = this.allowedOrigins.some(
      (o) => origin.startsWith(o) || o === "*"
    );

    if (allowed || !origin) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      return true;
    }

    res.status(403).json({ error: "Forbidden origin" });
    return false;
  }

  private checkRateLimit(req: express.Request, res: express.Response): boolean {
    const key = req.get("x-api-key") || req.ip || "anonymous";
    if (!this.rateLimiter.check(key)) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return false;
    }
    return true;
  }

  private setupSSEEndpoints(): void {
    // OPTIONS for CORS preflight
    this.expressApp.options("/api/mcp/sse", (req, res) => {
      this.checkCORS(req, res);
      res.status(200).end();
    });

    this.expressApp.options("/api/mcp/messages", (req, res) => {
      this.checkCORS(req, res);
      res.status(200).end();
    });

    // MCP SSE endpoint (GET)
    this.expressApp.get("/api/mcp/sse", async (req, res) => {
      if (!this.checkAuth(req, res)) return;
      if (!this.checkCORS(req, res)) return;
      if (!this.checkRateLimit(req, res)) return;

      const transport = new SSEServerTransport("/api/mcp/messages", res);
      this.sseTransports.set(transport.sessionId, transport);

      // Redisにセッション保存
      if (this.sessionManager.isAvailable()) {
        await this.sessionManager.saveSession(transport.sessionId, {
          metadata: { connectedAt: new Date().toISOString() },
        });
      }

      res.on("close", async () => {
        this.sseTransports.delete(transport.sessionId);
        // Redisからセッション削除
        if (this.sessionManager.isAvailable()) {
          await this.sessionManager.deleteSession(transport.sessionId);
        }
        this.logEvent("mcp_sse_disconnected", { sessionId: transport.sessionId });
        console.error(`✗ MCP SSE client disconnected: ${transport.sessionId}`);
      });

      try {
        // connect() が内部で transport.start() を自動実行するため、明示的な start() は不要
        await this.mcpServer.connect(transport);
        this.logEvent("mcp_sse_connected", { sessionId: transport.sessionId });
        console.error(`✓ MCP SSE client connected: ${transport.sessionId}`);

        // 心拍送信 (30秒ごと) + セッション延長
        const heartbeat = setInterval(async () => {
          if (res.writable) {
            res.write(": ping\n\n");
            // Redisセッションの有効期限を延長
            if (this.sessionManager.isAvailable()) {
              await this.sessionManager.extendSession(transport.sessionId);
            }
          } else {
            clearInterval(heartbeat);
          }
        }, 30000);

        res.on("close", () => clearInterval(heartbeat));
      } catch (error) {
        console.error("SSE connection error:", error);
        this.sseTransports.delete(transport.sessionId);
        if (this.sessionManager.isAvailable()) {
          await this.sessionManager.deleteSession(transport.sessionId);
        }
      }
    });

    // MCP messages endpoint (POST)
    this.expressApp.post("/api/mcp/messages", async (req, res) => {
      if (!this.checkAuth(req, res)) return;
      if (!this.checkCORS(req, res)) return;
      if (!this.checkRateLimit(req, res)) return;

      const sessionId = String(req.query.sessionId || "");

      // まずメモリ内のtransportを確認
      let transport = this.sseTransports.get(sessionId);

      // メモリにない場合、Redisでセッションの有効性を確認
      if (!transport && this.sessionManager.isAvailable()) {
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
          res.status(404).json({ error: "Invalid session" });
          return;
        }
        // セッションは有効だが、transportがない = 別インスタンス
        // この場合、現在のインスタンスでは処理できないが、
        // セッションは有効と判断してエラーを返さない
        console.error(
          `⚠️  Session ${sessionId} exists in Redis but not in memory (multi-instance scenario)`
        );
        res.status(503).json({
          error: "Service temporarily unavailable",
          message: "Session exists but connection is on different instance",
        });
        return;
      }

      if (!transport) {
        res.status(404).json({ error: "Invalid session" });
        return;
      }

      try {
        await transport.handlePostMessage(req, res);
      } catch (error) {
        console.error("Message handling error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Viewer SSE endpoint (GET)
    this.expressApp.get("/api/viewer/sse", (req, res) => {
      if (!this.checkCORS(req, res)) return;
      if (!this.checkRateLimit(req, res)) return;

      // HTTP/2 でも安定するようヘッダーを明示 + バッファリング無効化
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Connection", "keep-alive");
      if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
      }

      this.viewerSSEClients.add(res);
      this.logEvent("viewer_sse_connected", {});
      console.error("✓ Viewer SSE client connected");

      // 接続時に現在の状態を送信
      res.write(`retry: 10000\n\n`);
      res.write(
        `event: init\ndata: ${JSON.stringify({
          modelPath: this.vrmState.modelPath,
          isLoaded: this.vrmState.isLoaded,
        })}\n\n`
      );

      if (this.vrmState.modelPath) {
        const filePath = `/models/${this.vrmState.modelPath}`;
        res.write(
          `event: load_vrm_model\ndata: ${JSON.stringify({ filePath })}\n\n`
        );
      }

      // 心拍送信
      const heartbeat = setInterval(() => {
        if (res.writable) {
          res.write(": ping\n\n");
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);

      req.on("close", () => {
        clearInterval(heartbeat);
        this.viewerSSEClients.delete(res);
        this.logEvent("viewer_sse_disconnected", {});
        console.error("✗ Viewer SSE client disconnected");
      });
    });
  }

  private setupHandlers(): void {
    // ツール一覧を返す
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
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
      ],
    }));

    // Resources 一覧
    this.mcpServer.setRequestHandler(
      ListResourcesRequestSchema,
      async () => ({
        resources: [
          {
            uri: "mcp://vrm/capabilities",
            name: "VRM Capabilities",
            mimeType: "application/json",
            description: "提供しているツール一覧やエンドポイントの概要",
          },
          {
            uri: "mcp://vrm/status",
            name: "VRM Status",
            mimeType: "application/json",
            description:
              "現在のVRM状態（モデル、表情、ポーズ、読み込み済みアニメーション）",
          },
          {
            uri: "mcp://vrm/files",
            name: "Available Files",
            mimeType: "application/json",
            description: "利用可能なVRMモデル/アニメーションの一覧",
          },
          {
            uri: "mcp://vrm/docs",
            name: "VRM Docs",
            mimeType: "text/markdown",
            description: "使い方ドキュメントとワークフロー",
          },
          {
            uri: "mcp://vrm/examples",
            name: "VRM Examples",
            mimeType: "application/json",
            description: "よく使う操作のスニペット集",
          },
          {
            uri: "mcp://vrm/health",
            name: "VRM Health",
            mimeType: "application/json",
            description: "サーバーの死活/稼働情報",
          },
          {
            uri: "mcp://vrm/session",
            name: "VRM Session",
            mimeType: "application/json",
            description: "現在の接続やメトリクス",
          },
          {
            uri: "mcp://vrm/logs",
            name: "VRM Logs",
            mimeType: "application/json",
            description: "直近の重要イベントログ",
          },
          {
            uri: "mcp://vrm/schema",
            name: "VRM Schema",
            mimeType: "application/json",
            description: "提供ツールのフルスキーマ",
          },
        ],
      })
    );

    // Resource 読み取り
    this.mcpServer.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = (request.params as any).uri as string;

        if (uri === "mcp://vrm/capabilities") {
          const tools = [
            "load_vrm_model",
            "set_vrm_expression",
            "set_vrm_pose",
            "animate_vrm_bone",
            "get_vrm_status",
            "list_vrm_files",
            "load_gltf_animation",
            "play_gltf_animation",
            "stop_gltf_animation",
          ];
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
            contents: [
              { type: "text", text: JSON.stringify(payload, null, 2) },
            ],
          };
        }

        if (uri === "mcp://vrm/status") {
          const status = {
            isLoaded: this.vrmState.isLoaded,
            modelPath: this.vrmState.modelPath,
            expressions: Object.fromEntries(this.vrmState.expressions),
            pose: this.vrmState.pose,
            loadedAnimations: this.vrmState.loadedAnimations,
          };
          return {
            contents: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          };
        }

        if (uri === "mcp://vrm/files") {
          const result: any = {};
          try {
            const modelFiles = await fs.readdir(this.vrmModelsDir);
            result.models = modelFiles.filter((f) => f.endsWith(".vrm"));
          } catch {
            result.models = [];
          }
          try {
            const animFiles = await fs.readdir(this.vrmaAnimationsDir);
            result.animations = animFiles.filter(
              (f) => f.endsWith(".glb") || f.endsWith(".gltf")
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
          return {
            contents: [{ type: "text", text: md }],
          };
        }

        if (uri === "mcp://vrm/examples") {
          const examples = {
            examples: [
              {
                name: "基本ロードと表情・ポーズ",
                calls: [
                  { tool: "list_vrm_files", arguments: { type: "models" } },
                  {
                    tool: "load_vrm_model",
                    arguments: { filePath: "lvncer.vrm" },
                  },
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
                    arguments: {
                      animationPath: "walk.glb",
                      animationName: "walk",
                    },
                  },
                  {
                    tool: "play_gltf_animation",
                    arguments: {
                      animationName: "walk",
                      loop: true,
                      fadeInDuration: 0.2,
                    },
                  },
                ],
              },
            ],
          };
          return {
            contents: [
              { type: "text", text: JSON.stringify(examples, null, 2) },
            ],
          };
        }

        if (uri === "mcp://vrm/health") {
          const health = {
            version: "0.1.0",
            startedAt: new Date(this.serverStartTime).toISOString(),
            uptimeSec: Math.floor((Date.now() - this.serverStartTime) / 1000),
            sseSessions: this.sseTransports.size,
            viewerClients: this.viewerSSEClients.size,
            wsClients: this.connectedClients.size,
            redis: this.sessionManager.isAvailable()
              ? "ENABLED"
              : "DISABLED (in-memory)",
          };
          return {
            contents: [{ type: "text", text: JSON.stringify(health, null, 2) }],
          };
        }

        if (uri === "mcp://vrm/session") {
          const session = {
            sseSessionIds: Array.from(this.sseTransports.keys()),
            totals: {
              sseSessions: this.sseTransports.size,
              viewerClients: this.viewerSSEClients.size,
              wsClients: this.connectedClients.size,
            },
          };
          return {
            contents: [
              { type: "text", text: JSON.stringify(session, null, 2) },
            ],
          };
        }

        if (uri === "mcp://vrm/logs") {
          const logs = {
            total: this.recentEvents.length,
            latest: this.recentEvents.slice(-50),
          };
          return {
            contents: [
              { type: "text", text: JSON.stringify(logs, null, 2) },
            ],
          };
        }

        if (uri.startsWith("mcp://vrm/file/")) {
          const name = uri.substring("mcp://vrm/file/".length);
          let kind = "";
          let baseDir = "";
          let servedPrefix = "";
          if (name.endsWith(".vrm")) {
            kind = "model";
            baseDir = this.vrmModelsDir;
            servedPrefix = "/models/";
          } else if (name.endsWith(".glb") || name.endsWith(".gltf")) {
            kind = "animation";
            baseDir = this.vrmaAnimationsDir;
            servedPrefix = "/animations/";
          } else {
            throw new McpError(ErrorCode.InvalidRequest, `Unsupported file type: ${name}`);
          }
          const fullPath = path.join(baseDir, name);
          try {
            const stat = await fs.stat(fullPath);
            const info = {
              kind,
              name,
              path: `${servedPrefix}${name}`,
              size: stat.size,
              mtime: stat.mtime.toISOString(),
            };
            return {
              contents: [
                { type: "text", text: JSON.stringify(info, null, 2) },
              ],
            };
          } catch (error) {
            throw new McpError(ErrorCode.InvalidRequest, `File not found: ${name}`);
          }
        }

        if (uri === "mcp://vrm/schema") {
          const schema = {
            tools: [
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
            ],
          };
          return {
            contents: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
          };
        }

        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unknown resource URI: ${uri}`
        );
      }
    );

    // ツール実行ハンドラー
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case "load_vrm_model":
            return await this.loadVRMModel(args as any);

          case "set_vrm_expression":
            return await this.setVRMExpression(args as any);

          case "set_vrm_pose":
            return await this.setVRMPose(args as any);

          case "animate_vrm_bone":
            return await this.animateVRMBone(args as any);

          case "get_vrm_status":
            return await this.getVRMStatus();

          case "list_vrm_files":
            return await this.listVRMFiles(args as any);

          case "load_gltf_animation":
            return await this.loadGLTFAnimation(args as any);

          case "play_gltf_animation":
            return await this.playGLTFAnimation(args as any);

          case "stop_gltf_animation":
            return await this.stopGLTFAnimation(args as any);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      console.error("✓ WebSocket client connected");
      this.connectedClients.add(ws);

      // 接続時に現在の状態を送信
      ws.send(
        JSON.stringify({
          type: "init",
          data: {
            modelPath: this.vrmState.modelPath,
            isLoaded: this.vrmState.isLoaded,
          },
        })
      );

      ws.on("close", () => {
        console.error("✗ WebSocket client disconnected");
        this.connectedClients.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.connectedClients.delete(ws);
      });
    });
  }

  private broadcast(message: any): void {
    // WebSocket broadcast (legacy)
    const data = JSON.stringify(message);
    this.connectedClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });

    // SSE broadcast
    this.broadcastSSE(message);
  }

  private broadcastSSE(message: any): void {
    const eventType = message.type || "message";
    const eventData = JSON.stringify(message.data || message);
    const sseMessage = `event: ${eventType}\ndata: ${eventData}\n\n`;

    const totals = { total: this.viewerSSEClients.size, writable: 0 };
    this.viewerSSEClients.forEach((client) => {
      if (client.writable) {
        try {
          client.write(sseMessage);
          totals.writable += 1;
        } catch (_) {
          // ignore individual stream errors
        }
      }
    });
    console.error(
      `SSE broadcast: ${eventType} -> viewers=${totals.total} writable=${totals.writable}`
    );
  }

  private logEvent(event: string, data: any): void {
    const entry = { ts: new Date().toISOString(), event, data };
    this.recentEvents.push(entry);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxRecentEvents);
    }
  }

  // ===== ツール実装 =====

  private async loadVRMModel(args: { filePath: string }) {
    const { filePath } = args;
    const fullPath = path.join(this.vrmModelsDir, filePath);

    try {
      // ファイルの存在確認
      await fs.access(fullPath);

      // 状態更新
      this.vrmState.modelPath = filePath;
      this.vrmState.isLoaded = true;

      // ブラウザに送信
      this.broadcast({
        type: "load_vrm_model",
        data: { filePath: `/models/${filePath}` },
      });
      this.logEvent("load_vrm_model", { filePath });

      return {
        content: [
          {
            type: "text",
            text: `✓ VRMモデルを読み込みました: ${filePath}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`VRMモデルの読み込みに失敗しました: ${filePath}`);
    }
  }

  private async setVRMExpression(args: { expression: string; weight: number }) {
    const { expression, weight } = args;

    if (!this.vrmState.isLoaded) {
      throw new Error("VRMモデルが読み込まれていません");
    }

    // 状態更新
    this.vrmState.expressions.set(expression, weight);

    // ブラウザに送信
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

  private async setVRMPose(args: { position?: any; rotation?: any }) {
    const { position, rotation } = args;

    if (!this.vrmState.isLoaded) {
      throw new Error("VRMモデルが読み込まれていません");
    }

    // 状態更新
    if (position) {
      this.vrmState.pose.position = {
        ...this.vrmState.pose.position,
        ...position,
      };
    }
    if (rotation) {
      this.vrmState.pose.rotation = {
        ...this.vrmState.pose.rotation,
        ...rotation,
      };
    }

    // ブラウザに送信
    this.broadcast({
      type: "set_vrm_pose",
      data: { position, rotation },
    });
    this.logEvent("set_vrm_pose", { position, rotation });

    return {
      content: [
        {
          type: "text",
          text: `✓ VRMモデルのポーズを更新しました`,
        },
      ],
    };
  }

  private async animateVRMBone(args: { boneName: string; rotation: any }) {
    const { boneName, rotation } = args;

    if (!this.vrmState.isLoaded) {
      throw new Error("VRMモデルが読み込まれていません");
    }

    // 状態更新
    this.vrmState.bones.set(boneName, rotation);

    // ブラウザに送信
    this.broadcast({
      type: "animate_vrm_bone",
      data: { boneName, rotation },
    });
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

  private async getVRMStatus() {
    const status = {
      isLoaded: this.vrmState.isLoaded,
      modelPath: this.vrmState.modelPath,
      expressions: Object.fromEntries(this.vrmState.expressions),
      pose: this.vrmState.pose,
      loadedAnimations: this.vrmState.loadedAnimations,
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

  private async listVRMFiles(args: { type?: string }) {
    const type = args.type || "all";
    const result: any = {};

    if (type === "models" || type === "all") {
      try {
        const files = await fs.readdir(this.vrmModelsDir);
        result.models = files.filter((f) => f.endsWith(".vrm"));
      } catch (error) {
        result.models = [];
      }
    }

    if (type === "animations" || type === "all") {
      try {
        const files = await fs.readdir(this.vrmaAnimationsDir);
        result.animations = files.filter(
          (f) => f.endsWith(".glb") || f.endsWith(".gltf")
        );
      } catch (error) {
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

    return {
      content: [
        {
          type: "text",
          text: summary.join("\n") || "利用可能なファイルがありません",
        },
      ],
    };
    this.logEvent("list_vrm_files", { type });
  }

  private async loadGLTFAnimation(args: {
    animationPath: string;
    animationName: string;
  }) {
    const { animationPath, animationName } = args;
    const fullPath = path.join(this.vrmaAnimationsDir, animationPath);

    try {
      // ファイルの存在確認
      await fs.access(fullPath);

      // 状態更新
      if (!this.vrmState.loadedAnimations.includes(animationName)) {
        this.vrmState.loadedAnimations.push(animationName);
      }

      // ブラウザに送信
      this.broadcast({
        type: "load_gltf_animation",
        data: {
          animationPath: `/animations/${animationPath}`,
          animationName,
        },
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
    } catch (error) {
      throw new Error(
        `glTFアニメーションの読み込みに失敗しました: ${animationPath}`
      );
    }
  }

  private async playGLTFAnimation(args: {
    animationName: string;
    loop?: boolean;
    fadeInDuration?: number;
  }) {
    const { animationName, loop, fadeInDuration } = args;

    if (!this.vrmState.isLoaded) {
      throw new Error("VRMモデルが読み込まれていません");
    }

    // 未ロード名の再生を防止（フロントで"Animation not loaded"になるのを前で弾く）
    if (!this.vrmState.loadedAnimations.includes(animationName)) {
      throw new Error(`アニメーションが未ロードです: ${animationName}`);
    }

    this.broadcast({
      type: "play_gltf_animation",
      data: { animationName, loop, fadeInDuration },
    });
    this.logEvent("play_gltf_animation", { animationName, loop, fadeInDuration });

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

  private async stopGLTFAnimation(args: { fadeOutDuration?: number }) {
    const { fadeOutDuration } = args;

    this.broadcast({
      type: "stop_gltf_animation",
      data: { fadeOutDuration },
    });
    this.logEvent("stop_gltf_animation", { fadeOutDuration });

    return {
      content: [
        {
          type: "text",
          text: `⏹ glTFアニメーションを停止しました`,
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error("🚀 VRM MCP Server が起動しました (stdio + HTTP)");
  }
}

// サーバーを起動
const server = new VRMMCPServer();
server.run().catch((error) => {
  console.error("サーバーの起動に失敗しました:", error);
  process.exit(1);
});
