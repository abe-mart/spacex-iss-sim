export const TRACKS = ["manual", "autopilot", "agent"] as const;
export type Track = typeof TRACKS[number];
export const RULES_VERSION = "dock-v1";
export const TRACK_LABELS: Record<Track, string> = {
  manual: "Manual Piloting", autopilot: "Autopilot", agent: "AI Agent",
};
export interface Settings {
  start_seed?: string;
  event_id?: string;
  event_name: string;
  event_code_hash: string;
  event_code_display?: string;
  event_open: boolean;
  leaderboard_public: boolean;
  join_url: string;
  enabled_tracks: Track[];
  rules_version: string;
}
export interface Session {
  token_hash: string;
  participant_id: string;
  callsign: string;
  role: "participant" | "admin";
  expires_at: number;
}
export interface Run {
  challenge?: string;
  start_position?: {x:number;y:number;z:number};
  event_id?: string;
  id: string;
  participant_id: string;
  callsign: string;
  track: Track;
  source: "hosted" | "local";
  assisted: boolean;
  model: string;
  rules_version: string;
  created_at: number;
  finished_at?: number;
  outcome: "flying" | "success" | "fail" | "abort";
  time_s?: number;
  pulses?: number;
  message?: string;
  excluded: boolean;
  exclusion_reason?: string;
}
export interface Score {
  challenge?: string;
  id: string; callsign: string; track: Track; assisted: boolean; model: string;
  time_s: number; pulses: number; created_at: number;
}
export interface BoardData {
  event_code?: string;
  event_name: string;
  join_url: string;
  rules_version: string;
  boards: Record<Track, Score[]>;
  stats: { attempts: number; dockings: number; crews: number };
  updated_at: number;
}

export interface EventArchive {id:string;label:string;archived_at:number;settings:Settings;runs:Run[]}
export interface ArchiveSummary {id:string;label:string;archived_at:number;flight_count:number}
