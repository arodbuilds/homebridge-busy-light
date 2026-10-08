# homebridge-busy-light SPEC

Source of truth for behaviour, naming, configuration, log lines and UI copy. Written October 7, 2026, before build 1. Where anything else in the repository disagrees with this file, this file wins.

## 1. Overview

Busy Light reads a person's calendars and, optionally, their Microsoft Teams presence, reduces them to one status, and shows that status on a light. It does this two ways: by setting a LIFX bulb directly over the local network, and by exposing HomeKit occupancy sensors that a Home automation can use to set any other HomeKit light or scene.

It is the fourth plugin in a family (`homebridge-notify-switch`, `homebridge-peloton`, `homebridge-generac`) and shares their structure, tooling, settings page shell and release process.

Typical use: a lamp outside a home office door that is green when the person is free, red in a meeting or on a call, purple when they are out of office, and off outside working hours when Teams shows them offline.

Not affiliated with Apple, Google, Microsoft or LIFX.

## 2. Scope

### 2.1 In scope for 0.1.0 (builds 1 to 3)

1. Calendar sources: iCloud (CalDAV), Google Calendar (secret iCal address), Microsoft 365 (Outlook calendar and Teams presence through Microsoft Graph), and any calendar subscription URL.
2. Any number of sources, combined.
3. Nine statuses with a fixed precedence (section 6).
4. LIFX LAN control of one bulb, a color per status.
5. HomeKit occupancy sensors: three roll-ups and seven individual statuses (section 7).
6. An optional Do Not Disturb override switch.
7. A command line tool for checking sources, signing in to Microsoft and testing the bulb (section 10.2).
8. Build 1: the standard Homebridge settings form (`config.schema.json`). Build 2: the custom settings page on the shared shell (section 11).

### 2.2 Deferred

1. More than one light, or a different color set per light.
2. Philips Hue or other direct light integrations.
3. Google sign-in with OAuth (the secret address covers the need without a Google Cloud project).
4. Working hours (treating time outside set hours as Offline without Teams).
5. LIFX bulb discovery. The bulb is addressed by IP.
6. More than one person.

### 2.3 Never

1. Reading or storing event titles, bodies, locations or attendees beyond the in-memory checks of section 6.4.
2. Writing to any calendar.
3. Sending data anywhere except the configured calendar hosts, Microsoft's sign-in and Graph hosts, and the bulb.
4. Telemetry.

## 3. Names and versions

| Item | Value |
| --- | --- |
| npm package | `homebridge-busy-light` |
| Display name | Busy Light |
| Platform alias | `BusyLight` |
| CLI binary | `homebridge-busy-light` |
| Repository | `https://github.com/arodbuilds/homebridge-busy-light`, default branch `latest` |
| License | Apache-2.0, copyright line "Copyright 2026 Alex Rodriguez (arodbuilds) https://alex-rodriguez.com" |
| Author field | `Alex Rodriguez (https://alex-rodriguez.com)` |
| First version | `0.1.0-beta.1` |
| Engines | node `^20.18.0 \|\| ^22.10.0 \|\| ^24.0.0`, homebridge `^1.8.0 \|\| ^2.0.0-beta.0` |
| Module format | ES modules (`"type": "module"`), TypeScript, `dist/index.js` |
| Keywords | `homebridge-plugin`, `supports-hap`, `busy light`, `busylight`, `status light`, `calendar`, `icloud`, `google calendar`, `microsoft 365`, `teams`, `presence`, `lifx`, `homekit` |
| Description | "Shows your calendar and Teams status on a light: green when you are free, red when you are not. iCloud, Google Calendar, Microsoft 365 and calendar URLs, with LIFX control and HomeKit sensors." |

Storage: everything the plugin writes lives in `<Homebridge storage path>/busy-light/` (directory mode 700).

## 4. Authentication

### 4.1 iCloud

HTTP Basic with the Apple ID email and an app-specific password, both from `config.json`. The plugin never sees the Apple ID password and never handles two-factor codes. A 401 marks the source Sign-in needed (section 8.3).

### 4.2 Google Calendar and calendar URLs

