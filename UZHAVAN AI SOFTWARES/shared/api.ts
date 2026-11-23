/** Shapes exchanged between the backend and the dashboard. */
import type { FieldValue } from "./am1.ts";

export type Severity = "crit" | "warn" | "info";

export interface Device {
  id: string;
  type: string;
  name: string;
  zone: string | null;
  firstSeen: number;
  lastSeen: number;
  lastSeq: number | null;
  packets: number;
  lost: number;
  rssi: number | null;
  gateway: string | null;
  online: boolean;
  latest: Record<string, FieldValue>;
}

export type AlertCode =
  | "NODE_OFFLINE" | "SENSOR_NA" | "BATTERY_LOW"
  | "IRRIGATE_NOW" | "IRRIGATION_SKIPPED_RAIN" | "IRRIGATING" | "WATERLOGGING"
  | "HEAT_STRESS" | "COLD_STRESS" | "FUNGAL_RISK" | "NITROGEN_LOW" | "SALT_HIGH"
  | "PUMP_TRIP" | "PUMP_RUNNING" | "TANK_LOW"
  | "DO_LOW" | "DO_CRIT" | "AERATOR_FAULT" | "PH_OUT" | "POND_FAULT"
  | "PEST_HIGH" | "COLD_ROOM_WARM" | "DO_NOT_HARVEST" | "COMMAND_FAILED";

export type Params = Record<string, string | number>;

export interface Alert {
  id: number;
  key: string;
  code: AlertCode;
  severity: Severity;
  deviceId: string | null;
  params: Params;
  openedAt: number;
}

export type CommandStatus = "pending" | "sent" | "acked" | "failed";

export interface Command {
  id: number;
  deviceId: string;
  cmd: string;
  val: string;
  source: "farmer" | "auto";
  reason: string;
  status: CommandStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Spray {
  id: number;
  product: string;
  kind: "insect" | "fungus" | "weed" | "other";
  phiDays: number;
  halfLifeDays: number;
  zone: string | null;
  sprayedAt: number;
  /** Days predicted by the breakdown model from live soil temperature and moisture. */
  modelDays: number;
  /** Never earlier than the label's pre-harvest interval. */
  safeAt: number;
}

export interface Weather {
  source: "open-meteo" | "override" | "none";
  tempC: number | null;
  humidity: number | null;
  rainNowMm: number | null;
  rainProb12h: number | null;
  rainMm24h: number | null;
  updatedAt: number | null;
}

export interface Message {
  id: number;
  channel: "sms";
  code: AlertCode;
  params: Params;
  text: string;
  createdAt: number;
}

export interface Settings {
  farmName: string;
  lat: number;
  lon: number;
  language: Lang;
  autoIrrigate: boolean;
  dryBelow: number;
  fullAt: number;
  rainSkipProb: number;
  doLow: number;
  weatherOverride: { rainProb12h: number; rainMm24h: number; rainNowMm: number } | null;
}

export type Lang = "en" | "te" | "ta";

export interface State {
  now: number;
  devices: Device[];
  alerts: Alert[];
  commands: Command[];
  sprays: Spray[];
  messages: Message[];
  weather: Weather;
  settings: Settings;
}

export interface HistoryPoint { t: number; v: Record<string, FieldValue> }

export type LiveEvent =
  | { type: "device"; device: Device }
  | { type: "alerts"; alerts: Alert[] }
  | { type: "command"; command: Command }
  | { type: "message"; message: Message }
  | { type: "sprays"; sprays: Spray[] }
  | { type: "weather"; weather: Weather }
  | { type: "settings"; settings: Settings };
