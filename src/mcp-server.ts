#!/usr/bin/env node

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
import { getTools } from "./mcp/tools.js";
import { getResources } from "./mcp/resources.js";
import { toolHandlers } from "./mcp/toolHandlers.js";
import { handleResourceRead } from "./mcp/resourceHandlers.js";
import { VRMService } from "./services/index.js";

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

export class VRMMCPServer {
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
  private vrmService!: VRMService;

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
      modelPath: "standard.glb",
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

    // VRM Service 初期化
    this.vrmService = new VRMService(
      this.vrmState,
      {
        vrmModelsDir: this.vrmModelsDir,
        vrmaAnimationsDir: this.vrmaAnimationsDir,
      },
      (message) => this.broadcast(message),
      (event, data) => this.logEvent(event, data)
    );

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
        this.logEvent("mcp_sse_disconnected", {
          sessionId: transport.sessionId,
        });
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
        // Emit generic event only
        res.write(
          `event: load_model\ndata: ${JSON.stringify({ filePath })}\n\n`
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
      tools: getTools(),
    }));

    // Resources 一覧
    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: getResources(),
    }));

    // Resource 読み取り
    this.mcpServer.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const params = (request as any).params ?? {};
        try {
          console.error("resources/read params:", params);
        } catch {}
        const uri = (params as any).uri as string | undefined;
        if (!uri) {
          console.error("resources/read missing uri param");
          throw new McpError(ErrorCode.InvalidRequest, "Missing uri param");
        }
        this.logEvent("resource_read_request", { uri });
        return await handleResourceRead(this as any, uri);
      }
    );

    // ツール実行ハンドラー
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        const handler = (toolHandlers as any)[name];
        if (!handler) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
        return await handler(this, args as any);
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
      this.recentEvents.splice(
        0,
        this.recentEvents.length - this.maxRecentEvents
      );
    }
  }

  // ===== ツール実装 =====

  private async loadVRMModel(args: { filePath: string }) {
    return this.vrmService.loadVRMModel(args);
  }

  private async setVRMExpression(args: { expression: string; weight: number }) {
    return this.vrmService.setVRMExpression(args);
  }

  private async setVRMPose(args: { position?: any; rotation?: any }) {
    return this.vrmService.setVRMPose(args);
  }

  private async animateVRMBone(args: { boneName: string; rotation: any }) {
    return this.vrmService.animateVRMBone(args);
  }

  private async getVRMStatus() {
    return this.vrmService.getVRMStatus();
  }

  private async listVRMFiles(args: { type?: string }) {
    return this.vrmService.listVRMFiles(args);
  }

  private async loadGLTFAnimation(args: {
    animationPath: string;
    animationName: string;
  }) {
    return this.vrmService.loadGLTFAnimation(args);
  }

  private async playGLTFAnimation(args: {
    animationName: string;
    loop?: boolean;
    fadeInDuration?: number;
  }) {
    return this.vrmService.playGLTFAnimation(args);
  }

  private async stopGLTFAnimation(args: { fadeOutDuration?: number }) {
    return this.vrmService.stopGLTFAnimation(args);
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error("🚀 VRM MCP Server が起動しました (stdio + HTTP)");
  }
}
