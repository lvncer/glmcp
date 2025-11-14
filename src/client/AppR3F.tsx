import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

function Scene(props: {
  onStatus: (s: "connecting" | "connected" | "disconnected") => void;
  onModel: (name: string) => void;
  onAnimation: (name: string) => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const loadedClipsRef = useRef<Map<string, THREE.AnimationClip>>(new Map());
  const targetSkinnedRef = useRef<THREE.SkinnedMesh | null>(null);

  useFrame((_, dt) => {
    if (mixerRef.current) mixerRef.current.update(dt);
  });

  function makeLoader(): GLTFLoader {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderConfig({ type: "wasm" });
    draco.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/"
    );
    loader.setDRACOLoader(draco);
    return loader;
  }

  function findFirstSkinned(object: THREE.Object3D | undefined | null): THREE.SkinnedMesh | null {
    if (!object) return null;
    let found: THREE.SkinnedMesh | null = null;
    object.traverse((n) => {
      if (!found && (n as any).isSkinnedMesh) {
        found = n as THREE.SkinnedMesh;
      }
    });
    return found;
  }

  async function loadModel(filePath: string) {
    if (!rootRef.current) return;
    try {
      const loader = makeLoader();
      const gltf = await loader.loadAsync(filePath);

      while (rootRef.current.children.length > 0) {
        const child = rootRef.current.children[0];
        child.parent?.remove(child);
      }

      const scene = (gltf as any).scene as THREE.Object3D | undefined;
      if (!scene) throw new Error("glTF scene not found");
      rootRef.current.add(scene);

      mixerRef.current = new THREE.AnimationMixer(scene);
      targetSkinnedRef.current = findFirstSkinned(scene);
      loadedClipsRef.current.clear();
      if (currentActionRef.current) {
        currentActionRef.current.stop();
        currentActionRef.current = null;
      }

      const name = String(filePath).split("/").pop() || "Loaded";
      props.onModel(name);
    } catch (e) {
      console.error("Failed to load model:", e);
      props.onStatus("disconnected");
    }
  }

  async function loadAnimation(animationPath: string, animationName: string) {
    try {
      const loader = makeLoader();
      const gltf = await loader.loadAsync(animationPath);
      const clips: THREE.AnimationClip[] = (gltf as any).animations || [];
      if (clips.length > 0) {
        const sourceRoot: THREE.Object3D | undefined = (gltf as any).scene;
        const sourceSkinned = findFirstSkinned(sourceRoot);
        const targetSkinned = targetSkinnedRef.current;
        let clipToUse = clips[0];
        const sourceBones = (sourceSkinned as any)?.skeleton?.bones;
        const targetBones = (targetSkinned as any)?.skeleton?.bones;
        const canCompareBones =
          Array.isArray(sourceBones) && Array.isArray(targetBones);
        const shouldRetarget =
          canCompareBones && sourceBones.length !== targetBones.length;

        if (sourceSkinned && targetSkinned && shouldRetarget) {
          try {
            const mod: any = await import(
              "three/examples/jsm/utils/SkeletonUtils.js"
            );
            const retargetClipFn =
              typeof mod?.retargetClip === "function"
                ? mod.retargetClip
                : typeof mod?.default?.retargetClip === "function"
                ? mod.default.retargetClip
                : null;
            const retargeted = retargetClipFn
              ? retargetClipFn(targetSkinned, sourceSkinned, clipToUse)
              : null;
            if (retargeted) {
              clipToUse = retargeted as THREE.AnimationClip;
            } else {
              console.warn(
                "retargetClip not available; using original clip (bone names must match)"
              );
            }
          } catch (err) {
            console.warn("Retarget failed; using original clip", err);
          }
        } else if (!sourceSkinned || !targetSkinned) {
          console.warn(
            "No source/target SkinnedMesh; using original clip"
          );
        } else {
          console.warn(
            "Source/target skeletons look compatible; using original clip without retarget"
          );
        }
        loadedClipsRef.current.set(animationName, clipToUse);
      } else {
        console.warn("No animations found in glTF:", animationPath);
      }
    } catch (e) {
      console.error("Failed to load glTF animation:", e);
    }
  }

  function playAnimation(
    animationName: string,
    opts?: { loop?: boolean; fadeInDuration?: number }
  ) {
    const group = (targetSkinnedRef.current as unknown as THREE.Object3D) || rootRef.current;
    const mixer = mixerRef.current;
    if (!group || !mixer) return;

    let tries = 10;
    const attempt = () => {
      const clip = loadedClipsRef.current.get(animationName);
      if (!clip) {
        if (tries-- > 0) return void setTimeout(attempt, 200);
        console.warn("Animation not loaded:", animationName);
        return;
      }
      const next = mixer.clipAction(clip, group);
      next.reset();
      next.setLoop(
        opts?.loop ? THREE.LoopRepeat : THREE.LoopOnce,
        opts?.loop ? Infinity : 1
      );
      next.clampWhenFinished = true;
      const fadeIn =
        typeof opts?.fadeInDuration === "number" ? opts.fadeInDuration! : 0.3;
      if (currentActionRef.current && currentActionRef.current !== next) {
        currentActionRef.current.fadeOut(fadeIn);
      }
      next.fadeIn(fadeIn).play();
      currentActionRef.current = next;
      props.onAnimation(animationName);
    };
    attempt();
  }

  function stopAnimation(fadeOutDuration?: number) {
    const fadeOut = typeof fadeOutDuration === "number" ? fadeOutDuration : 0.3;
    if (currentActionRef.current) {
      const toStop = currentActionRef.current;
      toStop.fadeOut(fadeOut);
      setTimeout(() => toStop.stop(), Math.max(0, fadeOut) * 1000 + 50);
      currentActionRef.current = null;
      props.onAnimation("None");
    }
  }

  useEffect(() => {
    const es = new EventSource("/api/viewer/sse");
    props.onStatus("connecting");

    es.onopen = () => props.onStatus("connected");
    es.onerror = () => props.onStatus("disconnected");

    const onInit = (event: MessageEvent) => {
      try {
        JSON.parse(event.data);
      } catch {}
    };

    const onLoadModel = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      const filePath: string = data.filePath;
      if (typeof filePath !== "string") return;
      if (filePath.endsWith(".vrm")) return; // ignore legacy
      loadModel(filePath);
    };

    const onLoadAnimation = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      loadAnimation(data.animationPath, data.animationName);
    };

    const onPlayAnimation = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      playAnimation(data.animationName, {
        loop: data.loop,
        fadeInDuration: data.fadeInDuration,
      });
    };

    const onStopAnimation = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      stopAnimation(data.fadeOutDuration);
    };

    es.addEventListener("init", onInit as any);
    es.addEventListener("load_model", onLoadModel as any);
    es.addEventListener("load_animation", onLoadAnimation as any);
    es.addEventListener("play_animation", onPlayAnimation as any);
    es.addEventListener("stop_animation", onStopAnimation as any);

    return () => {
      es.removeEventListener("init", onInit as any);
      es.removeEventListener("load_model", onLoadModel as any);
      es.removeEventListener("load_animation", onLoadAnimation as any);
      es.removeEventListener("play_animation", onPlayAnimation as any);
      es.removeEventListener("stop_animation", onStopAnimation as any);
      es.close();
    };
  }, []);

  return (
    <>
      <ambientLight intensity={1.5} />
      <directionalLight position={[1, 1, 1]} intensity={2.0} />
      <gridHelper args={[10, 10]} />
      <axesHelper args={[5]} />
      <group ref={rootRef} position={[0, 0, 0]} />
      <OrbitControls target={[0, 1, 0]} />
      <Environment preset="city" />
    </>
  );
}

export function App() {
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [modelName, setModelName] = useState<string>("Not loaded");
  const [animationName, setAnimationName] = useState<string>("None");

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#1a1a1a",
      }}
    >
      <Canvas camera={{ position: [0, 1.5, 5], fov: 50 }}>
        <Scene
          onStatus={setStatus}
          onModel={setModelName}
          onAnimation={setAnimationName}
        />
      </Canvas>
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          color: "#fff",
          background: "rgba(0,0,0,.8)",
          padding: "12px 16px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 13,
        }}
      >
        <div style={{ marginBottom: 8, color: "#00d4ff", fontWeight: 700 }}>
          glTF Viewer (R3F)
        </div>
        <div style={{ marginBottom: 4 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              marginRight: 8,
              background: status === "connected" ? "#0f0" : "#f00",
            }}
          />
          <strong>Status:</strong> {status}
        </div>
        <div style={{ marginBottom: 4 }}>
          <strong>Model:</strong> {modelName}
        </div>
        <div>
          <strong>Animation:</strong> {animationName}
        </div>
      </div>
    </div>
  );
}
