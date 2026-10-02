import { useEffect, type MutableRefObject } from "react";
import { Application, Assets, Rectangle, TextureStyle, Texture } from "pixi.js";
import { PIXEL_ATLAS_URL, PIXEL_ATLAS_POSES, pixelAtlasFrame } from "./pixel-atlas";
import type { Agent, Department, SubAgent, Task } from "../../types";
import { buildSpriteMap } from "../AgentAvatar";
import { type Delivery, MIN_OFFICE_W, findScrollContainer } from "./model";
import { runOfficeTickerStep, type OfficeTickerContext } from "./officeTicker";

interface UseOfficePixiRuntimeParams {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  appRef: MutableRefObject<Application | null>;
  texturesRef: MutableRefObject<Record<string, Texture>>;
  destroyedRef: MutableRefObject<boolean>;
  initIdRef: MutableRefObject<number>;
  initDoneRef: MutableRefObject<boolean>;
  officeWRef: MutableRefObject<number>;
  scrollHostXRef: MutableRefObject<HTMLElement | null>;
  scrollHostYRef: MutableRefObject<HTMLElement | null>;
  deliveriesRef: MutableRefObject<Delivery[]>;
  dataRef: MutableRefObject<{ agents: Agent[] }>;
  buildScene: () => void;
  followCeoInView: () => void;
  triggerDepartmentInteract: () => void;
  keysRef: MutableRefObject<Record<string, boolean>>;
  tickerContext: OfficeTickerContext;
  departments: Department[];
  agents: Agent[];
  tasks: Task[];
  subAgents: SubAgent[];
  unreadAgentIds?: Set<string>;
  language: string;
  activeMeetingTaskId?: string | null;
  customDeptThemes?: Record<string, { floor1: number; floor2: number; wall: number; accent: number }>;
  currentTheme: string;
}

export function useOfficePixiRuntime({
  containerRef,
  appRef,
  texturesRef,
  destroyedRef,
  initIdRef,
  initDoneRef,
  officeWRef,
  scrollHostXRef,
  scrollHostYRef,
  deliveriesRef,
  dataRef,
  buildScene,
  followCeoInView,
  triggerDepartmentInteract,
  keysRef,
  tickerContext,
  departments,
  agents,
  tasks,
  subAgents,
  unreadAgentIds,
  language,
  activeMeetingTaskId,
  customDeptThemes,
  currentTheme,
}: UseOfficePixiRuntimeParams): void {
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    destroyedRef.current = false;
    const currentInitId = ++initIdRef.current;
    scrollHostXRef.current = findScrollContainer(element, "x");
    scrollHostYRef.current = findScrollContainer(element, "y");

    async function init() {
      if (!element) return;
      TextureStyle.defaultOptions.scaleMode = "nearest";

      officeWRef.current = Math.max(MIN_OFFICE_W, element.clientWidth);

      const app = new Application();
      await app.init({
        width: officeWRef.current,
        height: 600,
        backgroundAlpha: 0,
        antialias: false,
        resolution: 1,
        roundPixels: true,
        autoDensity: true,
      });

      if (initIdRef.current !== currentInitId) {
        try {
          app.destroy();
        } catch {}
        return;
      }

      appRef.current = app;
      const canvas = app.canvas as HTMLCanvasElement;
      canvas.style.imageRendering = "pixelated";
      element.innerHTML = "";
      element.appendChild(canvas);

      const spriteMap = buildSpriteMap(dataRef.current.agents);
      const textures: Record<string, Texture> = {};
      const loads: Promise<void>[] = [];
      const spriteNums = new Set<number>();

      for (let i = 1; i <= 13; i++) spriteNums.add(i);
      for (const num of spriteMap.values()) spriteNums.add(num);

      const atlas = await Assets.load<Texture>(PIXEL_ATLAS_URL).catch(() => undefined);
      for (const spriteNum of spriteNums) {
        if (atlas && pixelAtlasFrame(spriteNum)) {
          for (const pose of PIXEL_ATLAS_POSES) {
            const frame = pixelAtlasFrame(spriteNum, pose)!;
            textures[`${spriteNum}-${pose}`] = new Texture({
              source: atlas.source,
              frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
            });
          }
          continue;
        }
        for (const frame of [1, 2, 3]) {
          const key = `${spriteNum}-D-${frame}`;
          loads.push(
            Assets.load<Texture>(`/sprites/${key}.png`)
              .then((texture) => {
                textures[key] = texture;
              })
              .catch(() => {}),
          );
        }

        for (const direction of ["L", "R"]) {
          const key = `${spriteNum}-${direction}-1`;
          loads.push(
            Assets.load<Texture>(`/sprites/${key}.png`)
              .then((texture) => {
                textures[key] = texture;
              })
              .catch(() => {}),
          );
        }
      }

      loads.push(
        Assets.load<Texture>("/sprites/ceo-human-pixel.png")
          .then((texture) => {
            textures.ceo = texture;
          })
          .catch(() => {}),
      );

      await Promise.all(loads);

      if (initIdRef.current !== currentInitId) {
        try {
          app.destroy();
        } catch {}
        return;
      }

      texturesRef.current = textures;
      buildScene();
      initDoneRef.current = true;
      followCeoInView();

      app.ticker.add(() => {
        if (destroyedRef.current || appRef.current !== app) return;
        runOfficeTickerStep(tickerContext);
      });
    }

    const isInputFocused = () => {
      const tag = document.activeElement?.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        event.preventDefault();
        keysRef.current[event.code] = true;
      }
      if (event.code === "Enter" || event.code === "Space") {
        event.preventDefault();
        triggerDepartmentInteract();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isInputFocused()) return;
      keysRef.current[event.code] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    init();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !appRef.current || destroyedRef.current || initIdRef.current !== currentInitId) return;
      const newWidth = Math.max(MIN_OFFICE_W, Math.floor(entry.contentRect.width));
      if (Math.abs(newWidth - officeWRef.current) > 10) {
        officeWRef.current = newWidth;
        buildScene();
      }
    });

    resizeObserver.observe(element);

    return () => {
      destroyedRef.current = true;
      initIdRef.current++;
      resizeObserver.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      deliveriesRef.current = [];
      initDoneRef.current = false;
      scrollHostXRef.current = null;
      scrollHostYRef.current = null;

      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [
    containerRef,
    appRef,
    texturesRef,
    destroyedRef,
    initIdRef,
    initDoneRef,
    officeWRef,
    scrollHostXRef,
    scrollHostYRef,
    deliveriesRef,
    dataRef,
    buildScene,
    followCeoInView,
    triggerDepartmentInteract,
    keysRef,
    tickerContext,
  ]);

  useEffect(() => {
    if (initDoneRef.current && appRef.current) {
      buildScene();
    }
  }, [
    departments,
    agents,
    tasks,
    subAgents,
    unreadAgentIds,
    language,
    activeMeetingTaskId,
    customDeptThemes,
    currentTheme,
    buildScene,
    initDoneRef,
    appRef,
  ]);
}
