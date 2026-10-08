/**
 * The one error type sources throw. Its message is a short reason that is safe to log and to write to the state
 * file: it may name a host, never a path, query, address, password or token (SPEC 10.1 and 12).
 */

/** The two failure states of SPEC 8.3. */
export type FailureState = 'signInNeeded' | 'notReachable';

export interface SourceErrorOptions {
  /** The address of the administrator instructions, for a refused Microsoft sign-in (SPEC 4.3.1). */
  help?: string;
  /** Microsoft refused: the reason is logged once with the "Microsoft refused" line. */
  refused?: boolean;
  /** No token yet: cheap to retry on every tick, since it only checks the token file. */
  noToken?: boolean;
  /** The server asked to wait this long before trying again (Retry-After). */
  retryAfterMs?: number;
  /** iCloud answered 401. */
  unauthorized?: boolean;
  /** The server answered 404 (a listed Microsoft calendar that was deleted or unshared). */
  notFound?: boolean;
  /** What went wrong, for the settings page's Test and Connect results (SPEC 10.3). */
  kind?: 'network' | 'http' | 'insecure' | 'notCalendar' | 'tooLarge';
  /** The HTTP status, with `kind` `http`. */
  status?: number;
}

export class SourceError extends Error {
  constructor(
    readonly state: FailureState,
    message: string,
    readonly options: SourceErrorOptions = {},
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

/** Any thrown value as a SourceError. Unexpected errors become "notReachable" with a generic, safe reason. */
export function toSourceError(err: unknown): SourceError {
  if (err instanceof SourceError) {
    return err;
  }
  return new SourceError('notReachable', 'an unexpected error occurred');
}
