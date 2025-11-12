export type ToolHandler = (server: any, args: any) => Promise<any>;

export const toolHandlers: Record<string, ToolHandler> = {
  load_model: (server, args) => (server as any).loadVRMModel(args),
  list_assets: (server, args) => (server as any).listVRMFiles(args),
  load_animation: (server, args) => (server as any).loadGLTFAnimation(args),
  play_animation: (server, args) => (server as any).playGLTFAnimation(args),
  stop_animation: (server, args) => (server as any).stopGLTFAnimation(args),
};
