// Microsoft Graph client: device code sign-in, token refresh, presence and calendar reads.
// Uses only Node built-ins (global fetch), no runtime dependencies.

import * as fs from 'node:fs';
import type { CalEvent, PresenceInfo } from './status';

export interface GraphLog {
  info(msg: string): void;
  warn(msg: string): void;
  debug(msg: string): void;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class SignInRequiredError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GraphClient {
  private tokens: StoredTokens | null = null;
  private signingIn: Promise<void> | null = null;
  private readonly scope: string;

  constructor(
    private readonly log: GraphLog,
    private readonly tenantId: string,
    private readonly clientId: string,
    private readonly tokenPath: string,
    usePresence: boolean,
    useCalendar: boolean,
  ) {
    const scopes = ['offline_access'];
    if (usePresence) {
      scopes.push('Presence.Read');
    }
    if (useCalendar) {
      scopes.push('Calendars.Read');
    }
    this.scope = scopes.join(' ');
    try {
      this.tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as StoredTokens;
    } catch {
      this.tokens = null;
    }
  }

  private get authBase(): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0`;
  }

  private async post(url: string, form: Record<string, string>): Promise<{ status: number; body: any }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15000),
    });
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // leave body empty
    }
    return { status: res.status, body };
  }

  private save(body: any): void {
    this.tokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? this.tokens?.refreshToken ?? '',
      expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    };
    const tmp = `${this.tokenPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.tokens), { mode: 0o600 });
    fs.renameSync(tmp, this.tokenPath);
  }

  private clear(): void {
    this.tokens = null;
    try {
      fs.unlinkSync(this.tokenPath);
    } catch {
      // nothing stored
    }
  }

  /** Signs in if there are no stored tokens. Resolves once tokens are available. */
  ensureSignedIn(): Promise<void> {
    if (this.tokens?.refreshToken) {
      return Promise.resolve();
    }
    if (!this.signingIn) {
      this.signingIn = this.deviceCodeLoop().finally(() => {
        this.signingIn = null;
      });
    }
    return this.signingIn;
  }

  private async deviceCodeLoop(): Promise<void> {
    for (;;) {
      try {
        const start = await this.post(`${this.authBase}/devicecode`, {
          client_id: this.clientId,
          scope: this.scope,
        });
        if (start.status !== 200) {
          const detail = start.body.error_description ?? start.body.error ?? `HTTP ${start.status}`;
          this.log.warn(`Could not start Microsoft sign-in: ${detail}. Retrying in 5 minutes.`);
          await sleep(300000);
          continue;
        }
        this.log.warn('==================== Microsoft 365 sign-in needed ====================');
        this.log.warn(`Open ${start.body.verification_uri} and enter the code ${start.body.user_code}`);
        this.log.warn('======================================================================');
        let interval = (Number(start.body.interval) || 5) * 1000;
        const deadline = Date.now() + (Number(start.body.expires_in) || 900) * 1000;
        while (Date.now() < deadline) {
          await sleep(interval);
          const poll = await this.post(`${this.authBase}/token`, {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: this.clientId,
            device_code: start.body.device_code,
          });
          if (poll.status === 200 && poll.body.access_token) {
            this.save(poll.body);
            this.log.info('Signed in to Microsoft 365.');
            return;
          }
          const err = poll.body.error;
          if (err === 'authorization_pending') {
            continue;
          }
          if (err === 'slow_down') {
            interval += 5000;
            continue;
          }
          this.log.warn(`Microsoft sign-in did not complete: ${poll.body.error_description ?? err}`);
          break;
        }
        this.log.warn('The sign-in code expired or was declined. A new code will follow.');
        await sleep(10000);
      } catch (e) {
        this.log.warn(`Microsoft sign-in error: ${(e as Error).message}. Retrying in 1 minute.`);
        await sleep(60000);
      }
    }
  }

  private async accessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt - 60000 > Date.now()) {
      return this.tokens.accessToken;
    }
    if (!this.tokens?.refreshToken) {
      throw new SignInRequiredError('Not signed in');
    }
    const res = await this.post(`${this.authBase}/token`, {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: this.tokens.refreshToken,
      scope: this.scope,
    });
    if (res.status === 200 && res.body.access_token) {
      this.save(res.body);
      return this.tokens!.accessToken;
    }
    if (res.body.error === 'invalid_grant' || res.body.error === 'interaction_required') {
      this.clear();
      throw new SignInRequiredError(res.body.error_description ?? 'Sign-in expired');
    }
    throw new Error(`Token refresh failed: ${res.body.error ?? `HTTP ${res.status}`}`);
  }

  private async get(path: string, headers: Record<string, string> = {}): Promise<any> {
    const token = await this.accessToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}`, ...headers },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 && this.tokens) {
      this.tokens.expiresAt = 0; // force a refresh on the next call
    }
    if (!res.ok) {
      throw new Error(`Graph ${path.split('?')[0]} returned HTTP ${res.status}`);
    }
    return res.json();
  }

  async getPresence(): Promise<PresenceInfo> {
    const p = await this.get('/me/presence');
    return {
      availability: p.availability,
      activity: p.activity,
      outOfOffice: Boolean(p.outOfOfficeSettings?.isOutOfOffice),
    };
  }

  /** Events overlapping a day either side of now, so all-day events are never missed. */
  async getEvents(now: number): Promise<CalEvent[]> {
    const from = new Date(now - 86400000).toISOString();
    const to = new Date(now + 86400000).toISOString();
    const q =
      `/me/calendarView?startDateTime=${from}&endDateTime=${to}` +
      '&$select=showAs,start,end,isAllDay,isCancelled&$top=200';
    const data = await this.get(q, { Prefer: 'outlook.timezone="UTC"' });
    return (data.value ?? []).map((e: any) => parseEvent(e));
  }
}

/** All-day events are dates with no zone, so they are read in this machine's local time. */
export function parseEvent(e: any): CalEvent {
  const isAllDay = Boolean(e.isAllDay);
  const parse = (s: string) => {
    const trimmed = String(s).slice(0, 19);
    return new Date(isAllDay ? trimmed : `${trimmed}Z`).getTime();
  };
  return {
    showAs: e.showAs ?? 'unknown',
    start: parse(e.start?.dateTime),
    end: parse(e.end?.dateTime),
    isAllDay,
    isCancelled: Boolean(e.isCancelled),
  };
}