No sign-in. The address is the credential. It is treated as a secret everywhere (section 12).

### 4.3 Microsoft 365: device code flow

Public client, no client secret. The tenant ID and client ID come from an app registration the user's administrator creates (`docs/microsoft-365-admin-request.md`).

1. `POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/devicecode` with `client_id` and `scope`.
2. Scope is `offline_access` plus `Presence.Read` when the source uses Teams status and `Calendars.Read` when it uses the Outlook calendar.
3. Show the `verification_uri` and `user_code` (log lines in section 12; the CLI prints the same).
4. Poll `POST .../oauth2/v2.0/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id` and `device_code` at the returned `interval`. `authorization_pending` continues, `slow_down` adds 5 seconds to the interval, anything else ends the attempt.
5. At startup, a source with no stored token starts this flow by itself. If a code expires unused, one more code is issued, up to three codes in total. After the third, the flow stops until Homebridge restarts or `homebridge-busy-light login` is run. The source is Sign-in needed throughout.

### 4.4 Microsoft 365: refresh and storage

1. The access token is cached until 120 seconds before expiry. Concurrent callers share one refresh.
2. Refresh: `grant_type=refresh_token` with `client_id`, `refresh_token` and the same `scope`. A rotated refresh token replaces the stored one.
3. `invalid_grant` or `interaction_required` deletes the stored token, marks the source Sign-in needed, and starts the flow of 4.3 item 5 once.
4. A Graph 401 clears the cached access token and the call is retried once after a refresh.
5. Tokens are stored in `busy-light/microsoft-{id}.json` (mode 600, written to a temporary file and renamed). The file holds the refresh token, access token and expiry and nothing else.
6. The plugin watches the token file's modification time before each refresh, so a sign-in completed by the CLI is picked up without a restart.

## 5. Sources

Every source implements one call: return the events that overlap the window from 24 hours before now to 24 hours after now. Each event is reduced at once to the model of section 6.1.

All HTTP uses the built-in `fetch` with a 20 second timeout.

### 5.1 iCloud (CalDAV)

1. `PROPFIND https://caldav.icloud.com/` (Depth 0) for `current-user-principal`.
2. `PROPFIND` the principal (Depth 0) for `calendar-home-set`. The home is on a `pNN-caldav.icloud.com` host; resolve relative hrefs against the URL just requested.
3. `PROPFIND` the home (Depth 1) for `displayname`, `resourcetype` and `supported-calendar-component-set`. Keep collections whose resource type contains `calendar` and that support `VEVENT` (this drops Reminders lists).
4. If the source lists calendar names, keep those (case-insensitive match); otherwise keep all. Log the names found and the names in use once per discovery.
5. For each kept calendar, `REPORT` (Depth 1) a `calendar-query` with a `time-range` on `VEVENT` for the window, asking for `calendar-data`.
6. Each `calendar-data` value is parsed as in 5.4.
7. Discovery (steps 1 to 4) is cached and repeated after any failure and every 24 hours.

XML is read with small helpers that ignore namespace prefixes and decode entities and CDATA. No XML dependency.

### 5.2 Google Calendar and calendar URLs

1. The address must be `https://` or `webcal://` (rewritten to `https://`). `http://` is a validation error. Redirects are followed only to `https://`.
2. `GET` the address, sending `If-None-Match` when the last response carried an `ETag`. A 304 keeps the last parsed events and counts as a successful check.
3. A body over 10 MB is refused.
4. The body is parsed as in 5.4.
5. A Google source differs from a URL source in two ways only: its optional `email` is used for the declined-invitation rule (6.4), and the settings page shows different help.

### 5.3 Microsoft 365 (Graph)

1. Presence, when the source uses Teams status: `GET https://graph.microsoft.com/v1.0/me/presence`. Read `availability`, `activity` and `outOfOfficeSettings.isOutOfOffice` (treat a missing `outOfOfficeSettings` as false).
2. Calendar, when the source uses the Outlook calendar: `GET /v1.0/me/calendarView?startDateTime={from}&endDateTime={to}&$select=showAs,start,end,isAllDay,isCancelled&$top=200` with the header `Prefer: outlook.timezone="UTC"`. Follow `@odata.nextLink` up to five pages.
3. Timed events: `start.dateTime` and `end.dateTime` are UTC without a zone suffix. All-day events are dates and are read in the Homebridge host's local time zone.
4. A 429 or 503 honours `Retry-After`.
5. No other Graph field is requested.

