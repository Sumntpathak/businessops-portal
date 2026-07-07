import { eq } from "drizzle-orm";
import type { BusyInterval } from "./availability.js";
import {
  decryptRefreshToken,
  schema,
  withTenant,
  type createDatabase
} from "@recepto/db";

type Database = ReturnType<typeof createDatabase>;
type Fetch = typeof fetch;

export interface DateRange {
  startsAt: Date;
  endsAt: Date;
}


export interface CreateCalendarEvent {
  title: string;
  startsAt: Date;
  endsAt: Date;
  description?: string;
}

export interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
}

export interface CalendarServiceOptions {
  db: Database;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  fetch?: Fetch;
}

export class CalendarConnectionError extends Error {}
export class CalendarConnectionRevokedError extends CalendarConnectionError {}

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export class CalendarService {
  private readonly fetch: Fetch;
  private readonly accessTokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly options: CalendarServiceOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  getAuthorizationUrl(state: string, loginHint?: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", CALENDAR_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    if (loginHint) url.searchParams.set("login_hint", loginHint);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<GoogleTokenResponse> {
    return this.tokenRequest({
      code,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      redirect_uri: this.options.redirectUri,
      grant_type: "authorization_code"
    });
  }

  async listCalendars(tenantId: string): Promise<CalendarOption[]> {
    const response = await this.googleFetch(
      tenantId,
      "/users/me/calendarList?minAccessRole=writer"
    );
    const body = (await response.json()) as {
      items?: Array<{
        id?: string;
        summary?: string;
        primary?: boolean;
        accessRole?: string;
      }>;
    };

    return (body.items ?? [])
      .filter((item): item is Required<Pick<typeof item, "id">> & typeof item =>
        Boolean(item.id)
      )
      .map((item) => ({
        id: item.id,
        summary: item.summary ?? item.id,
        primary: item.primary ?? false,
        accessRole: item.accessRole ?? "reader"
      }));
  }

  async getFreeBusy(
    tenantId: string,
    dateRange: DateRange
  ): Promise<BusyInterval[]> {
    if (dateRange.endsAt <= dateRange.startsAt) {
      throw new CalendarConnectionError("Invalid free/busy date range");
    }

    const connection = await this.getConnection(tenantId);
    const response = await this.googleFetch(tenantId, "/freeBusy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timeMin: dateRange.startsAt.toISOString(),
        timeMax: dateRange.endsAt.toISOString(),
        items: [{ id: connection.calendarId }]
      })
    });
    const body = (await response.json()) as {
      calendars?: Record<
        string,
        { busy?: Array<{ start?: string; end?: string }> }
      >;
    };

    return (body.calendars?.[connection.calendarId]?.busy ?? [])
      .filter(
        (interval): interval is { start: string; end: string } =>
          Boolean(interval.start && interval.end)
      )
      .map((interval) => ({
        startsAt: new Date(interval.start),
        endsAt: new Date(interval.end)
      }));
  }

  async createEvent(
    tenantId: string,
    event: CreateCalendarEvent
  ): Promise<string> {
    if (event.endsAt <= event.startsAt) {
      throw new CalendarConnectionError("Calendar event must have a positive duration");
    }

    const connection = await this.getConnection(tenantId);
    const path =
      "/calendars/" +
      encodeURIComponent(connection.calendarId) +
      "/events";
    const response = await this.googleFetch(tenantId, path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: event.title,
        description: event.description,
        start: { dateTime: event.startsAt.toISOString() },
        end: { dateTime: event.endsAt.toISOString() }
      })
    });
    const body = (await response.json()) as { id?: string };

    if (!body.id) {
      throw new CalendarConnectionError("Google Calendar did not return an event ID");
    }

    return body.id;
  }

  async deleteEvent(tenantId: string, eventId: string): Promise<void> {
    const connection = await this.getConnection(tenantId);
    await this.googleFetch(
      tenantId,
      "/calendars/" +
        encodeURIComponent(connection.calendarId) +
        "/events/" +
        encodeURIComponent(eventId),
      { method: "DELETE" },
      true
    );
  }

  async revokeConnection(tenantId: string): Promise<void> {
    const connection = await this.getConnection(tenantId);
    const refreshToken = decryptRefreshToken(
      connection.refreshToken,
      this.options.sessionSecret
    );

    try {
      const response = await this.fetch(
        "https://oauth2.googleapis.com/revoke?token=" +
          encodeURIComponent(refreshToken),
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" }
        }
      );
      if (!response.ok) {
        throw new CalendarConnectionError(
          "Google token revocation failed with HTTP " + response.status
        );
      }
    } finally {
      await this.markRevoked(tenantId);
    }
  }

  private async getConnection(tenantId: string) {
    const scoped = withTenant(this.options.db, tenantId);
    const [connection] = await this.options.db
      .select({
        refreshToken: schema.googleConnections.refreshToken,
        calendarId: schema.googleConnections.calendarId,
        status: schema.googleConnections.status
      })
      .from(schema.googleConnections)
      .where(scoped.where(schema.googleConnections))
      .limit(1);

    if (!connection || connection.status !== "active") {
      throw new CalendarConnectionRevokedError(
        "Google Calendar is not connected"
      );
    }

    return connection;
  }

  private async accessToken(tenantId: string): Promise<string> {
    const cached = this.accessTokens.get(tenantId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const connection = await this.getConnection(tenantId);
    const refreshToken = decryptRefreshToken(
      connection.refreshToken,
      this.options.sessionSecret
    );

    try {
      const token = await this.tokenRequest({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      });

      this.accessTokens.set(tenantId, {
        token: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1_000
      });
      return token.access_token;
    } catch (error) {
      await this.markRevoked(tenantId);
      throw new CalendarConnectionRevokedError(
        error instanceof Error ? error.message : "Google token refresh failed"
      );
    }
  }

  private async googleFetch(
    tenantId: string,
    path: string,
    init: RequestInit = {},
    allowNotFound = false,
    retry = true
  ): Promise<Response> {
    const accessToken = await this.accessToken(tenantId);
    const response = await this.fetch(
      "https://www.googleapis.com/calendar/v3" + path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          authorization: "Bearer " + accessToken
        }
      }
    );

    if (response.status === 401 && retry) {
      this.accessTokens.delete(tenantId);
      return this.googleFetch(tenantId, path, init, allowNotFound, false);
    }

    if (allowNotFound && response.status === 404) {
      return response;
    }

    if (!response.ok) {
      throw new CalendarConnectionError(
        "Google Calendar API failed with HTTP " + response.status
      );
    }

    return response;
  }

  private async tokenRequest(
    values: Record<string, string>
  ): Promise<GoogleTokenResponse> {
    const response = await this.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values)
    });

    if (!response.ok) {
      throw new CalendarConnectionError(
        "Google OAuth token request failed with HTTP " + response.status
      );
    }

    const body = (await response.json()) as Partial<GoogleTokenResponse>;
    if (!body.access_token || !body.expires_in || !body.token_type) {
      throw new CalendarConnectionError("Google OAuth returned an invalid token response");
    }
    return body as GoogleTokenResponse;
  }

  private async markRevoked(tenantId: string): Promise<void> {
    this.accessTokens.delete(tenantId);
    const scoped = withTenant(this.options.db, tenantId);
    await this.options.db
      .update(schema.googleConnections)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(scoped.where(schema.googleConnections));
  }
}
