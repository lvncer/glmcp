export function getResources() {
  return [
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
  ];
}
