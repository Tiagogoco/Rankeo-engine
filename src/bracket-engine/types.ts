export interface Team {
  id: string;
  name: string;
  seed?: number;
}

export interface Match {
  id: string;
  round: number;
  position: number;
  teamA?: Team;
  teamB?: Team;
  winnerId?: string;
  nextMatchId?: string;
  /** Which slot in the next match the winner goes to */
  nextMatchSlot?: "a" | "b";
  bracketSide?: "winners" | "losers";
  groupId?: string;
  isBye?: boolean;
  /** Raw score — { sets: [{a,b},...] } — used for set/game tiebreakers */
  score?: { sets: { a: number; b: number }[] } | null;
}

export interface BracketOptions {
  seeds?: boolean;
  byes?: boolean;
}

export interface Standing {
  team: Team;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  /** Sets won (padel/tennis scoring). */
  scored: number;
  /** Sets lost (padel/tennis scoring). */
  conceded: number;
  played: number;
}

export interface Group {
  id: string;
  name: string;
  teams: Team[];
}

export interface BracketEngine {
  generateMatches(teams: Team[], options?: BracketOptions): Match[];
  advanceWinner(matches: Match[], matchId: string, winnerId: string): Match[];
  getStandings?(matches: Match[], teams: Team[]): Standing[];
}