### 5.4 Reading iCalendar data

Parsing and recurrence use `ical.js`.

1. Register each `VTIMEZONE` in the data with the time zone service before reading events.
2. Group `VEVENT` components by UID into a series master and its changed occurrences (`RECURRENCE-ID`). Pass each master its own exceptions explicitly with `new ICAL.Event(master, { exceptions })`. Left alone, ical.js attaches every changed occurrence in the file to every series.
3. Expand a recurring series through the window, stopping at the first occurrence that starts after the window, with a cap of 20,000 iterations per series.
4. A changed occurrence whose master is absent is read as a single event.
5. An event that cannot be read is skipped. A calendar is never dropped because of one bad event.
6. A date-only start makes the event all-day, in the host's local time zone.

## 6. Status model

### 6.1 Event model

Each event becomes `{ showAs, start, end, isAllDay, isCancelled, source }` where `showAs` is one of `free`, `tentative`, `busy`, `oof`, and times are epoch milliseconds. Nothing else about the event is kept.

### 6.2 Statuses

| Key | Display name | Default color |
| --- | --- | --- |
| `outOfOffice` | Out of office | `#B400FF` |
| `doNotDisturb` | Do not disturb | `#FF0000` |
| `inCall` | In a call | `#FF0000` |
| `inMeeting` | In a meeting | `#FF0000` |
| `busy` | Busy | `#FF6A00` |
| `tentative` | Tentative | `#FFD000` |
| `away` | Away | `#FFD000` |
| `available` | Available | `#00FF00` |
| `offline` | Offline | `off` |

`unknown` is an internal tenth state (6.5). It has no color and no sensor.

### 6.3 Precedence

An event is active when it is not cancelled and `start <= now < end`. The first rule that matches wins:

1. The override switch is on: `doNotDisturb`.
2. Presence says out of office (`outOfOfficeSettings.isOutOfOffice`, or activity `OutOfOffice`), or an active event is `oof`: `outOfOffice`.
3. Presence availability `DoNotDisturb`, or activity `Presenting`, `Focusing` or `DoNotDisturb`: `doNotDisturb`.
4. Presence activity `InACall` or `InAConferenceCall`: `inCall`.
5. Presence activity `InAMeeting`, or an active event is `busy`: `inMeeting`.
6. Presence availability `Busy` or `BusyIdle`: `busy`.
7. An active event is `tentative`: `tentative`.
8. Presence availability `Away` or `BeRightBack`: `away`.
9. Presence availability `Available` or `AvailableIdle`: `available`.
10. There is no presence source: `available`.
11. Otherwise (presence `Offline`, `PresenceUnknown` or anything unrecognised): `offline`.

With `ignoreAllDayBusy` on (the default), an all-day event that is `busy` or `tentative` is ignored in rules 5 and 7. An all-day `oof` event always counts.

The result carries a reason for the state file and the settings page: the name of the source that decided it (or "Teams"), and `until`, the time the status is next expected to change according to the cached events (the end of the deciding event, or the start of the next counting event when available).

### 6.4 Classifying iCalendar events

iCalendar has no out of office value, so `showAs` is derived, first match wins:

1. `STATUS:CANCELLED` sets `isCancelled`.
2. An `ATTENDEE` whose address matches one of the owner's addresses (the iCloud Apple ID, the Google source's `email`) with `PARTSTAT=DECLINED`: `free`.
3. `X-MICROSOFT-CDO-BUSYSTATUS:OOF`, or the title contains one of the out of office words as a whole word, case-insensitive: `oof`. This applies even when the event is marked free.
4. `TRANSP:TRANSPARENT`, or `X-MICROSOFT-CDO-BUSYSTATUS:FREE`: `free`.
5. `STATUS:TENTATIVE`, or `X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE`: `tentative`.
6. Otherwise `busy`.

