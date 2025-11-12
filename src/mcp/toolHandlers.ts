export type ToolHandler = (server: any, args: any) => Promise<any>;

export const toolHandlers: Record<string, ToolHandler> = {
  // Generic model & animation handlers (preferred)
  load_model: (server, args) => (server as any).loadVRMModel(args),
  list_assets: (server, args) => (server as any).listVRMFiles(args),
  load_animation: (server, args) => (server as any).loadGLTFAnimation(args),
  play_animation: (server, args) => (server as any).playGLTFAnimation(args),
  stop_animation: (server, args) => (server as any).stopGLTFAnimation(args),

  load_vrm_model: (server, args) => (server as any).loadVRMModel(args),
  set_vrm_expression: (server, args) => (server as any).setVRMExpression(args),
  set_vrm_pose: (server, args) => (server as any).setVRMPose(args),
  animate_vrm_bone: (server, args) => (server as any).animateVRMBone(args),
  get_vrm_status: (server) => (server as any).getVRMStatus(),
  list_vrm_files: (server, args) => (server as any).listVRMFiles(args),
  load_gltf_animation: (server, args) =>
    (server as any).loadGLTFAnimation(args),
  play_gltf_animation: (server, args) =>
    (server as any).playGLTFAnimation(args),
  stop_gltf_animation: (server, args) =>
    (server as any).stopGLTFAnimation(args),
};
