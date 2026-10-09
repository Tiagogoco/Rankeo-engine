import type { BracketEngine } from "./types.js";
import { singleEliminationEngine } from "./single-elimination.js";
import { roundRobinEngine } from "./round-robin.js";

export type TournamentFormat =
  | "single_elimination"
  | "round_robin"
  | "group_stage_playoffs";

export function createEngine(format: TournamentFormat): BracketEngine {
  switch (format) {
    case "single_elimination":
      return singleEliminationEngine;
    case "round_robin":
      return roundRobinEngine;
    case "group_stage_playoffs":
      // Group stage uses round-robin for groups, SE for playoffs
      // Handled externally via generateGroups + generateGroupMatches + generatePlayoffBracket
      return roundRobinEngine;
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

export { generateBracket, advanceWinner as advanceSEWinner } from "./single-elimination.js";
export { generateSchedule, getStandings, advanceWinner as advanceRRWinner } from "./round-robin.js";
export { generateGroups, generateGroupMatches, generatePlayoffBracket } from "./group-stage.js";
export type { Team, Match, Standing, Group, BracketEngine, BracketOptions } from "./types.js";