The title is read for rule 3 only and is discarded with the parsed component.

### 6.5 Freshness and Unknown

1. A source's events are fresh for 15 minutes after its last successful check. After that they are dropped until the next success, so a meeting never sticks because a calendar became unreachable.
2. Presence is fresh for 5 minutes.
3. Status is resolved from fresh data only. A source that is failing while others are fresh simply contributes nothing.
4. When at least one source is configured and none has fresh data and there is no fresh presence, the status is `unknown`: every sensor is off, the bulb is left as it is, and the Unknown log line is written once.
5. With no sources configured at all, the status is `unknown` and the plugin logs the "no calendars" line once at startup.

## 7. HomeKit model

One accessory per sensor, so each can be placed in a room and used in automations by itself. All are occupancy sensors: Occupancy Detected while their condition holds.

| Key | Accessory name | On while status is |
| --- | --- | --- |
| `available` | `{name} Available` | `available` |
| `busyAny` | `{name} Busy` | `inMeeting`, `inCall`, `doNotDisturb` or `busy` |
| `outOfOffice` | `{name} Out of Office` | `outOfOffice` |
| `inMeeting` | `{name} In a Meeting` | `inMeeting` |
| `inCall` | `{name} In a Call` | `inCall` |
| `doNotDisturb` | `{name} Do Not Disturb` | `doNotDisturb` |
| `busy` | `{name} Busy in Teams` | `busy` |
| `tentative` | `{name} Tentative` | `tentative` |
| `away` | `{name} Away` | `away` |
| `offline` | `{name} Offline` | `offline` |

1. `{name}` is the platform `name` (default "Busy Light").
2. The first three are the roll-ups and are the default set. `tentative`, `away` and `offline` turn no roll-up on.
3. UUIDs come from `busy-light:sensor:{key}` and never from the display name, so renaming keeps rooms and automations.
4. Accessory Information: Manufacturer "Busy Light", Model "Status sensor", Serial Number the key, Firmware Revision the package version.
5. The override switch, when enabled, is a Switch accessory named `{name} Override`, UUID from `busy-light:override`. Its state is kept in the accessory context and survives restarts. Turning it on or off re-resolves the status at once.
6. Accessories no longer wanted by the configuration are unregistered at startup.
7. On Homebridge 2, set `ConfiguredName` where the service supports it so the Home app shows the same names.

## 8. Polling, timing and backoff

### 8.1 Loop

1. A tick runs every `pollSeconds` (default 30, minimum 15). A tick never overlaps the previous one.
2. Each tick: read presence if a source uses it; reload any calendar source whose last check is older than `calendarSeconds` (default 180, minimum 60); resolve; apply.
3. After each resolve, a single timer is set for the next start or end of a cached counting event, if that is sooner than the next tick. When it fires, the status is resolved again from the cache with no network call. This makes the light change at the minute a meeting starts or ends.
4. The first tick runs as soon as Homebridge finishes launching.

### 8.2 Applying a status

1. On a change: log the status line, update every sensor, write the state file, and send the bulb its color.
2. With no change, the bulb is sent its color again every `lifx.refreshSeconds` (default 300, 0 turns this off), so a bulb that was switched off at the wall recovers.
3. `unknown` sends nothing to the bulb.

### 8.3 Source status and backoff

Each source is in one of four states, shown in the state file and, from build 2, on the settings page: `checking` (no result yet), `connected`, `signInNeeded` (iCloud 401, Microsoft with no valid token), `notReachable` (anything else).

1. After a failure the source is retried after 1, 2, 5 and then 15 minutes, staying at 15. A success resets the schedule.
2. `signInNeeded` for iCloud is retried hourly only, so a wrong app-specific password cannot lock the Apple ID.
3. A failure is logged once at warning level when a source first fails and once at info level when it recovers. Repeats are debug.

## 9. Configuration (config.json)

