export type ToolHandler = (server: any, args: any) => Promise<any>;

export const toolHandlers: Record<string, ToolHandler> = {
  load_model: (server, args) => (server as any).loadModel(args),
  list_assets: (server, args) => (server as any).listAssets(args),
  load_animation: (server, args) => (server as any).loadAnimation(args),
  play_animation: (server, args) => (server as any).playAnimation(args),
  stop_animation: (server, args) => (server as any).stopAnimation(args),
};
