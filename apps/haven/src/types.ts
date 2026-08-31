export type LightId = "porch" | "living" | "kitchen" | "bedroom";
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

export interface House {
  lights: Light[];
  /** Measured room temperature, °C. */
  temperatureC: number;
  /** What the thermostat is aiming for, °C. */
  targetC: number;
  doorLocked: boolean;
  alarmArmed: boolean;
  scene: SceneId;
  /** People with standing access. The attacker wants a row here. */
  access: string[];
}