```json
{
  "platform": "BusyLight",
  "name": "Busy Light",
  "calendars": [
    { "type": "icloud", "name": "Family", "appleId": "", "appPassword": "", "calendars": [] },
    { "type": "google", "name": "Personal", "url": "", "email": "" },
    { "type": "microsoft", "name": "Work", "tenantId": "", "clientId": "", "useTeamsStatus": true, "useCalendar": true },
    { "type": "url", "name": "Team rota", "url": "" }
  ],
  "colors": { "available": "#00FF00", "offline": "off" },
  "lifx": { "enabled": false, "host": "", "brightness": 100, "refreshSeconds": 300 },
  "sensors": ["available", "busyAny", "outOfOffice"],
  "overrideSwitch": false,
  "pollSeconds": 30,
  "calendarSeconds": 180,
  "ignoreAllDayBusy": true,
  "outOfOfficeWords": ["Out of office", "OOO", "Vacation", "PTO"],
  "debug": false
}
```

### 9.1 Rules

1. Every field except `platform` is optional. A missing field takes its default. An empty `calendars` list is valid (the plugin starts and logs the "no calendars" line).
2. `calendars[].name` is required, 1 to 64 printable characters, unique without regard to case. `calendars[].id` is optional; when absent it is the name lowercased with every run of characters outside `a-z0-9` replaced by a hyphen. The id names the Microsoft token file, so the settings page (build 2) writes it explicitly and never changes it on rename.
3. `type` is one of `icloud`, `google`, `microsoft`, `url`. Required fields: iCloud `appleId` and `appPassword`; Google and URL `url`; Microsoft `tenantId` and `clientId` (both GUIDs).
4. At most one Microsoft source may have `useTeamsStatus` on. A Microsoft source with both `useTeamsStatus` and `useCalendar` off is an error.
5. `colors` values are `#RRGGBB` or `off`, any case. Unknown status keys are ignored with a warning.
6. `lifx.host` is an IPv4 address or host name; required when `lifx.enabled` is on. `brightness` is 1 to 100.
7. `sensors` holds keys from section 7. Unknown keys are ignored with a warning. An empty list creates no sensors.
8. Validation never stops Homebridge. An invalid source is skipped with one error line naming the field (for example `calendars[1].url: must start with https:// or webcal://`); an invalid scalar falls back to its default with one warning.

### 9.2 Standard settings form (build 1)

`config.schema.json` describes the whole block for the Homebridge UI's standard form (`pluginAlias` `BusyLight`, `pluginType` `platform`, `singular` true). The calendar list is an array whose type-specific fields use the form's `condition` support so only the fields for the chosen type show. Secret fields are plain text fields in this form (the standard form has no reliable password control for array items); build 2 replaces the form.

Titles and descriptions, verbatim:

| Field | Title | Description |
| --- | --- | --- |
| `name` | Name | Starts the name of every sensor, for example "Busy Light Available". |
| `calendars` | Calendars | Add every calendar that should count. Events from all of them are combined. |
| `calendars[].type` | Type | (enum titles: iCloud, Google Calendar, Microsoft 365, Calendar URL) |
| `calendars[].name` | Name | A name for this calendar. It appears in the log. |
| `appleId` | Apple ID email | |
| `appPassword` | App-specific password | Create one at account.apple.com under Sign-In and Security. This is not your Apple ID password. |
| `calendars[].calendars` | Calendars to include | Leave empty to use every calendar. The log lists the calendar names found. |
| `url` (Google) | Secret address in iCal format | In Google Calendar settings, pick the calendar, then Integrate calendar. Treat it like a password. |
| `email` | Your Google email | Optional. Lets Busy Light ignore invitations you declined. |
| `url` (URL) | Address | Any calendar link that starts with https:// or webcal://. |
| `tenantId` | Directory (tenant) ID | From your Microsoft 365 administrator. |
| `clientId` | Application (client) ID | From your Microsoft 365 administrator. |
| `useTeamsStatus` | Use Teams status | |
| `useCalendar` | Use Outlook calendar | |
| `colors.*` | (the display name of the status) | (on the group) A color such as #FF0000, or the word off to turn the light off for that status. |
| `lifx.enabled` | Set a LIFX bulb directly | |
| `lifx.host` | Bulb IP address | Reserve this address for the bulb in your router so it does not change. |
| `lifx.brightness` | Brightness (percent) | |
| `lifx.refreshSeconds` | Send the color again every (seconds) | Recovers a bulb that was switched off at the wall. 0 sends only when the status changes. |
| `sensors` | Sensors to create | Each is an occupancy sensor in the Home app that is on while that is your status. Use them in automations to set any other light. |
| `overrideSwitch` | Override switch | Adds a switch to the Home app that forces Do not disturb while it is on. |
| `pollSeconds` | Check status every (seconds) | |
| `calendarSeconds` | Reload calendars every (seconds) | |
| `ignoreAllDayBusy` | Ignore all-day events marked busy | All-day out of office events always count. |
| `outOfOfficeWords` | Out of office words | iCloud, Google and URL calendar events with one of these words in the title count as out of office. |
| `debug` | Debug logging | |

