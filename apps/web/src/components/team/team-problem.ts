import { ApiRequestError } from '../../lib/api.ts';

export type TeamProblem =
  | 'alreadyHasTeam'
  | 'nameTaken'
  | 'alreadyInTeam'
  | 'teamFull'
  | 'teamClosed'
  | 'ownerCannotLeave'
  | 'notInTeam'
  | 'stale'
  | 'nothingToUpdate'
  | 'notFound'
  | 'limit'
  | 'invalid'
  | 'failed';

const BY_CODE: Record<string, TeamProblem> = {
  already_has_team: 'alreadyHasTeam',
  name_taken: 'nameTaken',
  already_in_team: 'alreadyInTeam',
  team_full: 'teamFull',
  team_closed: 'teamClosed',
  owner_cannot_leave: 'ownerCannotLeave',
  not_in_team: 'notInTeam',
  stale: 'stale',
  nothing_to_update: 'nothingToUpdate',
};

/** Which message a refused team write gets (06-API "Ambassadors", teams). Pure, for node --test. */
export function teamProblem(error: unknown): TeamProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  if (error.status === 429) return 'limit';
  const details = Array.isArray(error.body?.details) ? (error.body.details as unknown[]) : [];
  for (const code of details) {
    const problem = typeof code === 'string' ? BY_CODE[code] : undefined;
    if (problem) return problem;
  }
  if (error.status === 404) return 'notFound';
  return error.status === 400 ? 'invalid' : 'failed';
}
