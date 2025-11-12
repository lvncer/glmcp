import { ViewerMCPServer } from "../mcp-server.js";

async function main() {
  const server = new ViewerMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error("サーバーの起動に失敗しました:", error);
  process.exit(1);
});