`headerDisplay`: "Busy Light shows whether you are free on a light. Add at least one calendar, then choose how the light is controlled. Not affiliated with or endorsed by Apple, Google, Microsoft or LIFX."

## 10. State file, CLI and UI server

### 10.1 State file

`busy-light/state.json`, written atomically (temporary file, then rename) on every status change, every source state change, and at least once a minute.

```json
{
  "version": 1,
  "updatedAt": "2026-10-08T13:00:05.000Z",
  "status": "inMeeting",
  "reason": { "source": "Work", "until": "2026-10-08T13:30:00.000Z" },
  "override": false,
  "sources": [
    { "id": "work", "name": "Work", "type": "microsoft", "state": "connected", "lastChecked": "2026-10-08T13:00:05.000Z", "events": 6, "error": null }
  ],
  "signIn": null,
  "light": { "enabled": true, "lastSent": "#FF0000", "lastSentAt": "2026-10-08T13:00:05.000Z", "answered": true }
}
```

1. `events` is a count. `error` is a short message that never contains a secret or a calendar address.
2. `signIn` is null, or `{ "id", "verificationUri", "userCode", "expiresAt" }` while a Microsoft code is waiting.
3. The file never holds tokens, passwords, addresses or anything about an event beyond the count and the `until` time.

### 10.2 CLI

`homebridge-busy-light <command> [-U <storage path>]`. The storage path defaults to `/var/lib/homebridge` when that exists, otherwise `~/.homebridge`. The CLI reads the platform block from `config.json` there. Exit code 0 on success, 1 on failure.

| Command | Does |
| --- | --- |
| `status` | Prints the state file in plain words: the status, the reason, and one line per source. |
| `check` | Without touching HomeKit or the bulb, fetches every source once and prints, per source, its state, the number of events in the window and the events active now as times and `showAs` only. Then prints the resolved status. |
| `login [name]` | Runs the device code flow for the named Microsoft source (or the only one) and stores the token. |
| `light <ip> [#RRGGBB\|off]` | Sends the color (default the Available color) to the bulb and prints whether it answered. |
| `help` | Lists the commands. |

The CLI follows the same logging rules as the plugin (section 12).

### 10.3 UI server (build 2)

`homebridge-ui/server.js` with `@homebridge/plugin-ui-utils`. Endpoints: `/version`, `/status` (the state file), `/test-calendar` (one fetch of an unsaved source, returning state, calendar names for iCloud, and an event count), `/microsoft/start` and `/microsoft/poll` (the device code flow for the settings page), `/test-light`, `/reset`. Detailed in the build 2 revision of this section.

## 11. Settings page (build 2)

Not part of build 1. The page is built on the shared shell from the Claude Design prototype, which is pending. Until it lands, `design/BRIEF.md` Part 3 records the intended anatomy and the decided copy.

### 11.1 Anatomy, top to bottom

1. Banner (`assets/busy-light-banner.png`).
2. Intro, then the affiliation line.
3. Right now: a read-only status row from the state file.
4. Calendars: one card per source, an Add calendar chooser with four tiles.
5. Colors: one row per status in precedence order.
6. Lights: the LIFX card, then the sensors checklist and the automation example.
7. Settings: a single collapsed Advanced disclosure.
8. Closing line, credit footer.

### 11.2 Shell invariants

