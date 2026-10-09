export interface EngineMatch {
  id: string;
  round: number;
  position: number;
  team_a_id: string | null;
  team_b_id: string | null;
  format: string;
  category_sort_order: number;
  // Match this one feeds its winner into (bracket graph). Null for finals / RR.
  next_match_id?: string | null;
}

export interface EngineCourt {
  id: string;
  sort_order: number;
}

export interface DayConfig {
  date: string;       // "YYYY-MM-DD"
  start_time: string; // "HH:MM"
  end_time: string;   // Last allowed start (HH:MM), not closing time
}

export interface ScheduleConfig {
  match_duration: number; // minutes
  break_between: number;  // minutes (court turnaround + precedence gap)
  // Minimum rest for the same physical player between matches (cross-category).
  // Distinct from break_between. Falls back to 90 when absent (legacy tournaments).
  player_rest_minutes?: number;
  days: DayConfig[];
}

export interface ScheduleAssignment {
  match_id: string;
  court_id: string;
  scheduled_at: Date;
}

export interface ExistingAssignment {
  court_id: string;
  scheduled_at: string; // ISO string
  team_a_id: string | null;
  team_b_id: string | null;
  // Set when this assignment can be a feeder of a pending match (precedence rule).
  match_id?: string;
  next_match_id?: string | null;
}

export type ScheduleStrategy = "greedy" | "optimized";

export interface ScheduleResult {
  assignments: ScheduleAssignment[];
  /** Strategy whose assignments are returned. */
  strategy: ScheduleStrategy;
  /** True when "optimized" was requested but greedy was kept (couldn't beat it). */
  fellBackToGreedy: boolean;
}

export type Slot = { date: string; startMin: number; courtId: string };
