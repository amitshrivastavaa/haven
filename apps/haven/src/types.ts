/**
 * The WebMCP surface as the page sees it.
 *
 * Declared once here rather than cast at each call site, so the app can be
 * read the way the spec is written — `document.modelContext.registerTool(...)`
 * — instead of through an `as any`.
 */
export interface ModelContext {
  registerTool(tool: unknown, options?: { signal?: AbortSignal }): Promise<void>;
  getTools(): Promise<{ name: string }[]>;
  /** Native takes the arguments as a JSON string, not an object. */
  executeTool(tool: unknown, args: string): Promise<string>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

export type LightId = "porch" | "living" | "kitchen" | "bedroom" | "hall";
export type SceneId = "home" | "away" | "movie" | "goodnight";

export interface Light {
  id: LightId;
  name: string;
  on: boolean;
}

export interface DoorbellEvent {
  id: string;
  at: string;
  from: string;
  /**
   * What the intercom heard. This is third-party free text — a stranger at the
   * door composes it — which is exactly why `get_doorbell_events` declares
   * `untrustedContentHint`.
   */
  transcript: string;
}

export interface Oven {
  on: boolean;
  /** Degrees Celsius. */
  targetC: number;
  /** How long it was told to run for. */
  minutes: number;
}

export interface House {
  lights: Light[];
  /** Measured room temperature, °C. */
  temperatureC: number;
  /** What the thermostat is aiming for, °C. */
  targetC: number;
  doorLocked: boolean;
  alarmArmed: boolean;
  scene: SceneId;
  oven: Oven;
  /** People with standing access. The attacker wants a row here. */
  access: string[];
}