Inherit `homebridge-notify-switch` `design/HANDOFF.md` and `design/BUILD-CONTRACT.md` in full, with the additions recorded in `homebridge-generac` SPEC 11.2: no palette of its own, host variables for every color, the iframe never scrolls, nothing fixed or sticky, inline confirmations, validation on blur with "{Label} is required.", no `crypto.randomUUID`. The one place user data carries color is the status swatches.

### 11.3 Copy (verbatim)

To be filled from the prototype in build 2. The strings in `design/BRIEF.md` Part 3 marked decided carry over unchanged.

## 12. Logging

Never logged at any level: passwords, app-specific passwords, tokens, device codes, calendar addresses (host name only), and anything about an event except counts and times.

Lines, verbatim (`{}` are values):

| When | Level | Line |
| --- | --- | --- |
| Startup | info | `Busy Light {version}: {n} calendars, light {on at host\|off}, {m} sensors.` |
| No sources | warn | `No calendars are set up yet. Open the plugin settings to add one.` |
| Status change | info | `Status: {Display name} ({source}, until {h:mm AM/PM}).` The parenthesis is omitted when there is no reason, and `until` when there is no time. |
| Unknown | warn | `Status unknown: none of your calendars could be read.` |
| iCloud discovery | info | `{name}: calendars found: {a, b, c}. In use: {a, b}.` |
| Source failed | warn | `{name}: could not be read ({short reason}). Trying again in {n} minutes.` |
| Source recovered | info | `{name}: working again.` |
| iCloud 401 | warn | `{name}: iCloud did not accept the Apple ID and app-specific password. Check them in the plugin settings.` |
| Microsoft code | warn | `{name}: Microsoft sign-in needed. Open {verificationUri} and enter the code {userCode}.` |
| Microsoft done | info | `{name}: signed in to Microsoft 365.` |
| Microsoft gave up | warn | `{name}: the sign-in code was not used. Restart Homebridge or run "homebridge-busy-light login" to try again.` |
| Bulb silent | warn | `The LIFX bulb at {host} did not answer.` (once, then debug until it answers) |
| Bulb back | info | `The LIFX bulb at {host} is answering again.` |
| Validation | error or warn | `{path}: {message}` |

Times in log lines use the host's locale and time zone, 12-hour.

## 13. LIFX

LIFX LAN protocol over UDP port 56700, sent to the configured address. No LIFX account, no cloud.

1. Header, 36 bytes, little endian: size (uint16), then `0x3400` (protocol 1024, addressable, tagged), source (uint32, a fixed non-zero value), target (8 bytes of zero), 6 reserved bytes, flags (byte 22; bit 1 `ack_required`), sequence (byte 23), 8 reserved bytes, message type (uint16 at 32), 2 reserved bytes.
2. SetColor, type 102, 49 bytes: one reserved byte at 36, then hue, saturation, brightness and kelvin (uint16 each, from 37) and duration in milliseconds (uint32 at 45). Hue, saturation and brightness are the color's HSB scaled to 0 to 65535; brightness is further scaled by `lifx.brightness`. Kelvin is 3500.
3. SetPower, type 117, 42 bytes: level (uint16 at 36, 0 or 65535) and duration (uint32 at 38).
4. A color is sent as SetColor then SetPower on. `off` is SetPower off. Duration is 1000 ms on a status change and 0 on a refresh.
5. Each packet sets `ack_required` and waits up to 500 ms for an Acknowledgement (type 45) with the same sequence, trying three times. The bulb "answered" when the last packet of the send was acknowledged.
6. One socket is opened per send and closed afterwards.

## 14. Assets and branding

`assets/` holds the Claude Design export (direction 2C "Lit day", recorded in `assets/ICONS.md`): `busy-light-512.png`, `busy-light-192.png`, `busy-light-mark.svg`, `busy-light-dark.svg`, `busy-light-light.svg`, `busy-light-footer.svg`, `busy-light-banner.png` (1280 by 320) and `busy-light-social.png` (1280 by 640). Field `#36434F`, mark `#F2F2F3`, square `#3FBF6F`.

Banner text: "Busy Light for Homebridge" and "Your calendar and Teams status on a light. Green when you are free, red when you are not."

