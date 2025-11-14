export function getResources() {
  return [
    {
      uri: "mcp://viewer/capabilities",
      name: "Viewer Capabilities",
      mimeType: "application/json",
      description: "提供ツール一覧やエンドポイントの概要",
    },
    {
      uri: "mcp://viewer/status",
      name: "Viewer Status",
      mimeType: "application/json",
      description: "現在の状態（モデル、読み込み済みアニメーションなど）",
    },
    {
      uri: "mcp://viewer/files",
      name: "Available Files",
      mimeType: "application/json",
      description: "利用可能なモデル/アニメーションの一覧",
    },
    {
      uri: "mcp://viewer/docs",
      name: "Viewer Docs",
      mimeType: "text/markdown",
      description: "使い方ドキュメントとワークフロー",
    },
    {
      uri: "mcp://viewer/examples",
      name: "Viewer Examples",
      mimeType: "application/json",
      description: "よく使う操作のスニペット集",
    },
    {
      uri: "mcp://viewer/health",
      name: "Viewer Health",
      mimeType: "application/json",
      description: "サーバーの死活/稼働情報",
    },
    {
      uri: "mcp://viewer/session",
      name: "Viewer Session",
      mimeType: "application/json",
      description: "現在の接続やメトリクス",
    },
    {
      uri: "mcp://viewer/logs",
      name: "Viewer Logs",
      mimeType: "application/json",
      description: "直近の重要イベントログ",
    },
    {
      uri: "mcp://viewer/schema",
      name: "Viewer Schema",
      mimeType: "application/json",
      description: "提供ツールのフルスキーマ",
    },
  ];
}