The README opens with the banner. Assets are referenced from the repository and are not shipped in the npm package, except what the settings page needs from build 2.

## 15. Testing

All tests use `node:test`, run from `build-test/`, and never open a socket.

1. Status: every rule of 6.3 in order, the all-day rule, cancelled events, boundaries (`start` inclusive, `end` exclusive), the override, freshness and Unknown, and the reason and `until` values.
2. iCalendar: a fixture with a time zone, a weekly series, a second weekly series with one moved occurrence (the two series must not share the exception), a free event, an all-day out of office match, a declined invitation, a cancelled event, an event outside the window, a `STATUS:TENTATIVE` event, a bad event that is skipped, and daylight saving on both sides of a change.
3. CalDAV: discovery and REPORT against recorded-shape fixtures with two different namespace prefix styles, a Reminders list that is dropped, a name filter, a 401, and rediscovery after a failure.
4. URL source: `webcal://` rewrite, `http://` refused, ETag and 304, oversize body, redirect to `http://` refused.
5. Graph: device code success, `authorization_pending`, `slow_down`, expiry and the three-code limit; refresh with rotation; `invalid_grant`; one shared refresh for concurrent calls; 401 retry; presence mapping; calendar paging; all-day parsing; `Retry-After`.
6. LIFX: packet bytes for SetColor and SetPower, hex to HSB, brightness scaling, acknowledgement matching by sequence, three tries then "did not answer", with a fake socket.
7. Platform: sensor set from configuration, stable UUIDs, removal of unwanted accessories, roll-up mapping, backoff schedule, the boundary timer, bulb refresh, and that Unknown leaves the bulb alone.
8. Config: every rule of 9.1, including the derived id and the fall-back-with-warning behaviour.
9. Redaction: a failing URL source's log line and state file error contain the host and never the path or query; no log line in any test contains an event title from the fixtures.
10. CLI: `check` and `status` against a temporary storage directory with `fetch` replaced.

## 16. Release plan

1. Build 1 (overnight, October 7 to 8, 2026): everything in sections 3 to 10.2 and 12 to 15, the standard settings form, README, CHANGELOG, SECURITY.md, NOTICE, version `0.1.0-beta.1`, one pull request against `latest`. `reference/` is deleted in the last commit.
2. Morning test on the Pi: merge, then clone and build under the Homebridge storage directory and link it (as Generac build 1), or publish the pre-release. `homebridge-busy-light check` first, then the Home app sensors, then the bulb.
3. Build 2: the settings page from the Design prototype, the UI server, `customUi`, sign-in from the page.
4. Build 3: README with masked screenshots, first npm publish as `v0.1.0-beta.1` pre-release (one-time token, then trusted publishing), reinstall from npm through the Homebridge UI.
5. Soak, r/homebridge tester post, `1.0.0`, then the Homebridge verification request.

## 17. Decisions and open items

- 2026-10-07: Name `homebridge-busy-light`, display name Busy Light. The one-word "busylight" is avoided as a package name because it is a commercial product's name; it is kept as a keyword.
- 2026-10-07: Google Calendar by secret iCal address, not OAuth. Google's device code flow does not allow calendar scopes.
- 2026-10-07: `ical.js` allowed as a runtime dependency for recurrence.
- 2026-10-07: Other HomeKit lights are reached through sensors and Home automations. A Homebridge plugin cannot command another HomeKit accessory.
- 2026-10-07: Available and Out of office exist only as roll-up sensors, since an individual sensor would be identical.
- 2026-10-07: Icon direction 2C "Lit day" on slate `#36434F`.
- Open: confirm on a real bulb that it acknowledges a tagged packet sent to its own address with a zero target. If it does not, send untagged with the bulb's MAC learned from a GetService reply.
- Open: confirm `outOfOfficeSettings` is present on `/me/presence` in the user's tenant.
- Open: Google can take hours to reflect a change in the secret address feed. Measure it and say so in the README.
- Open: iCloud calendars shared from another person, and subscribed calendars inside iCloud, have not been checked against discovery.
- Open: the settings page prototype from Design (section 11).
