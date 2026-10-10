# homebridge-busy-light SPEC

Source of truth for behaviour, naming, configuration, log lines and UI copy. Written October 7, 2026, before build 1, and updated October 8, 2026, with what builds 1 and 2 settled (section 17) the build 3 additions (section 18 and the changes it brings to the other sections), build 3.1's changes from the pass on the Pi, and, on October 9, 2026, build 3.2: the fixes from a code review and a test pass, the Working switch and the meeting warning. Where anything else in the repository disagrees with this file, this file wins.

## 1. Overview

Busy Light reads a person's calendars and, optionally, their Microsoft Teams presence, reduces them to one status, and shows that status on a light. It does this two ways: by setting one or more LIFX bulbs directly over the local network, and by exposing HomeKit occupancy sensors that a Home automation can use to set any other HomeKit light or scene.

It is the fourth plugin in a family (`homebridge-notify-switch`, `homebridge-peloton`, `homebridge-generac`) and shares their structure, tooling, settings page shell and release process.

Typical use: a lamp outside a home office door that is green when the person is free, red in a meeting or on a call, purple when they are out of office, and off outside working hours when Teams shows them offline.

Not affiliated with Apple, Google, Microsoft or LIFX.

## 2. Scope

### 2.1 In scope for 0.1.0 (builds 1 to 3)

1. Calendar sources: iCloud (CalDAV), Google Calendar (secret iCal address), Microsoft 365 (Outlook calendar and Teams presence through Microsoft Graph), and any calendar subscription URL.
2. Any number of sources, combined.
3. Nine statuses with a fixed precedence (section 6).
4. LIFX LAN control of a bulb, a color per status, and from build 3.2 of several bulbs that show the status together (13.3). Bulbs are found on the network automatically (section 13.2); an IP address is optional.
5. HomeKit occupancy sensors: three roll-ups and seven individual statuses (section 7).
6. An optional Do Not Disturb override switch.
7. A command line tool for checking sources, signing in to Microsoft and testing the bulb (section 10.2).
8. Build 1: the standard Homebridge settings form (`config.schema.json`). Build 2: the custom settings page on the shared shell (section 11), with calendars picked from a list after Connect, a per-calendar "Counts for" choice, Microsoft sign-in from the page, and the LIFX bulb found and tested from the page.
9. A status input that lets any app on the local network report a status (section 18), and an On a Call switch in the Home app.
10. From build 3.2: a Working switch in the Home app that keeps the light off while it is off (6.6), and a warning before a calendar meeting, the light fading from the Available color to the In a meeting color (6.7).

### 2.2 Deferred

1. A different color set per light. (More than one LIFX bulb, all showing the same colors, came in build 3.2: 13.3.)
2. Philips Hue or other direct light integrations.
3. Google sign-in with OAuth (the secret address covers the need without a Google Cloud project).
4. Working hours (treating time outside set hours as Offline without Teams). From build 3.2 the Working switch (6.6) covers the need without built-in hours: a Home scene or automation turns it off and on.
5. More than one person.
6. A built-in Microsoft app registration, so that no IDs are needed. A multi-tenant app from an unverified publisher cannot be consented to by ordinary users in other tenants, so it would not remove the administrator step. Revisit with publisher verification.

### 2.3 Never

1. Reading or storing event titles, bodies, locations or attendees beyond the in-memory checks of section 6.4.
2. Writing to any calendar.
3. Sending data anywhere except the configured calendar hosts, Microsoft's sign-in and Graph hosts, the bulb, and the answers the status input gives to senders on the local network (section 18).
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
6. A device code request that fails for network reasons (or with HTTP 5xx and no OAuth error) is tried again in the background after 1, 2, 5 and then 15 minutes, and does not count as a code; the CLI reports it and exits 1. A token poll that fails for network reasons is tried again at the next interval.
7. While a code is waiting, the flow also watches the token file; a sign-in completed by the CLI ends it, whether the flow or another caller notices it first.
8. If the token file cannot be written (a full or read-only disk), the sign-in is kept in memory for as long as Homebridge runs, with a debug line.

### 4.3.1 When Microsoft sign-in is refused

The Microsoft 365 source is fully built in build 1: with a tenant ID and client ID from a working app registration, signing in with the code is all that is needed. When Microsoft refuses instead, the cause is nearly always the app registration or a tenant policy, which only the user's administrator can change. The plugin recognises these by the `AADSTS` code at the start of `error_description` (or in `error_codes`), from either the device code request or the token poll, and says what to do in plain words.

| Codes | Meaning | Reason shown |
| --- | --- | --- |
| `AADSTS700016`, `AADSTS90002`, `AADSTS900023` | The client ID or tenant ID is not known | `the Directory (tenant) ID or Application (client) ID was not recognised` |
| `AADSTS7000218`, `AADSTS70002` | Public client flows are not allowed on the app | `the app registration does not allow public client flows` |
| `AADSTS65001`, `AADSTS90094`, `AADSTS90099`, `AADSTS650051`, `AADSTS650057` | Consent is missing or needs an administrator | `your organization has not approved the permissions` |
| `AADSTS53003`, `AADSTS530033`, `AADSTS50105`, `AADSTS50158` | Blocked by Conditional Access or assignment | `your organization's sign-in policy blocked it` |
| `AADSTS50020`, `AADSTS50059` | Wrong kind of account or tenant | `that account does not belong to this organization` |
| anything else | | `Microsoft answered {AADSTS code or error}` |

1. Each of these ends the attempt at once (no further codes are issued) and marks the source Sign-in needed with that reason in the state file. "Anything else" covers every OAuth error from either request other than `authorization_pending`, `slow_down` and `expired_token` (for example `authorization_declined`).
2. The "Microsoft refused" log line of section 12 is written once. It carries the reason and the address of the instructions to give an administrator: `https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/microsoft-365-admin-request.md`. The CLI `login` command prints the same two lines.
3. A Graph 403 on `/me/presence` or `/me/calendarView` after a successful sign-in is treated the same way with the reason `your organization has not approved the permissions`, since it means the token lacks the scope. The token is kept, the source is retried on the normal schedule, and the refusal clears once each read that answered 403 answers normally (a working calendar does not clear a refused presence).
4. `docs/microsoft-365-admin-request.md` is written to be copied and pasted to an administrator as is: what the tool does, the exact registration steps, the two IDs to send back, and notes for a security review. The README links to it from the Microsoft 365 setup section and from Troubleshooting. From build 2 the settings page links to it as "What do I ask for?".

### 4.4 Microsoft 365: refresh and storage

1. The access token is cached until 120 seconds before expiry. Concurrent callers share one refresh.
2. Refresh: `grant_type=refresh_token` with `client_id`, `refresh_token` and the same `scope`. A rotated refresh token replaces the stored one.
3. `invalid_grant` or `interaction_required` deletes the stored token, clears any earlier refusal, marks the source Sign-in needed, and starts the flow of 4.3 item 5 once (never from the CLI `check`). HTTP 5xx, an answer that is not JSON, or `temporarily_unavailable` is Not reachable and keeps the token. Any other OAuth error is a refusal with the reason of 4.3.1 and keeps the token.
4. A Graph 401 clears the cached access token and the call is retried once after a refresh. A second 401 is Sign-in needed (`graph.microsoft.com did not accept the sign-in`).
5. Tokens are stored in `busy-light/microsoft-{id}.json` (mode 600, written to a temporary file and renamed). The file holds the refresh token, access token and expiry and nothing else: `{ "refreshToken", "accessToken", "expiresAt" }`, with `expiresAt` an ISO time.
6. The plugin watches the token file's modification time and inode before each refresh, and on every token use (every write renames a new file into place, so a new inode shows a new file even when two writes share one coarse modification time), so a sign-in completed by the CLI is picked up within one tick without a restart. Picking up a token this way writes the "Microsoft done" line.

## 5. Sources

Every source implements one call: return the events that overlap the window from 24 hours before now to 24 hours after now. Each event is reduced at once to the model of section 6.1.

All HTTP uses the built-in `fetch` with a 20 second timeout.

### 5.1 iCloud (CalDAV)

1. `PROPFIND https://caldav.icloud.com/` (Depth 0) for `current-user-principal`.
2. `PROPFIND` the principal (Depth 0) for `calendar-home-set`. The home is on a `pNN-caldav.icloud.com` host; resolve relative hrefs against the URL just requested.
3. `PROPFIND` the home (Depth 1) for `displayname`, `resourcetype` and `supported-calendar-component-set`. Keep collections whose resource type contains `calendar` and that support `VEVENT` (this drops Reminders lists). Collections whose resource type contains `subscribed` are listed for the settings page (10.3 item 1) but never read.
4. Choose the calendars by the source's `calendars` list (9.1 item 13): with no list, or an empty one, keep all; otherwise keep each calendar whose path matches an entry's `id`, or, for an entry without an `id` or whose `id` matches nothing, every calendar whose name matches the entry's name without regard to case (as build 1 did). Entries are matched by `id` first, so a name never takes a calendar another entry names by its `id`. Each kept calendar carries its entry's `use`. Calendars found but not kept are reported once per discovery in the "New calendars" log line when the list is not empty, leaving out subscribed calendars, which cannot be ticked. An entry that matches no calendar found is reported with the "Listed calendar gone" line of section 12, once until it is found again. Log the names found and the names in use once per discovery. A calendar without a display name is called `Unnamed calendar`, never by its path (the path holds the account number).
5. For each kept calendar, `REPORT` (Depth 1) a `calendar-query` with a `time-range` on `VEVENT` for the window, asking for `calendar-data`.
6. Each `calendar-data` value is parsed as in 5.4.
7. Discovery (steps 1 to 4) is cached and repeated after any failure and every 24 hours.

XML is read with small helpers that ignore namespace prefixes and decode entities and CDATA. No XML dependency.

### 5.2 Google Calendar and calendar URLs

1. The address must be `https://` or `webcal://` (rewritten to `https://`). `http://` is a validation error. Redirects are followed only to `https://`.
2. `GET` the address, sending `If-None-Match` when the last response carried an `ETag`. A 304 keeps the last parsed events and counts as a successful check. `If-None-Match` is sent only while those events were parsed less than 6 hours ago, so recurring events keep up with the moving window without keeping the body in memory. At most 5 redirects are followed.
3. A body over 10 MB is refused, whether or not `Content-Length` says so. A body without `BEGIN:VCALENDAR` is refused as not a calendar.
4. The body is parsed as in 5.4.
5. A Google source differs from a URL source in two ways only: its optional `email` is used for the declined-invitation rule (6.4), and the settings page shows different help.
6. The source's `use` (9.1 item 15) applies to all its events.

### 5.3 Microsoft 365 (Graph)

1. Presence, when the source uses Teams status: `GET https://graph.microsoft.com/v1.0/me/presence`. Read `availability`, `activity` and `outOfOfficeSettings.isOutOfOffice` (treat a missing `outOfOfficeSettings` as false).
2. Calendar, when the source uses the Outlook calendar: with no `calendars` list, or an empty one, the default calendar, `GET /v1.0/me/calendarView?startDateTime={from}&endDateTime={to}&$select=showAs,start,end,isAllDay,isCancelled&$top=200` with the header `Prefer: outlook.timezone="UTC"`; with a list, the same request on `/v1.0/me/calendars/{id}/calendarView` for each entry, carrying the entry's `use`. Follow `@odata.nextLink` up to five pages per calendar. A listed calendar that answers 404 (deleted, or no longer shared) is left out with one warning and the others are read.
3. Timed events: `start.dateTime` and `end.dateTime` are UTC without a zone suffix. All-day events are dates and are read in the Homebridge host's local time zone.
4. A 429 or 503 honours `Retry-After`: the source is not tried again before that time, even when the retry schedule of 8.3 would come sooner.
5. No other Graph field is requested. `/me/presence` takes no `$select`; only the three fields of item 1 are read. An `@odata.nextLink` is followed only when it is on `https://graph.microsoft.com/`.
6. `showAs` maps to the event model as is, except `workingElsewhere`, which is `free` (as `WORKINGELSEWHERE` is in iCalendar data from build 3.2, 6.4 rule 4), and anything unrecognised, which is `busy`.

### 5.4 Reading iCalendar data

Parsing and recurrence use `ical.js`.

1. Register each `VTIMEZONE` in the data with the time zone service before reading events.
2. Group `VEVENT` components by UID into a series master and its changed occurrences (`RECURRENCE-ID`). Pass each master its own exceptions explicitly with `new ICAL.Event(master, { exceptions })`. Left alone, ical.js attaches every changed occurrence in the file to every series. From build 3.2 each changed occurrence is read on its own, by its `RECURRENCE-ID`: it is included when its own start and end overlap the window, whatever its original date, and the occurrence it replaces is left out of the series, matched by the instant its `RECURRENCE-ID` names. So an occurrence moved earlier into the window is read even when the walk stops before its original date, or when its `RECURRENCE-ID` names that date in another form than `DTSTART` (in UTC for a series in a time zone, say) or the series lists it in `EXDATE` as well: a weekly Friday meeting whose next occurrence moved to Thursday shows on Thursday. Microsoft 365 is not affected: Graph expands series on the server.
3. Expanding a recurring series (from build 3.2; build 3.1 walked every series from its first occurrence on every read, synchronously, which took seconds for a calendar with long-running series and left HomeKit without an answer meanwhile):
   1. A series whose `UNTIL`, or whose last occurrence by `COUNT`, is before the window is not walked. The last occurrence by `COUNT` is worked out without walking when the rule has no BYxxx part and a fixed step (`SECONDLY` to `WEEKLY`), or a monthly or yearly step on a day of the month that every month has (1 to 28). Any other `COUNT` series is walked from `DTSTART`, which its `COUNT` bounds.
   2. Any other series with one `RRULE`, no `RDATE`, no `COUNT` and no `RANGE=THISANDFUTURE` change is walked from close to the window, with `event.iterator(start)`, ical.js's supported way to start an expansion later. ical.js reads the rule again from that start, so the start lines up with the series: `DTSTART` moved on by a whole number of intervals, keeping its wall-clock time, day of the month and month, from which ical.js takes the rule's defaults. It is a full period of the rule (one step of a fixed-step rule, 31 days for a monthly one, 366 days for a yearly one) before the margin of item 4, so the period the walk starts in, which may differ from the series', ends before the window; from the next period on the walk gives exactly the series' occurrences. Other series (`RDATE`, several `RRULE`s, a `RANGE=THISANDFUTURE` change) are walked from `DTSTART`, and so are a monthly rule with `BYMONTH` and a monthly or yearly rule whose `DTSTART` is not on its own `BYMONTH` or `BYMONTHDAY` (a negative day counted from the end of the month): ical.js steps a monthly rule through its `BYMONTH` list by position, whatever month the walk starts in, and reads a start that is not on the rule as one of its days, so a late start would lose an occurrence or add one. These give a few occurrences a year, so walking them from `DTSTART` costs little.
   3. The walk stops at the first occurrence that starts after the window.
   4. An occurrence whose wall-clock start, read without its time zone, is more than a day plus the event's length before the window ends before the window whatever its time zone (a zone moves wall-clock time by at most 14 hours), so it is passed over without a time zone lookup and without `getOccurrenceDetails`. A series with a `RANGE=THISANDFUTURE` change, which can move later occurrences by any amount, reads each occurrence in full.
   5. A cap of 20,000 iterations per series stays as a safety net, which no realistic series reaches (one that repeats every second does). A series that reaches it keeps the occurrences read so far, and its source writes the "Repeat limit" line of section 12, once.
   6. The events read are identical to those of walking every series from `DTSTART` in full; a test compares the two over many rules and windows.
4. A changed occurrence whose master is absent is read as a single event.
5. An event that cannot be read is skipped. A calendar is never dropped because of one bad event. When ical.js rejects the whole file because of one event (it does for an RRULE it cannot read), each `VTIMEZONE` and `VEVENT` is parsed on its own and the unreadable ones are left out.
6. A date-only start makes the event all-day, in the host's local time zone.
7. `VTIMEZONE` definitions are registered every time a calendar is read (the latest wins); `UTC`, `GMT` and `Z` are never replaced. A `TZID` with no definition falls back to the host's time zone.

## 6. Status model

### 6.1 Event model

Each event becomes `{ showAs, start, end, isAllDay, isCancelled, source }` where `showAs` is one of `free`, `tentative`, `busy`, `oof`, and times are epoch milliseconds. Nothing else about the event is kept.

An event from a calendar whose `use` is `outOfOffice` keeps `showAs` `oof` and is otherwise `free`: it can make the status Out of office and nothing else.

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

`unknown` is an internal tenth state (6.5). It has no color and no sensor. `notWorking` (from build 3.2) is an eleventh, for the Working switch (6.6): it has no color (the light is off) and no sensor.

### 6.3 Precedence

An event is active when it is not cancelled and `start <= now < end`. A *presence signal* is Teams presence or an unexpired status input report (section 18). Rules 2 to 9 apply to every presence signal. From build 3.2 the Working switch, while it is off, comes before every rule, the override included (6.6). The first rule that matches wins:

1. The override switch is on: `doNotDisturb`.
2. Presence says out of office (`outOfOfficeSettings.isOutOfOffice`, or activity `OutOfOffice`), or a report says `outOfOffice`, or an active event is `oof`: `outOfOffice`.
3. Presence availability `DoNotDisturb`, or activity `Presenting`, `Focusing` or `DoNotDisturb`, or a report says `doNotDisturb`: `doNotDisturb`.
4. Presence activity `InACall` or `InAConferenceCall`, or a report says `inCall`: `inCall`.
5. Presence activity `InAMeeting`, or a report says `inMeeting`, or an active event is `busy`: `inMeeting`.
6. Presence availability `Busy` or `BusyIdle`, or a report says `busy`: `busy`.
7. An active event is `tentative`: `tentative`.
8. Presence availability `Away` or `BeRightBack`, or a report says `away`: `away`.
9. Presence availability `Available` or `AvailableIdle`, or a report says `available`: `available`.
10. There is no fresh Teams presence (no source reads Teams status, or its presence is older than 5 minutes) and no report says `offline`: `available`.
11. Otherwise (presence `Offline`, `PresenceUnknown` or anything unrecognised, or a report says `offline`): `offline`.

With `ignoreAllDayBusy` on (the default), an all-day event that is `busy` or `tentative` is ignored in rules 5 and 7. An all-day `oof` event always counts.

The result carries a reason for the state file and the settings page: the name of the source that decided it (or "Teams", or for a status input report the sender's name), and `until`, the time the status is next expected to change according to the cached events (the end of the deciding event, or the start of the next counting event when available). The state file keeps `until` as an ISO time; Right now, the CLI `status` and the log show it with its day when it is not today (11.3 G, 12).

1. A counting event is one that can decide a status: not cancelled, not `free`, and not an all-day `busy` or `tentative` event while `ignoreAllDayBusy` is on.
2. `until` is the first start or end of a counting event after now at which the same rules, with the same presence and override, give a different status. This covers back-to-back and overlapping meetings (the status holds until the last one ends) and a higher status starting during a meeting.
3. When presence and an active event both satisfy rule 2 or rule 5, the event names the source, since it carries an end time. With several deciding events, the one that ends last names the source. Within one rule, an event names the source first, then Teams presence, then the most recent status input report.
4. The override has no source and no `until`. With nothing on any calendar and no presence, the source is empty and `until` is the start of the next counting event, if any.
5. For a status input report, the source is the sender's name, and with an `app`, the line in Right now reads `From {sender} ({app}).` (11.3 B). `until` is null for a report.

### 6.4 Classifying iCalendar events

iCalendar has no out of office value, so `showAs` is derived, first match wins:

1. `STATUS:CANCELLED` sets `isCancelled`.
2. An `ATTENDEE` whose address matches one of the owner's addresses (the iCloud Apple ID, the Google source's `email`) with `PARTSTAT=DECLINED`: `free`. The address is the attendee's value without `mailto:`, or, from build 3.2, its `EMAIL=` parameter (an attendee written as a `urn:uuid:` carries the address there). The addresses of every source are pooled, since all calendars belong to one person.
3. `X-MICROSOFT-CDO-BUSYSTATUS:OOF`, or the title contains one of the out of office words as a whole word, case-insensitive: `oof`. This applies even when the event is marked free. Letters and digits in any script count as word characters.
4. `TRANSP:TRANSPARENT`, or `X-MICROSOFT-CDO-BUSYSTATUS:FREE`, or (from build 3.2) `X-MICROSOFT-CDO-BUSYSTATUS:WORKINGELSEWHERE`: `free`. Working elsewhere is free, as it is through Microsoft Graph (5.3 item 6), now that the Outlook published link is the recommended way to read an Outlook calendar.
5. `STATUS:TENTATIVE`, or `X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE`: `tentative`.
6. Otherwise `busy`.

The title is read for rule 3 only and is discarded with the parsed component.

### 6.5 Freshness and Unknown

1. A source's events are fresh for 15 minutes after its last successful check. After that they are dropped until the next success, so a meeting never sticks because a calendar became unreachable.
2. Presence is fresh for 5 minutes. A status input report is fresh until it expires (18.7). A report kept from a channel that is now off in the configuration (a report through the API with the status input off, or the switch's report with the On a Call switch off) does not count.
3. Status is resolved from fresh data only. A source that is failing while others are fresh simply contributes nothing.
4. When at least one source is configured and none has fresh data, there is no fresh presence and no unexpired report (a report counts as fresh data), the status is `unknown`: every sensor is off, the bulb is left as it is, and the Unknown log line is written once each time the status becomes unknown.
5. With no calendars configured and both the status input and the On a Call switch off, the status is `unknown`. With no calendars configured the plugin logs the "no calendars" line once at startup (and not the Unknown line).
6. The override switch gives `doNotDisturb` even when no source has fresh data: it is the person's own choice and needs no data.

### 6.6 Not working (from build 3.2)

With `workingSwitch.enabled` on (9.1 item 20), the Working switch (7 item 9) says whether the person is working. Off means not working: `notWorking`, a state of its own above every rule of 6.3, the override switch included, and above Unknown (6.5). It is for the end of the day: the owner's office button runs a "stop work" scene that turns it off and a "start work" scene that turns it on, so the light is never on outside work, whatever the calendars say.

1. While it is off, the bulb is turned off (SetPower off, whatever the Offline color), every sensor reports not detected (Available and Meeting Soon too), and the meeting warning (6.7) does not start. The state file's `status` is `notWorking` with a null `reason` (10.1), and `GET /v1/status` and `POST /v1/status` answer `notWorking` (18.4).
2. The sources are still read, and status input reports, their expiry and the calendar boundaries are still tracked, but they change nothing until it is turned on. Turning it on resolves the status at once and sends the bulb its color.
3. Turning it off writes the "Working off" line of section 12 and turning it on the "Working on" line, each only when the state changes; `notWorking` writes no "Status change" line, and the first status after it is turned on does. When the switch is restored off at startup, the "Working off" line is written once, so the log says why the light is off.
4. With no change, the bulb is sent `off` again every `lifx.refreshSeconds` (8.2 item 2), so a bulb switched on at the wall goes off again.
5. With `workingSwitch.enabled` off there is no switch (it is removed, 7 item 6), and the plugin behaves as working.

### 6.7 Meeting warning (from build 3.2)

With `meetingWarningSeconds` (9.1 item 21) above 0, the light changes gradually from the Available color to the In a meeting color before a calendar meeting starts.

1. The warning is on while all of these hold: the status is `available`; the next status change, by the cached fresh calendar events with presence, reports and the override held as they are now, is to `inMeeting` at the start of a counting `busy` event, and that start is no more than `meetingWarningSeconds` away; the In a meeting color is not `off`; and the Working switch is not off. Teams presence and status input reports therefore cannot start it: only a calendar event has a known start. It never starts while another status shows (Tentative, Busy, a call, do not disturb, out of office, not working), and never between back-to-back meetings, since the status stays In a meeting.
2. It begins at the meeting's start minus `meetingWarningSeconds`, or at once when the status becomes Available later than that (a short gap between meetings), and lasts until the start. Its beginning is timed like an event boundary (8.1 item 3), so it begins on time while a calendar check is slow.
3. When it begins, the bulb is sent one SetColor of the In a meeting color with a duration equal to the time left until the start (13.1 item 8): the bulb fades by itself, with no stream of packets. When the Available color is `off`, the bulb is first powered on at the In a meeting color at 1 percent brightness, and the same SetColor fades it up to the configured brightness. When the status became Available in the same step (item 2), the bulb is first set to the Available color with no fade, so the fade starts from it.
4. If the warning ends before the meeting starts (the meeting is cancelled or moved, a call starts, the switch turns off), the normal apply replaces the fade at once: the status's color is sent with the 1 second fade. At the start the status changes to In a meeting as usual, with its 1 second fade.
5. The status stays `available` throughout. The state file carries `meetingWarning` (10.1), Right now adds `A meeting starts at {time}.` (11.3 B), and the optional Meeting Soon sensor (7) detects occupancy.
6. The bulb refresh of 8.2 item 2 is not sent during the warning, so the fade is not cut short.
7. Without a LIFX bulb the warning still shows in Right now, the state file and the sensor.

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
| `meetingSoon` | `{name} Meeting Soon` | (from build 3.2) any status, during the meeting warning (6.7) |

1. `{name}` is the platform `name` (default "Busy Light").
2. The first three are the roll-ups and are the default set. `tentative`, `away` and `offline` turn no roll-up on.
3. UUIDs come from `busy-light:sensor:{key}` and never from the display name, so renaming keeps rooms and automations. The Meeting Soon sensor's UUID comes from `busy-light:sensor:meeting-soon`. It is not created by default and turns no roll-up on.
4. Accessory Information: Manufacturer "Busy Light", Model "Status sensor", Serial Number the key, Firmware Revision the package version.
5. The override switch, when enabled, is a Switch accessory named `{name} Override`, UUID from `busy-light:override`. Its state is kept in the accessory context and survives restarts. Turning it on or off re-resolves the status at once. HomeKit's write is answered as soon as the state is stored; the status and the bulb follow without holding it up. Accessory Information: Manufacturer "Busy Light", Model "Override switch", Serial Number `override`, Firmware Revision the package version.
6. Accessories no longer wanted by the configuration are unregistered at startup. When `busy-light/reset-pending` exists at startup (10.3 item 6), every cached accessory is unregistered first and the marker deleted.
7. On Homebridge 2, set `ConfiguredName` where the service supports it so the Home app shows the same names. "Supports" means the service's HAP definition lists it; in HAP-NodeJS 2.2 neither OccupancySensor nor Switch does, so today only `Name` is set (and the accessory's display name follows a rename).
8. The On a Call switch, when enabled, is a Switch accessory `{name} On a Call` (section 18.9).
9. The Working switch (from build 3.2, 6.6), when `workingSwitch.enabled` is on, is a Switch accessory `{name} Working`, UUID from `busy-light:working-switch`, Accessory Information as the override switch with Model "Working switch" and Serial Number `working-switch`. It starts on. Its state is kept in the accessory context and survives restarts. HomeKit's write is answered as soon as the state is stored; the status and the bulb follow.

## 8. Polling, timing and backoff

### 8.1 Loop

1. A tick runs every `pollSeconds` (default 30, minimum 15, maximum 240). A tick never overlaps the previous one.
2. Each tick: read presence if a source uses it; reload any calendar source whose last check is older than its own `calendarSeconds` (9.1 item 19), or the platform's `calendarSeconds` (default 180, minimum 60, maximum 600) when it has none; resolve; apply. Sources are read in parallel. A failing source is read when its retry time (8.3) comes instead.
3. A single timer is set for the next start or end of a cached counting event, or the beginning of a meeting warning (6.7), whichever is first. When it fires, the status is resolved again from the cache with no network call. This makes the light change at the minute a meeting starts or ends. The status input's expiry timer works the same way (18.7 item 3). From build 3.2 the timer is set after every apply and whenever a source's events change, independent of the tick, and from the clock read after the bulb was sent its color: build 3.1 set it only when the time came before the next tick was due, but a tick resolves only after its calendar checks and any bulb discovery finish and an overrunning tick skips the next, so a meeting start could wait for a slow calendar (about 20 seconds late in a test), and an offline bulb delayed the timer by the time its send took. An apply puts the color on the bulbs' lanes (13.3 item 1) and goes on without waiting for their answers, so neither the timers nor the next apply wait on a bulb; the status API's answer (18.4) does not either.
4. The first tick runs as soon as Homebridge finishes launching.
5. From build 3.2 every timer delay is clamped to Node's maximum (2,147,483,647 ms, about 24.8 days) and the timer is set again when it fires early, so a far time (possible only with a hand-edited `inputs.json` or a wrong clock) never fires at once. A timer's time is taken as the time of the resolve only when it fires within a second of it.

### 8.2 Applying a status

1. On a change: log the status line, update every sensor, write the state file, and send the bulb its color.
2. With no change, the bulb is sent its color again every `lifx.refreshSeconds` (default 300, 0 turns this off), so a bulb that was switched off at the wall recovers. Not during a meeting warning (6.7 item 6).
3. `unknown` sends nothing to the bulb. `notWorking` sends `off` (6.6).
4. A bulb chosen later (13.2 item 4) is sent the current color at once, with the 1 second fade.
5. From build 3.2 there can be several chosen bulbs (13.3): wherever this SPEC says the bulb is sent something (a status change, a refresh, the meeting warning, the Working switch turning the light off, a bulb chosen later), every chosen bulb is sent it at the same moment, each on its own.

### 8.3 Source status and backoff

Each source is in one of four states, shown in the state file and, from build 2, on the settings page: `checking` (no result yet), `connected`, `signInNeeded` (iCloud 401, Microsoft with no valid token), `notReachable` (anything else).

1. After a failure the source is retried after 1, 2, 5 and then 15 minutes, staying at 15. A success resets the schedule.
2. `signInNeeded` for iCloud is retried hourly only, so a wrong app-specific password cannot lock the Apple ID.
3. A failure is logged once at warning level when a source first fails and once at info level when it recovers. Repeats are debug. "First fails" is the move from `checking` or `connected` to a failure state; a change from one failure to another is debug too. For iCloud 401 the warning is the iCloud 401 line; for a Microsoft source without a token or refused, the Microsoft lines of section 12 are the warning, and they come from the sign-in itself. A Microsoft source whose presence and calendar fail together writes one warning.
4. A Microsoft source without a token is checked on every tick, since that only reads the token file, so a sign-in shows within one tick.
5. A Microsoft source's presence and calendar are each scheduled on their own; the source's state is the worse of the two (`signInNeeded`, then `notReachable`, then `checking`, then `connected`).

## 9. Configuration (config.json)

```json
{
  "platform": "BusyLight",
  "name": "Busy Light",
  "calendars": [
    { "type": "icloud", "id": "cal-mgx3k2f1a9q", "name": "iCloud", "appleId": "", "appPassword": "",
      "calendars": [ { "id": "/123456789/calendars/home/", "name": "Alex", "use": "all" },
                     { "id": "/123456789/calendars/family-1/", "name": "Family", "use": "outOfOffice" } ] },
    { "type": "google", "id": "cal-mgx3k5b7c2d", "name": "Personal", "url": "", "email": "", "use": "all" },
    { "type": "microsoft", "id": "cal-mgx3k8e4f6g", "name": "Work", "tenantId": "", "clientId": "", "useTeamsStatus": true, "useCalendar": true,
      "calendars": [ { "id": "AAMkAGSyntheticCalendarId=", "name": "Calendar", "use": "all" } ] },
    { "type": "url", "id": "cal-mgx3kb9h1j4", "name": "Team rota", "url": "", "use": "outOfOffice", "calendarSeconds": 600 }
  ],
  "colors": { "available": "#00FF00", "offline": "off" },
  "lifx": { "enabled": false, "bulbs": [], "host": "", "brightness": 100, "refreshSeconds": 300 },
  "sensors": ["available", "busyAny", "outOfOffice"],
  "overrideSwitch": false,
  "pollSeconds": 30,
  "calendarSeconds": 180,
  "ignoreAllDayBusy": true,
  "outOfOfficeWords": ["Out of office", "OOO", "Vacation", "PTO"],
  "debug": false,
  "statusInput": { "enabled": false, "port": 8582, "key": "", "allowPlainKey": true },
  "callSwitch": { "enabled": false, "hours": 3 },
  "workingSwitch": { "enabled": false },
  "meetingWarningSeconds": 0
}
```

This is the build 2 shape, as the settings page writes it: every source has an explicit `id` (11.2 item 3), the iCloud and Microsoft 365 sources list the calendars to read with their ids and `use` (9.1 items 13 to 15), and a Google or URL source carries its own `use`. A block written by build 1 (no ids, an iCloud `calendars` list of names such as `["Alex"]`, no `use`) reads the same as it always did. Build 3 adds `statusInput`, `callSwitch` and a source's own `calendarSeconds` (9.1 items 17 to 19); a block without them reads with the status input and the On a Call switch off and every source on the platform's interval. Build 3.2 adds `workingSwitch` and `meetingWarningSeconds` (9.1 items 20 and 21); a block without them reads with no Working switch and no meeting warning.

### 9.1 Rules

1. Every field except `platform` is optional. A missing field takes its default. An empty `calendars` list is valid (the plugin starts and logs the "no calendars" line).
2. `calendars[].name` is required, 1 to 64 printable characters, unique without regard to case. `calendars[].id` is optional; when absent it is the name lowercased with every run of characters outside `a-z0-9` replaced by a hyphen. The id names the Microsoft token file, so the settings page (build 2) writes it explicitly and never changes it on rename.
3. `type` is one of `icloud`, `google`, `microsoft`, `url`. Required fields: iCloud `appleId` and `appPassword`; Google and URL `url`; Microsoft `tenantId` and `clientId` (both GUIDs).
4. At most one Microsoft source may have `useTeamsStatus` on. A Microsoft source with both `useTeamsStatus` and `useCalendar` off is an error.
5. `colors` values are `#RRGGBB` or `off`, any case. Unknown status keys are ignored with a warning.
6. `lifx.bulbs` (from build 3.2: a list of bulbs, each a name as shown in the LIFX app or a serial number; the page writes serial numbers) and `lifx.host` (one or more IPv4 addresses or host names separated by commas, each a bulb; from build 3.2 several) are both optional; section 13.2 says how the bulbs are chosen. `lifx.bulbs` replaces `lifx.bulb` (one name or serial number), which keeps working: when `lifx.bulbs` is absent, a saved `lifx.bulb` is read as a list of one, and the page writes `lifx.bulbs` and drops `lifx.bulb` on the next Save. With `lifx.bulbs` present, `lifx.bulb` is ignored. A `lifx.host` with any part that is not an IPv4 address or host name is ignored as a whole, with one warning. `brightness` is 1 to 100, one setting for every bulb.
7. `sensors` holds keys from section 7. Unknown keys are ignored with a warning. An empty list creates no sensors.
8. Validation never stops Homebridge. An invalid source is skipped with one error line naming the field (for example `calendars[1].url: must start with https:// or webcal://`); an invalid scalar falls back to its default with one warning.
9. Names are trimmed before the length check and before the id is derived. The derived id follows rule 2 literally (`Work (Contoso)` becomes `work-contoso-`). An explicit id is 1 to 64 of `a-z`, `0-9` and `-`. Two sources with the same id, given or derived, is an error on the later one.
10. `null` and empty text count as missing. Optional fields inside a source (`email`, `calendars`, `useTeamsStatus`, `useCalendar`) fall back to their defaults with a warning; required ones skip the source. `useTeamsStatus` and `useCalendar` default to on. GUIDs are kept in lower case, colors in upper case (`off` in lower case), and `webcal://` addresses are stored as `https://`.
11. Rule 4 is applied by skipping the later Microsoft source that also has `useTeamsStatus` on.
12. `pollSeconds` is at most 240 and `calendarSeconds` at most 600, below the 5 and 15 minutes that presence and events stay fresh (6.5), so data does not go stale between checks. `lifx.refreshSeconds` is at most 86400 (a day).
13. iCloud `calendars` (from build 2) is a list whose items are either a name (text, as build 1 wrote them) or `{ "id", "name", "use" }`, where `id` is the CalDAV collection path, `name` the display name when it was ticked, and `use` as in item 15. A text item is read as `{ "name": text, "use": "all" }`. No list, or an empty one, keeps every calendar, as in build 1; the settings page always writes an explicit list.
14. Microsoft `calendars` (from build 2) is a list of `{ "id", "name", "use" }` with the Graph calendar id. No list, or an empty one, reads the default calendar only, as in build 1. It is ignored when `useCalendar` is off.
15. `use` is `all` (the default) or `outOfOffice`, on each item of an iCloud or Microsoft `calendars` list and on a Google or URL source itself. Any other value falls back to `all` with a warning.
16. An item of a `calendars` list with neither an `id` nor a name is ignored with a warning. Two items with the same `id` keep the first. An item of a Microsoft list without an `id` cannot be read, so it is ignored with the same warning.
17. `statusInput` (from build 3, section 18): `enabled` is a boolean; `port` an integer from 1024 to 65535 (default 8582); `key` as 18.8; `allowPlainKey` a boolean, default true (so Shortcuts and a curl test work from the start; the page offers to turn it off once every sender signs). With `enabled` on and a missing or invalid key, the status input stays off with the error `statusInput.key: must be 32 to 128 letters, digits, hyphens or underscores`.
18. `callSwitch` (from build 3, 18.9): `enabled` a boolean; `hours` an integer from 1 to 12 (default 3), falling back with a warning.
19. Any source may have `calendarSeconds` (from build 3), an integer from 60 to 600. Missing means the platform `calendarSeconds`. Invalid falls back with a warning.
20. `workingSwitch` (from build 3.2, 6.6): `enabled` a boolean, default false.
21. `meetingWarningSeconds` (from build 3.2, 6.7): 0 (no warning, the default), 60, 120, 180 or 300. Any other value falls back to 0 with a warning.

The validation messages, after `{path}: `:

| Message | Level | When |
| --- | --- | --- |
| `is required` | error | A required source field is missing |
| `must be text` | error or warn | Not a string (error for a required source field, warn otherwise) |
| `must be 1 to 64 printable characters` | error | `calendars[].name` |
| `must be unique` | error | `calendars[].name` repeats without regard to case |
| `{id} is already used by another calendar` | error | `calendars[].id` repeats |
| `must be 1 to 64 lower case letters, digits and hyphens` | error | An explicit `calendars[].id` |
| `must be icloud, google, microsoft or url` | error | `calendars[].type` |
| `must be a calendar entry` | error | A `calendars` item that is not an object |
| `must start with https:// or webcal://` | error | `calendars[].url` |
| `must be a GUID such as 00000000-0000-0000-0000-000000000000` | error | `tenantId`, `clientId` |
| `only one Microsoft 365 calendar can use Teams status` | error | Rule 4 |
| `Use Teams status and Use Outlook calendar cannot both be off` | error | Rule 4 (on `useCalendar`) |
| `must be true or false` | warn | A boolean |
| `must be a list` | warn | `calendars`, `sensors`, `outOfOfficeWords`, `calendars[].calendars`, `lifx.bulbs` |
| `must be text, ignored` | warn | An item of a list of words or names |
| `must be a set of colors` / `must be a set of LIFX settings` | warn | `colors` or `lifx` is not an object |
| `is not a status, ignored` | warn | An unknown key in `colors` |
| `must be #RRGGBB or off` | warn | A color value |
| `must be an IPv4 address or host name` | warn | `lifx.host` (any of its comma separated parts) |
| `must be a whole number from 1 to 100` | warn | `lifx.brightness` |
| `must be a whole number from 0 to 86400` | warn | `lifx.refreshSeconds` |
| `must be a whole number from 15 to 240` / `from 60 to 600` | warn | `pollSeconds`, `calendarSeconds`, `calendars[].calendarSeconds` |
| `is not a sensor, ignored` | warn | An unknown key in `sensors` |
| `must be all or outOfOffice` | warn | A `use` value (rule 15) |
| `must be a calendar name or entry, ignored` | warn | A `calendars[].calendars` item that is neither text nor an object, or has neither `id` nor name (rule 16) |
| `repeats an earlier calendar, ignored` | warn | A repeated `id` in a `calendars[].calendars` list (rule 16) |
| `must be 32 to 128 letters, digits, hyphens or underscores` | error | `statusInput.key` with the status input on (rule 17) |
| `must be a whole number from 1024 to 65535` | warn | `statusInput.port` |
| `must be a whole number from 1 to 12` | warn | `callSwitch.hours` |
| `must be a set of status input settings` / `must be a set of call switch settings` | warn | `statusInput` or `callSwitch` is not an object |
| `must be a set of working switch settings` | warn | `workingSwitch` is not an object (rule 20) |
| `must be 0, 60, 120, 180 or 300` | warn | `meetingWarningSeconds` (rule 21) |

### 9.2 Standard settings form (build 1)

From build 2 the custom page of section 11 replaces this form (`customUi`). The schema stays complete and in step with section 9 (including the build 2 fields: object items in `calendars[].calendars` and `calendars[].calendars` for Microsoft, and `use`), because Homebridge still uses it to check the block; the titles below still apply to it.

`config.schema.json` describes the whole block for the Homebridge UI's standard form (`pluginAlias` `BusyLight`, `pluginType` `platform`, `singular` true). The calendar list is an array whose type-specific fields use the form's `condition` support so only the fields for the chosen type show. Secret fields are plain text fields in this form (the standard form has no reliable password control for array items); build 2 replaces the form.

Titles and descriptions, verbatim (the build 2 field `use` takes its title and choices from 11.3 C: `Counts for`, with `Busy and out of office` for `all` and `Out of office only` for `outOfOffice`):

| Field | Title | Description |
| --- | --- | --- |
| `name` | Name | Starts the name of every sensor, for example "Busy Light Available". |
| `calendars` | Calendars | Add every calendar that should count. Events from all of them are combined. |
| `calendars[].type` | Type | (enum titles: iCloud, Google Calendar, Microsoft 365, Calendar URL) |
| `calendars[].name` | Name | A name for this calendar. It appears in the log. |
| `appleId` | Apple ID email | |
| `appPassword` | App-specific password | Create one at <a href="https://account.apple.com" target="_blank" rel="noopener noreferrer">account.apple.com</a> under Sign-In and Security, then App-Specific Passwords (<a href="https://support.apple.com/en-us/102654" target="_blank" rel="noopener noreferrer">how to</a>). This is not your Apple ID password. |
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
| `lifx.bulbs` | Bulbs | Leave empty if you have one LIFX bulb: it is found automatically. With several, add the name of each bulb to use, from the LIFX app. The log lists the bulbs found. |
| `lifx.host` | Bulb IP address | Only needed when the search cannot reach the bulbs, for example when Homebridge runs in Docker without host networking. Separate several addresses with commas. |
| `lifx.brightness` | Brightness (percent) | |
| `lifx.refreshSeconds` | Send the color again every (seconds) | Recovers a bulb that was switched off at the wall. 0 sends only when the status changes. |
| `sensors` | Sensors to create | Each is an occupancy sensor in the Home app that is on while that is your status. Use them in automations to set any other light. |
| `overrideSwitch` | Override switch | Adds a switch to the Home app that forces Do not disturb while it is on. |
| `pollSeconds` | Check status every (seconds) | |
| `calendarSeconds` | Reload calendars every (seconds) | |
| `ignoreAllDayBusy` | Ignore all-day events marked busy | All-day out of office events always count. |
| `outOfOfficeWords` | Out of office words | iCloud, Google and URL calendar events with one of these words in the title count as out of office. |
| `debug` | Debug logging | |
| `calendars[].calendarSeconds` | Check for changes every (seconds) | |
| `statusInput.enabled` | Let other apps set your status | |
| `statusInput.port` | Port | |
| `statusInput.key` | Key | |
| `statusInput.allowPlainKey` | Allow the plain key | |
| `callSwitch.enabled` | Add an On a Call switch to the Home app | Turn it on from a shortcut, Siri or a Home tile while you are on a call. Useful for apps that should not make network requests themselves. |
| `callSwitch.hours` | Turn it off by itself after (hours) | |
| `workingSwitch.enabled` | Add a Working switch to the Home app | Turn it off at the end of the day, for example in a Home scene, and the light stays off whatever your calendars say. Turn it on when you start work. |
| `meetingWarningSeconds` | Warn before meetings | The light fades from the Available color to the In a meeting color before a meeting starts. |

`headerDisplay`: "Busy Light shows whether you are free on a light. Add at least one calendar, then choose how the light is controlled. Not affiliated with or endorsed by Apple, Google, Microsoft or LIFX."

Build 1 form details not in the table above:

1. The colors and LIFX settings are fieldsets titled "Colors" and "LIFX bulbs" (from build 3.2; "LIFX bulb" before). The LIFX fields after the checkbox show only while it is ticked. From build 3, the status input and the On a Call switch are fieldsets titled "Status from other apps" and "On a Call switch" after the calendars, with their other fields shown only while the checkbox is ticked, and every calendar entry ends with its own `calendarSeconds`.
2. `calendars[].url` is one property shown twice in the layout, with the Google title and description or the URL title and description, by a `condition` on the type (evaluated by the Homebridge UI as `new Function('model', 'arrayIndices', body)`).
3. The sensors are a checkbox list named with the accessory name endings of section 7 ("Available", "Busy", "Out of Office", and so on).
4. `calendars[].id` is in the schema but not shown. Patterns flag colors that are not `#RRGGBB` or `off`, IDs that are not GUIDs, and addresses that do not start with `https://` or `webcal://`.
5. The two lists of text (`calendars[].calendars` and `outOfOfficeWords`) are `array` entries in the layout with an item key (`outOfOfficeWords[]`). Given as a bare key, the Homebridge UI shows neither their items nor an Add button.
6. Every list in the layout (`calendars`, `calendars[].calendars` and `outOfOfficeWords`) sets `"orderable": false`. The Homebridge UI otherwise makes each item draggable, and a dropdown inside a draggable item swallows the mouse release: choosing a calendar type left the whole entry stuck to the pointer (found on the Pi, October 8, 2026).
7. Checked October 8, 2026, in Homebridge UI 5.29.0: each type shows only its fields, the address titles switch with the type, the LIFX fields appear when ticked, and saving writes a block the plugin reads. The form also writes `useTeamsStatus` and `useCalendar` into every calendar entry; the plugin ignores them for other types.
8. From build 3.1 the settings page shows the three intervals as durations to choose from (11.3 C and F). This form keeps them as numbers in seconds, so its titles keep `(seconds)`.
9. From build 3.2 the Working switch is a fieldset titled "Working switch" after "On a Call switch", and `meetingWarningSeconds` is a dropdown at the end of the "Colors" fieldset with the choices Off, 1 minute, 2 minutes, 3 minutes and 5 minutes (0, 60, 120, 180 and 300).

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
  "lights": [
    { "enabled": true, "label": "Office Door", "host": "192.168.4.50", "found": "discovered", "lastSent": "#FF0000", "lastSentAt": "2026-10-08T13:00:05.000Z", "answered": true },
    { "enabled": true, "label": "Status Light", "host": "192.168.4.21", "found": "remembered", "lastSent": "#FF0000", "lastSentAt": "2026-10-08T13:00:05.000Z", "answered": false }
  ],
  "statusInput": { "enabled": true, "port": 8582, "listening": true, "error": null, "id": "q3Lr8vT0cXw2mN5a", "advertised": "homebridge.local", "addressChange": null,
                   "reported": { "inCall": "2026-10-08T13:00:04.000Z" } },
  "inputs": [ { "sender": "CallWatch on Alex’s iMac", "status": "inCall", "app": "Microsoft Teams", "via": "api", "auth": "signed", "lastHeard": "2026-10-08T13:00:04.000Z", "expiresAt": "2026-10-08T13:03:04.000Z", "active": true, "ended": null } ],
  "meetingWarning": null
}
```

1. `events` is a count. `error` is a short message that never contains a secret or a calendar address.
2. A source in `signInNeeded` or `notReachable` carries a short `error`; for a refused Microsoft sign-in it is the reason of 4.3.1, and the source also carries `"help"`, the address of the administrator instructions.
2a. `signIn` is null, or `{ "id", "verificationUri", "userCode", "expiresAt" }` while a Microsoft code is waiting.
3. The file never holds tokens, passwords, addresses or anything about an event beyond the count and the `until` time.
4. `status` is `unknown` until the first resolve, and `reason` is null while the status is unknown. `lastChecked` is the last attempt (either part of a Microsoft source). `events` is null for a Microsoft source that does not read the calendar. A Microsoft source without a token has the `error` `waiting for sign-in`, `not signed in` or `the sign-in code was not used`. `help` appears only with a refused sign-in.
5. `light.found` is `configured` (from `lifx.host`), `remembered` (from `light.json`), `discovered`, or null when no bulb is chosen. `lastSent` is `#RRGGBB` or `off`. The file is mode 600. From build 3.2 the file has `lights`, one entry per chosen bulb (13.3) with the fields `light` had, in the order of `lifx.bulbs` (or of `lifx.host`), in place of `light`. While no bulb is chosen there is one entry, as `light` was: `enabled` false when LIFX is off, or `enabled` true with a null `host` while none is found yet. Readers (the CLI and the page) still read a `light` object, as one entry, from a state file written before build 3.2.
6. `statusInput` and `inputs` (from build 3, section 18): `via` is `api` or `switch`. `inputs` holds the senders of 18.7 item 5, each with `"auth": "signed"` or `"plain"`, and `null` for the switch (the replay table stays in `inputs.json` only). `statusInput.id` is null until the status input first starts. `reason` carries `"app"` when a report with an app decided the status, so Right now can read `From {sender} ({app}).`; `GET /v1/status` gives no calendar name or event time (18.10 item 3): its `reason.source` is an active sender's name or null, and `reason.until` is null. A build 2 state file, without these fields, still reads. The key is never in the state file.
7. `statusInput.advertised` (from build 3.1) is the address the plugin last gave senders: the host name, or the first IPv4 address when there is none (18.11 item 6), or null before the first check. `statusInput.addressChange` is null, or `{ "from", "to", "at" }` for the last change from one IPv4 address to another. Both are read back from the previous state file when the plugin starts.
8. From build 3.2: `status` is `notWorking` while the Working switch is off, with `reason` null (6.6). `meetingWarning` is null, or `{ "meetingAt" }`, the meeting's start as an ISO time, while the meeting warning is on (6.7). Each `inputs` entry has `ended`: `cleared` when the sender's last word was `clear` (the On a Call switch turned off included), `expired` when its report ran out, and null while it is active; an entry written before build 3.2 has none and reads as `expired`. `statusInput.reported` holds, for each status an app has reported through the status API, when it last did, `{ "<status>": "<ISO time>" }`, kept in `inputs.json` across restarts (18.7 item 8); the page reads it for the statuses it shows (11.3 D). `reason.until` stays an ISO time: Right now, the CLI `status` and the log show it with its day (6.3).

### 10.2 CLI

`homebridge-busy-light <command> [-U <storage path>]`. The storage path defaults to `/var/lib/homebridge` when that exists, otherwise `~/.homebridge`. The CLI reads the platform block from `config.json` there. Exit code 0 on success, 1 on failure.

| Command | Does |
| --- | --- |
| `status` | Prints the state file in plain words: the status, the reason, and one line per source. |
| `check` | Without touching HomeKit or the bulb, fetches every source once and prints, per source, its state, the number of events in the window and the events active now as times and `showAs` only. Then prints the resolved status. |
| `login [name]` | Runs the device code flow for the named Microsoft source (or the only one) and stores the token. |
| `lights` | Searches the network for LIFX bulbs and prints each one's name, serial number and IP address. |
| `light [name\|ip] [#RRGGBB\|off]` | Sends the color (default the Available color) to the bulb and prints whether it answered. With no bulb given, uses the configured or only bulb, as the plugin would (from build 3.2, every chosen bulb, with one answer line per bulb). |
| `input` | Prints whether the status input and the On a Call switch are on, the port, the instance id, the address by host name when there is one (18.11; the CLI runs the check itself), the addresses of the Homebridge host (`http://{ip}:{port}`, one per non-internal IPv4 address), and the senders from the state file. |
| `input --setup-code` | Also prints the setup code, after the line `The setup code contains your key. Treat it like a password.` |
| `input test` | Sends a signed `inCall` for 30 seconds from the sender `Busy Light test` to the running plugin on `127.0.0.1`, using the configured key, and prints the response or the error. |
| `help` | Lists the commands. |

The CLI follows the same logging rules as the plugin (section 12).

1. `status`: the status line of section 12 (or the Unknown line, or from build 3.2 `Status: Not working (the Working switch is off).` while the Working switch is off), `The override switch is on.` when it is, `Updated {time}.`, one line per source `{name} ({type name}): {state}{ (error)}{, n events}, checked {time}.` (states in words: checking, connected, sign-in needed, not reachable; type names: iCloud, Google Calendar, Microsoft 365, Calendar URL), `  Instructions to send your Microsoft 365 administrator: {help}` after a refused source, the Microsoft code line while a code is waiting, and `Light: not used.`, `Light: no bulb chosen yet.` or `Light: {label at }{host}{, last sent {color} at {time}, answered|no answer}.`, from build 3.2 one `Light:` line per entry of `lights` (10.1 item 5). No state file exits 1.
2. `check`: one line per source `{name} ({type name}): {state}{ (error)}{, n events in the window}.`, then for a connected source `  Teams: {availability}, {activity}{, out of office}.` and one `  Now: {start} to {end}, {showAs}.` per active event (or `  Nothing on this calendar right now.`), then the status line. It never starts a Microsoft sign-in (it prints `  Run "homebridge-busy-light login {name}" to sign in.`), does not write the state file, and does not print the plugin's retry lines. It exits 1 unless every source connects, and with no calendars.
3. `login`: with several Microsoft sources the name (or id) is required. It prints the Microsoft lines of section 12 and exits 0 only when signed in.
4. `lights`: `Searching for LIFX bulbs...`, then `{label}: serial number {serial}, IP address {ip}` per bulb, or the "no bulb" line and exit 1.
5. `light`: an argument that is `#RRGGBB` or `off` is the color; the rest is the bulb. An IPv4 address is sent tagged; a name or serial is found by discovery and sent untagged; no bulb uses `lifx.host`, the remembered bulb or discovery as the plugin would, whether or not `lifx.enabled` is on, and never writes `light.json`. It prints `The LIFX bulb at {host} answered.` or the "bulb silent" line (exit 1). From build 3.2, with no bulb given it sends to every bulb the plugin would choose (13.2, 13.3), at the same moment, and prints one of those lines per bulb, in the order of `lifx.bulbs`; it exits 1 when any bulb did not answer.
6. `help` (also `--help`, `-h`) prints the usage; an unknown command prints it and exits 1.
7. `input` (from build 3): `Status input: on, port {port}.` or `Status input: off (port {port} when on).`; `On a Call switch: on, turns itself off after {n} hours.` or `On a Call switch: off.`; `Instance id: {id}.` or `Instance id: none yet (it is created when the status input first starts).`; one `Address: http://{host}:{port}` per address, the host name first; then `Apps reporting now:` and one line per sender, `  {sender}: {Display name}{ from {app}}{, signed|, plain key}, last heard {time}, active|cleared|expired.` (the switch's sender without the authentication part; `cleared` from build 3.2, as the `Cleared` badge of 11.3 I), or `  No app has reported in the last 12 hours.` The key is never printed. `input --setup-code` without the input on, a key and an instance id prints `There is no setup code yet: turn on the status input in the plugin settings, save, and restart Homebridge.` and exits 1. `input test` prints `Busy Light received the test: {answer}` or `The test failed ({error}, HTTP {code}): {message}` and exits 1; with the status input off it prints `The status input is off. Turn it on in the plugin settings, save, and restart Homebridge.` and exits 1.

### 10.3 UI server (build 2)

`src/ui/server.ts` on `@homebridge/plugin-ui-utils`, compiled with the platform and started through `homebridge-ui/server.js` (the file the Homebridge UI looks for), exactly as in `homebridge-generac`. It reuses the plugin's own source, token store, discovery and state modules; nothing is written twice. Every request is a `homebridge.request(path, body)` call from the page. Every response is JSON; a failure is `{ "error": key }` with the keys listed per endpoint, never a thrown error, and never carries a secret, a token, a calendar address or an event title.

| Endpoint | Request | Response |
| --- | --- | --- |
| `/version` | none | `{ "version" }` from `package.json` |
| `/status` | none | The state file of 10.1 as is (from build 3.2 with `statusInput.reported`, which the page reads for the statuses it shows, 11.3 D), or `{ "status": null }` when there is none yet (Homebridge has not run the plugin). |
| `/icloud/calendars` | `{ "appleId", "appPassword" }` | `{ "calendars": [ICloudCalendar] }` or `{ "error": "rejected" \| "network" \| "unexpected" }` |
| `/url/test` | `{ "url", "email"? }` | `{ "eventsToday": n }` or `{ "error": "insecure" \| "notCalendar" \| "http" \| "network" \| "tooLarge", "host", "code"? }` |
| `/microsoft/start` | `{ "id", "tenantId", "clientId", "useTeamsStatus", "useCalendar" }` | `{ "verificationUri", "userCode", "expiresAt" }` or `{ "error": "refused", "reason", "help" }` or `{ "error": "network" }` |
| `/microsoft/poll` | `{ "id" }` | `{ "state": "waiting" \| "done" \| "expired" }` or `{ "state": "refused", "reason", "help" }` |
| `/microsoft/cancel` | `{ "id" }` | `{ "ok": true }` |
| `/microsoft/calendars` | `{ "id", "tenantId", "clientId" }` | `{ "calendars": [MicrosoftCalendar] }` or `{ "error": "notSignedIn" \| "network" }` or `{ "error": "refused", "reason", "help" }` |
| `/microsoft/disconnect` | `{ "id" }` | `{ "ok": true }` (deletes that source's token file) |
| `/lifx/discover` | none | `{ "bulbs": [{ "label", "serial", "ip" }] }` (empty when none answer) |
| `/lifx/test` | `{ "bulbs": [{ "serial"?, "host"? }], "brightness" }` (from build 3.2; `{ "serial"?, "host"?, "brightness" }` before, still read as one bulb) | `{ "answered": true \| false, "results": [{ "label", "host", "answered" }] }` |
| `/reset` | none | `{ "ok": true }`, or `{ "ok": false }` when `busy-light/` cannot be written |
| `/input/info` | none | `{ "hostname": "homebridge.local", "addresses": ["192.168.4.10"], "port", "id", "addressChange" }` (`hostname` as 18.11, or null; non-internal IPv4 addresses of the host; `id` from `instance.json`, created there if missing; `addressChange` `{ "from", "to" }` or null, 18.11 item 6; the page builds the address and setup code) |
| `/input/test` | `{ "port", "key" }` | `{ "ok": true }` or `{ "error": "notListening" \| "unauthorized" \| "other", "message" }`: sends a signed `inCall` for 30 seconds from `Busy Light test` to `127.0.0.1:{port}` |

`ICloudCalendar` is `{ "id", "name", "shared", "subscribed", "eventsToday" }` and `MicrosoftCalendar` is `{ "id", "name", "isDefault", "shared", "eventsToday" }`. `eventsToday` counts the timed and all-day events overlapping the host's local today that are not free and not cancelled; it is null when the count could not be read. Nothing else about an event leaves the server.

1. `/icloud/calendars` runs discovery (5.1 steps 1 to 3) with the credentials given, then one `REPORT` per calendar for today only. `id` is the collection's path on the CalDAV host (it holds the account number: it is stored in `config.json` but never logged). `shared` is true when the collection's `resourcetype` contains `shared` (a calendar someone else shared with the user) and false for `shared-owner`. `subscribed` is true when it contains `subscribed`; those calendars are listed but cannot be ticked (11.3 C). A 401 is `rejected`, and so is an empty Apple ID or password, without a request. No answer, or an HTTP 5xx or 429, is `network`; any other unexpected answer (no principal, another 4xx) is `unexpected`. A subscribed calendar has `eventsToday` null.
2. `/url/test` fetches the address once under the rules of 5.2 and counts today's events. `host` is the host name only. Too many redirects is `http`, with the last redirect's status as `code`.
3. The Microsoft sign-in runs inside the UI server process, with the device code flow of 4.3 and the token store of 4.4: one pending flow per source id, held in memory, ended by `done`, `expired`, `refused`, `/microsoft/cancel` or after 15 minutes. Only one code is issued per `/microsoft/start` (the three-code limit of 4.3 item 5 is for the plugin's own unattended flow). On `done` the token file `busy-light/microsoft-{id}.json` is written exactly as the plugin writes it, and the plugin picks it up within one tick (4.4 item 6). Refusals use the reason and help address of 4.3.1. `/microsoft/poll` asks Microsoft only when the page calls it (every 3 seconds), at most once per polling interval, 5 seconds longer after each `slow_down`; the server runs no timers of its own, and a pending flow older than 15 minutes is dropped on the next Microsoft request. A token that cannot be written answers `expired`, so Connect gives a new code. An `id` that is not a valid source id is `network` (the id names a file), and a tenant or client ID that is not a GUID is `refused` with the "not recognised" reason without asking Microsoft.
4. `/microsoft/calendars` uses the stored token: `GET /v1.0/me/calendars?$select=id,name,isDefaultCalendar,owner` (follow `@odata.nextLink` on `https://graph.microsoft.com/` up to five pages), then one `calendarView` per calendar for today, selecting only the fields of 5.3. `shared` is true when the calendar's `owner.address` differs from the default calendar's. This needs `Calendars.Read` only. A refresh made here is kept in memory and never written to (or, when refused, deleted from) the token file: a token refreshed for `Calendars.Read` alone would take Teams status away from the plugin. The calendars are read even when the source's `useCalendar` is off.
5. `/lifx/discover` is the discovery of 13.2 item 1 and changes nothing. `/lifx/test` sends red, then green, then the Available color, each held 1 second, with acknowledgements (13.1), to the bulb by serial (untagged) or by host (tagged), and reports whether every packet was answered. It never writes `light.json`; the plugin's next send restores the status color. The Available color is the one saved in `config.json` (read only), or the default; the request carries no color. A `serial` with a `host` is sent untagged to that host, a `host` alone is sent tagged, and a `serial` alone is found by discovery first (not found: `answered` false). With neither, the bulb is the one the plugin would choose: discovery, then the saved `lifx.bulb` by serial or name, or the only bulb found (none, or several and none named: `answered` false). From build 3.2 the request lists the bulbs, each tested as above and all at the same moment, each on its own (13.3); `results` has one entry per bulb in the order given, an entry with neither a serial nor a host (a saved name the page could not find) included, not answered, with its `label` from discovery when the server found it there (else null), the `host` it was sent to (null when not found) and whether it answered; `answered` is true only when every bulb answered. With no bulbs listed, the bulbs are those the plugin would choose, by the saved `lifx.bulbs` (or `lifx.bulb`) or the only bulb found.
6. `/reset` deletes every file in `busy-light/` (tokens, state, `light.json`) and leaves a `reset-pending` marker there; the platform removes every cached accessory on its next start and deletes the marker. The page then replaces the platform block with the defaults through `updatePluginConfig()`; the host's SAVE persists it.
7. The page never sends the server a value it did not need for that one call, and the server writes nothing to `config.json`: every configuration change goes through the page's `updatePluginConfig()` and the host's SAVE.
8. The UI server writes no log lines; every outcome goes back to the page in the response.
9. `/input/info` (from build 3): `port` is the saved `statusInput.port` in `config.json`, or the default; the page builds its addresses from the port it is editing. It answers `{ "error": "other", "message" }` only when `busy-light/` cannot be written for the instance id. `/input/test` sends the test report of 10.2 (signed with the key, so the key itself never crosses even the loopback interface, and `ttlSeconds` 30). A port or key that breaks 9.1 rule 17 answers `other` with `The port or the key is not valid.` without sending anything. `notListening` is a refused connection, `unauthorized` a 401 `unauthorized`, and anything else (including `replayed`, `plain_key_off` or `rate_limited`) is `other` with the API's own message.
10. `/input/info` (from build 3.1): the host name check of 18.11 is cached for 10 minutes. `addressChange` is the state file's `statusInput.addressChange` while `config.json` is older than it, and null once `config.json` has been written since (the host's Save writes it), or when there is none.

## 11. Settings page (build 2)

From build 2, `config.schema.json` sets `"customUi": true` and keeps the full schema (Homebridge still uses it to check the block). The page is `homebridge-ui/` built on the shared shell, structured as `homebridge-generac`'s (`src/` compiled by `scripts/build-ui.mjs` to `public/`). There is no separate design prototype: the shell code and rules in `homebridge-notify-switch` and `homebridge-generac` are the design, the banner and footer mark in `assets/` are Busy Light's own, and this section supplies the content.

For build 2, `reference/` held the sibling code and shell documents copied into the repository to build from. It was deleted in build 2's last commit.

### 11.1 Anatomy, top to bottom

1. Banner (`assets/busy-light-banner.png`, served beside the bundle), the only place the plugin carries color apart from the status swatches.
2. Intro (11.3 A), then the affiliation line, muted.
3. **Right now**: a read-only status row (11.3 B), refreshed from `/status` every 15 seconds while the page is open.
4. **Calendars**: heading, one line of help, one card per source (11.3 C), then the ADD CALENDAR button, which opens the shell's chooser tiles with four choices (Outlook or Microsoft 365 then shows its two options inline, 11.3 C). A new card opens expanded and its Name field takes focus.
5. **Status from other apps** (from build 3): heading, help with its link, the checkbox and what it shows when ticked, then "Apps reporting now" and the On a Call switch (11.3 I).
6. **Colors**: heading, two lines of help, one card holding a row for each status the setup can produce, in the precedence order of 6.3, a line to show the others, and from build 3.2 Warn before meetings (11.3 D).
7. **Lights**: heading, the LIFX bulbs card (from build 3.2; the LIFX bulb card before), then "Other lights in the Home app" (no card): the sensors checklist and a three-step automation example, and from build 3.2 the Working switch checkbox (11.3 E).
8. **Settings**: heading and a single collapsed Advanced disclosure (11.3 F).
9. Closing line, then the credit footer with `assets/busy-light-footer.svg` inlined at 20 px.

Desktop max width 800 px in the host modal; phone width 390 px collapses the grid to one column. Both host themes.

### 11.2 Shell invariants

Inherit, in full: `homebridge-notify-switch` `design/HANDOFF.md`, `design/BUILD-CONTRACT.md` and `design/BUILD-CONTRACT-DEFINITIONS.md`, and `homebridge-generac` SPEC 11.2 with its additions. In short: no palette of its own, host variables for every color with the host's light and dark values as fallbacks, `:root` rules for anything that must win, the iframe never scrolls, no `vh` and nothing sticky or `position: fixed`, dialogs and confirmations inline (then `scrollIntoView({ block: 'center' })`), validation on blur with "{Label} is required." and the shape-and-fix messages of 11.3 H, the issues summary in the page flow after Settings, a draft only after a change and never holding a credential, sentence case with uppercase buttons from `text-transform` only, italic "e.g." placeholders, no em dashes, no emoji, and no `crypto.randomUUID` (unavailable over plain http).

Busy Light additions:

1. The status swatches in Right now and Colors carry the user's colors. Everything else uses host variables.
2. Source state pills use the host's success (Connected), secondary (Checking, Not saved yet), warning (Sign-in needed) and danger (Not reachable) subtle variables.
3. A new card needs an id before it is saved, for its Microsoft token file: `cal-` followed by `Date.now().toString(36)` and four random base-36 characters from `Math.random()`. The id is written into the block and never changes, including on rename (9.1 item 2).
4. Secret fields (App-specific password, Secret address in iCal format) are password inputs with Show and Hide. They hold what `getPluginConfig()` returned; drafts never hold them (shell rule).
5. Connect, Test and Search are the only actions that reach the network, and only when pressed; the bulb search also runs once when "Use LIFX bulbs" (before build 3.2, "Use a LIFX bulb") is ticked. Opening the page calls only `/version` and `/status`, and `/input/info` when the status input is saved on (11.3 I shows the addresses whenever its box is ticked).
6. Each card's state pill comes from the state file's entry with the same id. A card that is not in the saved configuration shows "Not saved yet" instead. Changes on the page apply after Save and a Homebridge restart; the Right now row always describes the running plugin.
7. The Microsoft code view replaces the card body in place and hands back to the card when it ends, as Generac's Connect flow does. Polling `/microsoft/poll` every 3 seconds stops when the view closes.
8. Calendar cards open and close from their header, which is one button with the shell's disclosure glyph. Saved cards start closed; a new card opens expanded. There is no per-card help toggle: 11.3 C defines the header without one.
9. A field's message appears once it has been left (or, for a checkbox or a calendar list, changed); the issues summary after Settings lists every issue at once, a new card's included, so Save is never disabled without a reason on the page.
10. The Right now swatch uses the saved colors, which are what the running plugin sends, not unsaved edits.
11. From build 3.2, the message that leaving a field shows (item 9) waits while a pointer button is down, and shows once the pointer is released and its click has landed, or after 5 seconds when no release comes (one outside the frame, say). So a button below an empty required field stays put between press and release, and the click lands: in build 3.1 the message moved the button down before the release, and the click was lost (17). Leaving a field with the keyboard shows its message at once, as before.

### 11.3 Copy (verbatim)

**A. Intro**

- Banner alt text: `Busy Light for Homebridge: your calendar and Teams status on a light.`
- Intro 1: `Busy Light shows whether you are free on a light. It reads your calendars and, if you use Microsoft 365, your Teams status, then sets a color for each.`
- Intro 2: `Add at least one calendar, then choose how the light is controlled.`
- Affiliation: `Not affiliated with or endorsed by Apple, Google, Microsoft or LIFX.`
- Closing: `Your status also appears in the Home app as sensors. Use them in automations to set any other light or scene.`

**B. Right now**

- Heading: `Right now`
- Row: the status swatch, the display name of 6.2, then one muted line:
  - With a source and `until`: `Until {when}, from {source}.`
  - With a source and no `until`: `From {source}.`
  - Decided by Teams presence: `From Teams.` (with `until`: `Until {when}, from Teams.`)
  - Decided by a status input report (18): the source is the sender's name, and with an app the line reads `From {sender} ({app}).`
  - Available with nothing on any calendar: `Nothing on your calendars until {when}.` or, with no later event, `Nothing on your calendars right now.`
  - Override switch on: `The override switch is on.`
  - During the meeting warning (from build 3.2, 6.7) the status stays Available and the line is `A meeting starts at {time}.`
- `{when}` (from build 3.2) is the `until` time with its day when it is not today, as 11.3 G gives it, so a Friday afternoon with nothing until Monday morning does not read as a time later today.
- Not working (from build 3.2, 6.6): the Off swatch, the name `Not working` and the line `The Working switch is off.`
- No calendars saved: `Add a calendar to see your status here.` (no swatch). With the status input or the On a Call switch saved on, the status row shows instead (6.5 item 5).
- No state file yet: `Busy Light has not started yet. Save, then restart Homebridge.` (no swatch)
- Unknown (warning tone): `Status unknown. None of your calendars could be read.`
- State file older than 5 minutes, added under the row: `Last updated {relative time}. Is Homebridge running?`

**C. Calendars**

- Heading: `Calendars`
- Help: `Add every calendar that should count. Events from all of them are combined.`
- Empty: `No calendars yet.`
- Add button: `Add calendar`
- Chooser tiles, title and help:
  - `iCloud`: `Calendars in your Apple account.`
  - `Google Calendar`: `One Google calendar, by its secret address.`
  - `Outlook or Microsoft 365`: `Outlook calendars, by a published link or by signing in.`
  - `Calendar URL`: `Any calendar link that starts with https:// or webcal://.`
- Choosing `Outlook or Microsoft 365` (from build 3.1) shows two options inline below the tiles, in this order:
  - `Published calendar link`, with the badge `Recommended` (success tone) and the text `Works with any Outlook or Microsoft 365 calendar, with no IT approval. Shows busy, tentative and out of office.` It adds an Outlook card (below).
  - `Sign in with Microsoft 365`, with the text `Also shows your Teams status, such as in a call. Your IT department must approve Busy Light first.` It adds a Microsoft 365 card, unchanged.
- Card header: the name (`New calendar` until named), a type badge (`iCloud`, `Google Calendar`, `Microsoft 365`, `Calendar URL`), a state pill (`Connected`, `Checking`, `Sign-in needed`, `Not reachable`, `Not saved yet`), and the meta `Last checked {relative time}`. A state-file `error` shows under the header in the pill's tone.
- Every card: `Name` (required, placeholder `e.g. Work`, help `A name for this calendar. It appears in the log.`). Footer text button `Remove`, inline question `Remove {name}?` with `Remove` (danger) and `Cancel`.
- Every card (from build 3; a select from build 3.1): an Advanced disclosure at the bottom of the card body with the select `Check for changes every`, styled as `Counts for`. Options: `Same as Settings ({duration})`, the default, which saves no `calendarSeconds`, with `{duration}` the Reload calendars every value of 11.3 F as edited, formatted as in 11.3 G and following it live; then `1 minute`, `2 minutes`, `3 minutes`, `5 minutes` and `10 minutes` (60, 120, 180, 300 and 600 seconds). Help `How often Busy Light looks for new or changed events on this calendar.` A saved value not in the list (for example 90, typed in an earlier build) is one more option with its formatted duration (`1 minute 30 seconds`), selected, so it is never lost; it sits among the others in order of duration, and leaves the list once another option is chosen and saved (a page opened after Save no longer has it). A value outside the plugin's range, possible only by hand, is shown and written back the same way, and the plugin falls back with its warning as before. The disclosure opens by itself when the card has its own value.
- `Counts for` (select) with `Busy and out of office` and `Out of office only`, help `Out of office only uses this calendar's out of office events and ignores the rest. Useful for a family calendar.` It sits on each ticked calendar row (iCloud, Microsoft 365) and on the card itself (Google Calendar, Calendar URL).

iCloud card:

- `Apple ID email` (required, placeholder `e.g. you@icloud.com`)
- `App-specific password` (required, password field) with help `Not your Apple ID password. Create one at account.apple.com under Sign-In and Security, then App-Specific Passwords.` and the link `How to create one` (`https://support.apple.com/en-us/102654`, new tab).
- Button `Connect` (busy `Connecting…`); once connected it reads `Refresh list`.
- Errors: rejected `iCloud did not accept that Apple ID and app-specific password. Check both, or create a new app-specific password.`; network `Could not reach iCloud. Try again in a minute.`; unexpected `iCloud answered in a way Busy Light did not expect. Try again, and report an issue if it keeps happening.`
- Subheading `Calendars to use`, help `Tick the calendars that should count. Calendars you add to iCloud later stay off until you tick them here.`
- Row: checkbox, the calendar name, the meta `{n} events today` (`1 event today`, `No events today`, or nothing when null), and badges `Shared with you` and `New` (in the list from Connect but neither in the saved list nor ticked before on this page).
- A subscribed calendar's row is disabled with the line `Subscribed calendar. Add its address as a Calendar URL instead.`
- Before Connect on a saved card, the rows are the saved calendars, ticked, with the line `Connect to see all your calendars.`
- A saved card from build 1 whose list holds names only shows those names, ticked, with the same line.
- Validation after Connect when none is ticked: `Choose at least one calendar.`

Google Calendar card:

- `Secret address in iCal format` (required, password field) with help `In Google Calendar settings, pick the calendar, then Integrate calendar. Treat it like a password.`
- `Your Google email` (optional, placeholder `e.g. you@gmail.com`) with help `Lets Busy Light ignore invitations you declined.`
- `Counts for`
- Button `Test` (busy `Testing…`). Result `Read the calendar: {n} events today.` (`1 event today`, `no events today`).

Outlook card (from build 3.1): `Published calendar link` adds a Calendar URL card named `Outlook`, with a steps block (shell Step component) above the `Address` field:

1. `Open Outlook on the web and go to Settings, Calendar, Shared calendars.`
2. `Under Publish a calendar, choose your calendar and Can view when I'm busy, then select Publish.`
3. `Copy the ICS link and paste it below.`

Then the help `If Publish a calendar is missing, your organization has turned it off. Ask IT, or use Sign in with Microsoft 365.` and the link `Open Outlook on the web` (`https://outlook.office.com/calendar/`, new tab). The steps, help and link sit between Name and Address, and the Address takes focus, since the name is filled in. The card is otherwise an ordinary Calendar URL card: the address is a secret (never logged; host name only), Test works as below, and `Counts for` and the interval apply. Any other Calendar URL card whose address's host is `outlook.office365.com`, `outlook.office.com` or `outlook.live.com` shows the same steps, help and link collapsed under the disclosure `How to get this link`. Nothing else changes for it.

Calendar URL card:

- `Address` (required) with help `Any calendar link that starts with https:// or webcal://.`
- `Counts for`
- Button `Test`, with the same result line.
- Test errors (both cards): insecure `Use an address that starts with https:// or webcal://.`; notCalendar `That address did not return a calendar.` and, on a Google card only, the second sentence `Copy the Secret address in iCal format, not the public address.`; http `{host} answered with an error ({code}).`; network `Could not reach {host}.`; tooLarge `That calendar is over 10 MB, which is more than Busy Light reads.`

Microsoft 365 card:

- Muted note at the top: `Needs an app registration from your Microsoft 365 administrator.` with the link `What do I ask for?` (`https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/microsoft-365-admin-request.md`, new tab).
- `Directory (tenant) ID` and `Application (client) ID` (required, monospace, placeholder `e.g. 00000000-0000-0000-0000-000000000000`)
- Checkboxes `Use Teams status` and `Use Outlook calendars`
- Button `Connect` (busy `Getting a code…`); once connected, a `Disconnect` text button with the inline question `Sign out of Microsoft 365 on this Homebridge? Busy Light stops reading these calendars and your Teams status until you connect again.` and `Disconnect` (danger) and `Keep`.
- Code view title `Sign in to Microsoft 365`, body `Open the Microsoft sign-in page, enter this code, and sign in with your work account.`, the code in large monospace, buttons `Copy code` (then `Copied`) and `Open Microsoft sign-in` (the `verificationUri`, new tab) and the text button `Cancel`, and the line `Waiting for you to finish signing in…`.
- Code expired: `The code expired. Connect again to get a new one.`
- Refused: `Microsoft did not allow the sign-in: {reason}. This needs your Microsoft 365 administrator.` and the link `Instructions to send them` (the help address).
- Network: `Could not reach Microsoft. Try again in a minute.`
- Signed in: the card returns with the `Connected` pill and, when `Use Outlook calendars` is on, the subheading `Calendars to use`, help `Tick the calendars that should count. Calendars added later stay off until you tick them here.`, rows as for iCloud with the badges `Default`, `Shared with you` and `New`. Before the first Connect on a page load, `Connect to see all your calendars.`
- Not signed in when listing: `Sign in again to see your calendars.`
- A saved Microsoft source with no `calendars` list reads the default calendar (9.1 item 14); its card shows `Your default calendar.` in place of the rows until Connect.

**D. Colors**

- Heading: `Colors`
- Help: `The color the light shows for each status. Choose Off to turn the light off instead.`
- A second help line (from build 3.2): `To light up only during meetings, choose Off for Available.`
- One row per status (from build 3): the display name of 6.2 and a group of preset swatches, as a radio group: `Red` `#FF0000`, `Orange` `#FF6A00`, `Yellow` `#FFD000`, `Green` `#00FF00`, `Blue` `#0050FF`, `Purple` `#B400FF`, `White` `#FFFFFF`, `Off`, and `Custom`. The configuration format does not change: colors stay `#RRGGBB` or `off`.
- Each swatch is a button showing its color (Off as an outlined circle with a line through it, Custom as a swatch of the current custom color with the label), with the name as its accessible label and aria-checked for the chosen one. Arrow keys move between them; the names appear as tooltips and, below 600 px, as text under each swatch.
- A saved color equal to a preset (without regard to case) selects that preset. Any other `#RRGGBB` selects Custom.
- Choosing Custom shows the browser's color picker and the hex field (monospace) beside it, with the validation `Enter a color as #RRGGBB, for example #FF0000.` They are hidden otherwise.
- The defaults of 6.2 are presets: Out of office Purple, Do not disturb, In a call and In a meeting Red, Busy Orange, Tentative and Away Yellow, Available Green, Offline Off. `Reset colors` restores them.
- The statuses shown (from build 3.1, narrowed in build 3.2). A status can happen with the configuration on the page, as edited, and the reports the running plugin has seen: Out of office, In a meeting, Tentative and Available always; In a call while the On a Call switch is on, `Let other apps set your status` is on, or a Microsoft 365 source has `Use Teams status` on; Do not disturb, Busy, Away and Offline while a Microsoft 365 source has `Use Teams status` on, or an app has reported that status through the status API in the last 30 days (the state file's `statusInput.reported`, 10.1 item 8). Turning on `Let other apps set your status` alone no longer shows those four. Rows show for the statuses that can happen, in the precedence order. The others are hidden behind a line below the rows, `{n} more statuses come from Teams or from other apps.` (with one, `1 more status comes from Teams or from other apps.`), with the link `Show all statuses`; while they are shown, every row is in the precedence order and the link reads `Show fewer`. The rows change as the status input, the On a Call switch or a Microsoft 365 source's Teams status is turned on or off, and when a `/status` answer shows a status reported for the first time in 30 days. Hidden rows keep their saved colors, and `Reset colors` resets all nine. There is no Teams only badge. The line sits below the rows and above the precedence line, and is absent when every status can happen; shown or not is page state for the visit.
- Choosing Custom keeps the current color (after Off, the row's last custom color on this page, or white). A custom color equal to a preset stays under Custom while the page is open. The chosen swatch carries a ring in the text color, so it reads in both themes. Arrow keys wrap around; Home and End go to the first and last swatch.
- Line under the rows: `When more than one applies, the one highest in this list wins.`
- Text button `Reset colors` (no confirmation; the draft keeps the previous values until Save).
- `Warn before meetings` (from build 3.2, 6.7), a select at the bottom of the card below `Reset colors`, styled as `Counts for`: `Off` (the default, 0), `1 minute`, `2 minutes`, `3 minutes` and `5 minutes` (60, 120, 180 and 300 seconds), with the help `The light fades from the Available color to the In a meeting color before a meeting starts.` A saved value not in the list, possible only by hand, is one more option with its formatted duration, as for the intervals (11.3 C), and the plugin falls back to no warning with its warning line.

**E. Lights**

- Heading: `Lights`
- LIFX card title: `LIFX bulbs` (from build 3.2, C8 of the build prompt; one card for every bulb)
- Checkbox: `Use LIFX bulbs`. Ticking it starts a search at once.
- Searching: `Looking for LIFX bulbs on your network…`
- One found: `Found {label} ({ip}). Busy Light will use it.` With `lifx.bulbs` empty it is ticked by itself, as before build 3.2: its serial number is saved in `lifx.bulbs`. When `lifx.bulbs` names other bulbs and not this one, it is listed with its checkbox, unticked, below their lines (the next item), with no heading line.
- Several found: `Found {n} bulbs. Choose the ones to use:` then one checkbox per bulb, `{label} ({ip})`, ticked for each bulb in `lifx.bulbs`. The choice is saved as the bulbs' serial numbers in `lifx.bulbs`, in the order found, and `lifx.bulb` is dropped. A bulb saved by its name is ticked when its name matches and saved by its serial number from then on.
- With "Use LIFX bulbs" on and several found, none ticked is a field error on the list (H): `Choose at least one bulb, or turn off Use LIFX bulbs.`
- None found: `No LIFX bulb found. Check that it is on and on the same network as Homebridge.`
- The saved bulb not among those found: `{label} was not found just now. It may be switched off.` From build 3.2, one line per saved bulb not found; each stays ticked in `lifx.bulbs`.
- With "Use LIFX bulbs" on, no IP address under Advanced, and no search yet in this visit (from build 3), the results line comes from the state file's `light` (10.1), read through `/status`; from build 3.2 one line per entry of `lights`:
  - With a `label` and `host` and `answered` true: `Busy Light is using {label} ({host}).`
  - With a `label` and `host` and `answered` false: `Busy Light is using {label} ({host}), but it did not answer last time.`
  - With no light in the state file (the plugin has not found one, or has not run since LIFX was turned on): `Busy Light has not found a bulb yet. Search again to look for one.`
  - `{label}` is the host when the state file has no label. `answered` null (nothing sent yet) reads as answering; only false gives the second line. A `light` that is off or has no host gives the third. Nothing shows until the first `/status` answer, and each answer redraws the line in place until a search replaces it.
- Text button `Search again`, below the results line. A search replaces the line with its results.
- `Brightness (percent)` (1 to 100)
- Button `Test light` (busy `Testing…`), help `Shows red, then green, on each bulb chosen.` (from build 3.2; before it, the help named one bulb); it tests every ticked bulb (or every address under Advanced) at the same moment. With one bulb the results are `The bulb answered.` and `No answer from the bulb. Check that it is on and on the same network as Homebridge.`; with several, one result per bulb, in order: `{label} answered.` (success tone) or `No answer from {label}. Check that it is on and on the same network as Homebridge.` (danger tone). `{label}` is the bulb's name, or its address when it has none.
- Advanced disclosure inside the card:
  - `Bulb not found? Enter its IP address.` as the help of `Bulb IP address` (placeholder `e.g. 192.168.1.50`), followed by `Only needed when the search cannot reach the bulbs, for example when Homebridge runs in Docker without host networking. Separate several addresses with commas.` (from build 3.2; before it, the help named one bulb and had no second sentence). When filled in, the search results are hidden and the line `Busy Light will use the bulb at {ip}.` shows instead, once per address.
  - `Send the color again every (seconds)` with help `Recovers a bulb that was switched off at the wall. 0 sends only when the status changes.`
- Subheading: `Other lights in the Home app`
- Text: `Busy Light cannot control other HomeKit lights itself. It adds sensors to the Home app, and an automation there sets the light.`
- `Sensors to create`: checkboxes `{name} Available`, `{name} Busy`, `{name} Out of Office` (ticked by default), then a disclosure `Show all statuses` with the others in the order of section 7. From build 3.1, the statuses that cannot happen with the configuration on the page (11.3 D) come after the others there, each with the help `Nothing in your setup reports this yet.`; they can still be ticked. The three roll-ups are unchanged. From build 3.2 the optional Meeting Soon sensor of section 7 is the last of the others, with the help `Detects occupancy during the warning before a meeting.`; it can happen once `Warn before meetings` is not Off, and otherwise comes with those that cannot, its help followed by `Nothing in your setup reports this yet.`
- Steps (shell Step component):
  1. `In the Home app, add an automation: A sensor detects something.`
  2. `Choose {name} Busy, then Detects occupancy.`
  3. `Set your light to red.`
- Below the steps (from build 3.2, 6.6), the checkbox `Add a Working switch to the Home app`, with the help `Turn it off at the end of the day, for example in a Home scene, and the light stays off whatever your calendars say. Turn it on when you start work.`

**F. Settings (Advanced disclosure)**, in this order:

- `Name` (required, default `Busy Light`), help `Starts the name of every sensor, for example "Busy Light Available".`
- `Check status every`, a select (from build 3.1) styled as `Counts for`: `15 seconds`, `30 seconds (default)`, `1 minute`, `2 minutes`, `4 minutes` (15, 30, 60, 120 and 240 seconds)
- `Reload calendars every`, a select (from build 3.1): `1 minute`, `2 minutes`, `3 minutes (default)`, `5 minutes`, `10 minutes` (60, 120, 180, 300 and 600 seconds)
- For both, `config.json` keeps seconds, and a saved value not in the list is one more option with its formatted duration, selected, as on a calendar card (11.3 C).
- `Ignore all-day events marked busy` (default on), help `All-day out of office events always count.`
- `Out of office words` (list, default Out of office, OOO, Vacation, PTO), help `iCloud, Google and URL calendar events with one of these words in the title count as out of office.`
- `Override switch` (default off), help `Adds a switch to the Home app that forces Do not disturb while it is on.`
- `Debug logging` (default off), help `Verbose logging. Passwords, calendar addresses and event titles are never logged, even with this on.`
- `Reset plugin to fresh install`; dialog lines `Signs out of Microsoft 365 and removes the saved sign-in.`, `Removes every Busy Light sensor and switch from the Home app.`, `Clears all settings on this page.`; done state title `Reset done`, body `Click Save, then restart Homebridge.`

**G. Shell strings** (shared with the other plugins, as in `homebridge-generac` SPEC 11.3 F)

- Disclosure summary: `Advanced`
- Reset: button `Reset plugin to fresh install`, dialog title `Reset plugin to fresh install?`, prompt `Type RESET to confirm.`, button `Confirm`, text button `Cancel`
- Password field toggle: `Show`, `Hide`
- Credit footer: `Busy Light v{version}`, `Made by Alex Rodriguez`, `alex-rodriguez.com` (`https://alex-rodriguez.com/?ref=busy-light#building`), `Report an issue` (`https://github.com/arodbuilds/homebridge-busy-light/issues`)
- Relative times: `just now`, `1 minute ago`, `{n} minutes ago`, `1 hour ago`, `{n} hours ago`, `1 day ago`, `{n} days ago`
- Durations (from build 3.1): whole minutes as `1 minute` or `{n} minutes`; under a minute as `{n} seconds`; anything else as `1 minute {s} seconds` or `{m} minutes {s} seconds`. The default of a list is marked `{duration} (default)`.
- Times: 12-hour in the host's locale, for example `1:00 PM`
- When (from build 3.2): a time that is not today carries its day: `tomorrow at {time}`, `{weekday} at {time}` within the next 6 days, and `{Month day} at {time}` beyond. Today it is `{time}` alone. Weekdays and months are named in English, as the rest of the page is (Monday, October 16). Days are counted by the calendar in the browser's time zone, and the plugin counts them in the host's (section 12).
- Failures of the host itself: `Could not load the configuration.`, `Could not update the configuration.`
- Draft banner (shell rule M1, as in `homebridge-notify-switch` 11.3): `You have unsaved changes from earlier. Restore them?` with the buttons `Restore` and `Discard`
- Summary box (shell rule F4, as in `homebridge-notify-switch` 11.3): `Fix these before saving:`, one entry per issue reading `{Card name}: {message}` (a calendar's name, or `Status from other apps`, `Colors`, `LIFX bulbs` (from build 3.2) or `Settings` for the fields outside a calendar card), collapsed past three entries to `{n} fields need attention` (`1 field needs attention`) with the toggle `Show all`, then `Hide`

**H. Validation** (on blur; the summary box lists the same messages)

- Empty required field: `{Label} is required.` with the field's own label.
- Two calendars with the same name: `Another calendar already uses this name.`
- Apple ID email or Google email that does not look like one: `That does not look like an email address.`
- Address not starting with `https://` or `webcal://`: `Use an address that starts with https:// or webcal://.`
- Tenant or client ID: `Enter it as 00000000-0000-0000-0000-000000000000.`
- Color: `Enter a color as #RRGGBB, for example #FF0000.`
- Numbers: `Enter a whole number from {min} to {max}.`
- Bulb IP address: `Enter an IP address such as 192.168.1.50, or a host name.` (from build 3.2, when any of its comma separated addresses is not one)
- LIFX bulbs on, several found and none ticked (from build 3.2): `Choose at least one bulb, or turn off Use LIFX bulbs.`
- Microsoft 365 with both checkboxes off: `Turn on Use Teams status, Use Outlook calendars, or both.`
- A second Microsoft 365 card with Use Teams status on: `Only one Microsoft 365 calendar can use Teams status.`
- Calendars to use, after Connect, none ticked: `Choose at least one calendar.`

**I. Status from other apps** (from build 3, section 18)

- Heading: `Status from other apps`
- Help: `Let other apps on your network tell Busy Light you are on a call or busy, for example Jeronimo on your Mac or a Stream Deck button.` (Jeronimo named from build 3.2), with `Jeronimo` a link to `https://jeronimo.app` (new tab), and the link `How apps connect` (`https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/status-input.md`, new tab). Naming Jeronimo is copy only: nothing in the status input depends on it.
- Checkbox: `Let other apps set your status`
- When ticked:
  - When the address changed (18.11 item 6, from build 3.1), above the Address line in the warning tone: `Homebridge's address changed from {old} to {new}. Apps that use the old address need the new setup code.`
  - `Address`: read-only, monospace, `http://{host name}:{port}` first when there is a host name, then `http://{ip}:{port}`, one line per address from `/input/info`. From build 3.2 each line has its own button `Copy` (then `Copied`), beside it, which copies that address, as the Key and Setup code have theirs
  - With no host name, the help `Your router may give Homebridge a new address later, and apps would stop reaching it. Reserve this address for Homebridge in your router.`
  - `Key`: read-only password field with `Show` and `Hide`, and the button `Copy key` (then `Copied`)
  - `Setup code`: read-only, monospace, `busylight://{host}:{port}/?key={key}&id={id}` (the host name, or the first address, as 18.11), masked like the Key field and sharing its `Show` and `Hide` (from build 3.1): one Show reveals both, one Hide masks both. Masked, it shows one dot per character, so it wraps as the code would; shown or masked holds through a redraw of the section until the page is reloaded. The button `Copy setup code` (then `Copied`) copies the full code, masked or not, and the help `Paste this into the app that will report your status. It contains your key, so treat it like a password.`
  - Text button `Replace key`, inline question `Replace the key? Every app using the current key stops working until you give it the new one.` with `Replace` (danger) and `Cancel`
  - Button `Test` (busy `Testing…`), help `Reports a call for 30 seconds, so the light should turn red.`; results `Busy Light received the test.`, and for `notListening` `Busy Light is not listening yet. Save, restart Homebridge, then test again.`, for `unauthorized` `The running Busy Light has a different key. Save and restart Homebridge, then test again.`
  - State-file error: `Busy Light could not open port {port}. Another program may be using it. Choose another port under Advanced.`
  - Checkbox `Allow the plain key`, ticked by default, help `Apps that sign their requests never send the key. Apple Shortcuts and curl send the key itself, so anyone watching your network could copy it. Turn this off once every app below shows Signed. If the key may have been seen, replace it too.`
  - Advanced disclosure: `Port` (1024 to 65535, default 8582), help `Change it only if another program on this computer already uses {port}.`
- Subheading: `Apps reporting now`
  - Empty: `No app has reported in the last 12 hours.`
  - Row: the sender name; the status display name, and ` from {app}` when there is one; the meta `Last heard {relative time}`; the badge `Active` (success tone), or, from build 3.2, `Cleared` (secondary tone) when its last word was `clear` (the On a Call switch turned off included), or `Expired` (secondary tone) when its report ran out (the state file's `ended`, 10.1 item 8); and the badge `Signed` (secondary tone) or `Plain key` (warning tone) for how its last report authenticated. The Home app switch appears as the sender `Home app`, with no authentication badge.
- Checkbox: `Add an On a Call switch to the Home app`, help `Turn it on from a shortcut, Siri or a Home tile while you are on a call. Useful for apps that should not make network requests themselves.`
  - When ticked: `Turn it off by itself after (hours)` (1 to 12, default 3)
- Validation (11.3 H style): port `Enter a whole number from 1024 to 65535.`; hours `Enter a whole number from 1 to 12.`

The page generates the key when the checkbox is first ticked and no key exists. Changes apply after Save and a Homebridge restart, as everywhere on the page.

1. The section has no card. Apps reporting now shows whether or not the box is ticked, since the switch reports there too, and redraws in place after each `/status` answer without moving focus.
2. Test: no answer from the UI server reads as `notListening`. An `other` result shows the API's own message as data (this section has no string for it).
3. The port help always names the default port 8582.
4. A stored key that breaks 18.8 item 1 (possible only by hand) is replaced by Replace key, or by ticking the box again. Restoring a draft with the input on and no saved key makes a new key, as ticking does.

## 12. Logging

Never logged at any level: passwords, app-specific passwords, tokens, device codes, calendar addresses (host name only), the status input key, and anything about an event except counts and times.

Lines, verbatim (`{}` are values):

| When | Level | Line |
| --- | --- | --- |
| Startup | info | `Busy Light {version}: {n} calendars, light {on at host\|on ({n} bulbs)\|on\|off}, {m} sensors.` (`on` while the bulb is still being found; from build 3.2 `on ({n} bulbs)` when more than one bulb is chosen) |
| No sources | warn | `No calendars are set up yet. Open the plugin settings to add one.` |
| Status change | info | `Status: {Display name} ({source}, until {when}).` The parenthesis is omitted when there is no reason, and `until` when there is no time. `{when}` (from build 3.2) is `{h:mm AM/PM}` today, else `tomorrow at {h:mm AM/PM}`, `{weekday} at {h:mm AM/PM}` within the next 6 days, or `{Month day} at {h:mm AM/PM}`, as 11.3 G. Not written for `notWorking` (6.6). |
| Unknown | warn | `Status unknown: none of your calendars could be read.` |
| iCloud discovery | info | `{name}: calendars found: {a, b, c}. In use: {a, b}.` (an empty list is `none`) |
| Source failed | warn | `{name}: could not be read ({short reason}). Trying again in {n} minutes.` |
| Source recovered | info | `{name}: working again.` |
| New calendars | info | `{name}: calendars not in use: {a, b}. Tick them in the plugin settings to use them.` (once per discovery, only when the source has a non-empty `calendars` list and calendars outside it exist) |
| Listed calendar gone | warn | `{name}: the calendar "{calendar}" was not found. It may have been deleted or unshared.` (once, until it is found again) |
| iCloud 401 | warn | `{name}: iCloud did not accept the Apple ID and app-specific password. Check them in the plugin settings.` |
| Microsoft code | warn | `{name}: Microsoft sign-in needed. Open {verificationUri} and enter the code {userCode}.` |
| Microsoft done | info | `{name}: signed in to Microsoft 365.` |
| Microsoft refused | warn | `{name}: Microsoft did not allow the sign-in: {reason}. This needs your Microsoft 365 administrator. Instructions to send them: {help address}` |
| Microsoft gave up | warn | `{name}: the sign-in code was not used. Restart Homebridge or run "homebridge-busy-light login" to try again.` |
| Bulbs found | info | `LIFX bulbs found: {label (ip), label (ip)}. Using {label, label}.` (from build 3.2 the bulbs in use, in the order of `lifx.bulbs`) |
| No bulb | warn | `No LIFX bulb was found on the network. Check that it is on, or enter its IP address in the plugin settings.` |
| Several bulbs | warn | `More than one LIFX bulb was found: {labels}. Choose the bulbs to use in the plugin settings.` (from build 3.2) |
| Bulb not named | warn | `No LIFX bulb named {bulb} was found. Bulbs found: {label (ip), label (ip)}.` (from build 3.2 for each bulb of `lifx.bulbs` not found, alone, while others are) |
| Bulb silent | warn | `The LIFX bulb at {host} did not answer.` (once, then debug until it answers; from build 3.2 for each bulb on its own) |
| Bulb back | info | `The LIFX bulb at {host} is answering again.` (from build 3.2 for each bulb on its own) |
| Validation | error or warn | `{path}: {message}` |
| Input started | info | `Status input is listening on port {port}.` |
| Input failed | error | `Status input could not start: port {port} is already in use.` (or `: {short reason}.` for any other failure) |
| Input key invalid | error | `statusInput.key: must be 32 to 128 letters, digits, hyphens or underscores` |
| Sender changed | info | `{sender} reports {Display name}.` or `{sender} reports {Display name} from {app}.` (when a sender becomes active, or its status or app changes, not on every repeat) |
| Sender cleared | info | `{sender} cleared its status.` |
| Sender expired | info | `{sender}'s status expired.` |
| Wrong key | warn | `Status input: refused a request with a wrong key from {ip}.` (any failed authentication except `clock_skew` and `plain_key_off`, and not `replayed`, whose key was right; once per address per hour) |
| Clock off | warn | `Status input: refused a request from {ip} whose clock is {n} seconds off.` (once per address per hour) |
| Plain key off | warn | `Status input: refused a request from {ip} that sent the key itself. Turn on Allow the plain key, or have that app sign its requests.` (once per address per hour) |
| Not local | warn | `Status input: refused a request from {ip}, which is not on the local network.` (once per address per hour) |
| Address changed | warn | `Homebridge's address changed from {old} to {new}. Apps that use the old address need the new setup code.` (once per change, 18.11 item 6) |
| Call switch timeout | info | `{name} On a Call turned itself off after {n} hours.` (also when it is turned off at startup because its time passed while Homebridge was down) |
| Working off | info | `{name} Working turned off. The light stays off until it is turned on.` (from build 3.2, 6.6; when the switch turns off, and once at startup when it is restored off) |
| Working on | info | `{name} Working turned on.` (from build 3.2, 6.6) |
| Repeat limit | warn | `{name}: a recurring event repeats too often to read in full, so some of its occurrences are left out.` (from build 3.2, 5.4 item 3; once per source, the first time a series reaches the cap) |

Times in log lines use the host's locale and time zone, 12-hour. From build 3.2 a time that is not today carries its day, counted by the calendar in the host's time zone, with weekdays and months named in English (`{when}` above).

1. A count is written with the singular noun when it is 1: `1 calendar`, `1 sensor`, `Trying again in 1 minute.`
2. In the bulb lines a bulb with no name is shown by its serial number. The bulb lines (found, no bulb, several, not named) are written only when the set of bulbs or the outcome changes.
3. With the `debug` option on, debug lines are written at info level, so they show without `homebridge -D`. Debug lines report counts and times only, for example `{name}: {n} events in the window.`
4. The "Status change" line is also written for the first status after startup. The Unknown line is written each time the status becomes unknown, and not when there are no calendars.
5. Every line is built in `src/messages.ts`.
6. Sender and app names are labels chosen by the sender and may be logged; nothing else from a request is.
7. The four refusal lines (wrong key, clock off, plain key off, not local) are throttled separately: each is written once per address per hour.

## 13. LIFX

LIFX LAN protocol over UDP port 56700. No LIFX account, no cloud.

### 13.1 Packets

1. Header, 36 bytes, little endian: size (uint16), then `0x3400` (protocol 1024, addressable, tagged), source (uint32, a fixed non-zero value), target (8 bytes of zero), 6 reserved bytes, flags (byte 22; bit 1 `ack_required`), sequence (byte 23), 8 reserved bytes, message type (uint16 at 32), 2 reserved bytes.
2. SetColor, type 102, 49 bytes: one reserved byte at 36, then hue, saturation, brightness and kelvin (uint16 each, from 37) and duration in milliseconds (uint32 at 45). Hue, saturation and brightness are the color's HSB scaled to 0 to 65535; brightness is further scaled by `lifx.brightness`. Kelvin is 3500.
3. SetPower, type 117, 42 bytes: level (uint16 at 36, 0 or 65535) and duration (uint32 at 38).
4. A color is sent as SetColor then SetPower on. `off` is SetPower off. Duration is 1000 ms on a status change and 0 on a refresh.
5. Each packet sets `ack_required` and waits up to 500 ms for an Acknowledgement (type 45) with the same sequence, trying three times. The bulb "answered" when the last packet of the send was acknowledged. Replies are matched by type and sequence on the client's own port, not by the source field, so a bulb that does not echo the source still counts as answering.
6. One socket is opened per send and closed afterwards; from build 3.2, one per bulb per send (13.3).
7. Once a bulb's serial number is known (13.2), packets to it are sent untagged (`0x1400`) with the serial as the target. Before that, or for a bulb given only by IP, they are sent tagged with a zero target.
8. The meeting warning (from build 3.2, 6.7) is sent as SetPower on with no duration, then SetColor of the In a meeting color with a duration equal to the time left until the meeting starts, in milliseconds: the bulb fades by itself. Before them, when the Available color is `off`, SetColor of the In a meeting color at 1 percent brightness with no duration, so the bulb comes on dim; when the status became Available in the same step, SetColor of the Available color with no duration, so the fade starts from it. Each packet is acknowledged as in item 5, and the bulb answered when the last was.

### 13.2 Finding the bulbs

1. Discovery: bind a UDP socket with broadcast enabled, send GetService (type 2, tagged, zero target) to `255.255.255.255` and to the broadcast address of every non-internal IPv4 interface, three times 500 ms apart, and collect StateService replies (type 3) for 2 seconds. Each reply's header target is the bulb's serial number (the first 6 bytes, written as 12 hex digits) and its sender address is the bulb's IP. Then ask each bulb found for its name with GetLabel (type 23) and read StateLabel (type 25, 32 bytes, UTF-8, zero padded). Only StateService replies for service 1 (UDP) count. A serial in `lifx.bulbs` (or `lifx.bulb`) may be written with colons or in upper case.
2. Choosing, at startup when `lifx.enabled` is on. From build 3.2 the bulbs wanted are `lifx.bulbs`, or a saved `lifx.bulb` as a list of one (9.1 item 6):
   1. `lifx.host` set: use each address in it, separated by commas, as a bulb, with no discovery. This is the fallback for networks where broadcast does not reach the bulbs.
   2. Otherwise, with bulbs wanted: use every remembered bulb (item 3) that one of them names, and discover when any of them is not remembered. Each bulb wanted is the bulb found whose name matches it without regard to case, or whose serial matches. A bulb wanted that is not found writes the "bulb not named" line for it alone while others are found (and the "no bulb" line when none is found at all), and is looked for again (item 4); the others are used meanwhile.
   3. With no bulbs wanted: the remembered bulb when there is exactly one, else discovery. Exactly one bulb found is used. With several found, none is used and the "several bulbs" line is written. With none found, the "no bulb" line.
3. The chosen bulbs' serials, names and last IPs are kept in `busy-light/light.json` (from build 3.2 `{ "bulbs": [{ "serial", "label", "host" }] }`, in the order of `lifx.bulbs`; before, one `{ "serial", "label", "host" }` object, which is still read as a list of one; mode 600), and those IPs are tried first at the next start so a restart does not wait on discovery: a remembered bulb is used at startup when it fits (item 2), and if its first send is not acknowledged, discovery runs at once. The CLI reads `light.json` but never writes it.
4. Discovery runs again, at most once every 5 minutes, while no bulb is chosen, a bulb wanted has not been found, or any chosen bulb has not answered three sends in a row. This is what lets a bulb change IP address without any reserved address in the router. When discovery finds a chosen bulb at a new address, the color is sent there at once. From build 3.2, a chosen bulb with a serial number is never replaced by a different bulb unless `lifx.bulbs` names that bulb: when discovery does not find the chosen bulb, it is kept, whatever else answers (it may be switched off at the wall), and discovery keeps looking for it by its serial number, so a new IP address is still found. The rule holds for every bulb in the list on its own. An entry of `lifx.bulbs` is found once any chosen bulb fits it, so two entries naming the same bulb (its name and its serial number) do not keep discovery running. Only while no bulb has ever been chosen (none this run, and none remembered in `light.json` that fits) does discovery pick one by the rules of item 2. Build 3.1 applied the rules of item 2 afresh when the chosen bulb went silent, so with `lifx.bulb` empty a kitchen bulb that answered could take over from the office bulb for good.
5. The "bulbs found" line is written when the set of bulbs or the chosen bulbs change, not on every discovery.

### 13.3 Several bulbs (from build 3.2)

C8 of the build prompt: the owner has two bulbs, Floor and Status Light, and every chosen bulb shows the status together.

1. Every send (a status change, a refresh, the meeting warning's fade, the Working switch turning the light off, a bulb chosen later) goes to every chosen bulb at the same moment, each on its own socket (13.1 item 6), with its own acknowledgements and tries. One silent bulb never delays, blocks or retries another: the bulbs that answer show the color as soon as their packets are acknowledged, and a silent bulb's tries and rediscovery run beside them. Each bulb has its own lane: a send to a bulb still trying an earlier one waits behind it, and a newer send replaces one still waiting, so a bulb that comes back gets the newest color once, and the plugin never waits for one bulb before sending the next color to the others.
2. Each bulb keeps its own count of sends in a row without an answer, its own "bulb silent" and "bulb back" lines, and its own `lastSent`, `lastSentAt` and `answered` in the state file's `lights` (10.1 item 5). Rediscovery (13.2 item 4) runs when any chosen bulb has missed three sends, at most once every 5 minutes; when it finds a bulb at a new address, only that bulb is sent the color again. Whatever started a discovery (a silent bulb, a bulb wanted and not found yet, a remembered address that did not answer), every bulb it finds at a new address is sent the last color, and a bulb whose send was trying while it ran sends that color to the new address itself.
3. Brightness and the refresh interval are one setting for every bulb. The meeting warning's fade lasts until the meeting starts on every bulb, by the clock, so a bulb that answers after rediscovery fades over the time left.
4. A bulb chosen later (8.2 item 4), by whatever discovery found it, is sent the last color at once (the meeting warning's fade over the time left, or the color with the 1 second fade), so every bulb shows the same color from then on.

## 14. Assets and branding

`assets/` holds the Claude Design export (direction 2C "Lit day", recorded in `assets/ICONS.md`): `busy-light-512.png`, `busy-light-192.png`, `busy-light-mark.svg`, `busy-light-dark.svg`, `busy-light-light.svg`, `busy-light-footer.svg`, `busy-light-banner.png` (1280 by 320) and `busy-light-social.png` (1280 by 640). Field `#36434F`, mark `#F2F2F3`, square `#3FBF6F`.

Banner text: "Busy Light for Homebridge" and "Your calendar and Teams status on a light. Green when you are free, red when you are not."

The README opens with the banner. Assets are referenced from the repository and are not shipped in the npm package, except what the settings page needs from build 2: the banner, which `scripts/build-ui.mjs` copies to `homebridge-ui/public/`. The footer mark is drawn inline from the page's own code and checked against `assets/busy-light-footer.svg` by a test.

## 15. Testing

All tests use `node:test`, run from `build-test/`, and never open a socket. From build 3.1, before a pull request the suite is also run once with `dgram.createSocket`, `net` and `fetch` replaced by functions that throw and record the attempt, and it must pass with nothing recorded; from build 3.2 `tls` and `dns.lookup` too.

1. Status: every rule of 6.3 in order, the all-day rule, cancelled events, boundaries (`start` inclusive, `end` exclusive), the override, freshness and Unknown, and the reason and `until` values.
2. iCalendar: a fixture with a time zone, a weekly series, a second weekly series with one moved occurrence (the two series must not share the exception), a free event, an all-day out of office match, a declined invitation, a cancelled event, an event outside the window, a `STATUS:TENTATIVE` event, a bad event that is skipped, and daylight saving on both sides of a change.
3. CalDAV: discovery and REPORT against recorded-shape fixtures with two different namespace prefix styles, a Reminders list that is dropped, a name filter, a 401, and rediscovery after a failure.
4. URL source: `webcal://` rewrite, `http://` refused, ETag and 304, oversize body, redirect to `http://` refused.
5. Graph: device code success, `authorization_pending`, `slow_down`, expiry and the three-code limit; refresh with rotation; `invalid_grant`; one shared refresh for concurrent calls; 401 retry; presence mapping; every row of the 4.3.1 table from both the device code request and the token poll, with the reason and help address in the log line and state file and no further codes issued; a Graph 403; calendar paging; all-day parsing; `Retry-After`.
6. LIFX: packet bytes for SetColor, SetPower, GetService and GetLabel, hex to HSB, brightness scaling, acknowledgement matching by sequence, three tries then "did not answer", tagged and untagged addressing, and discovery with a fake socket: one bulb, several bulbs with and without `lifx.bulb`, a match by serial, none found, the remembered IP tried first, and rediscovery after three silent sends when the bulb's IP has changed.
7. Platform: sensor set from configuration, stable UUIDs, removal of unwanted accessories, roll-up mapping, backoff schedule, the boundary timer, bulb refresh, and that Unknown leaves the bulb alone.
8. Config: every rule of 9.1, including the derived id and the fall-back-with-warning behaviour.
9. Redaction: a failing URL source's log line and state file error contain the host and never the path or query; no log line in any test contains an event title from the fixtures.
10. CLI: `check` and `status` against a temporary storage directory with `fetch` replaced.
11. Settings form: `config.schema.json` is valid JSON, every title and description matches the table of 9.2 and the `headerDisplay` above (read from this file), every field of the section 9 example is present, defaults match the plugin's, and each source type shows only its own fields.

12. Calendar choice (build 2): iCloud `calendars` as names, as objects matched by `id`, an `id` that no longer matches but a name that does, an empty list; Microsoft with no list (default calendar) and with two listed calendars, one answering 404; `use: outOfOffice` on each source type keeping only out of office events; the "New calendars" line written once.
13. UI server (build 2): every endpoint of 10.3 with a fake `fetch`, a fake LIFX network and a temporary storage directory, including every error key; that no response, log line or error carries a password, token, calendar address or event title; the Microsoft flow from start to done writing the same token file the plugin reads; cancel and the 15 minute expiry; `/reset` leaving only the marker.
14. Settings page (build 2), with a fake DOM as in `homebridge-generac` (`test/fake-dom.ts`, `ui-page.test.ts`): every string of 11.3 comes from one copy module and matches this file; each card type's fields and validation; Connect listing calendars with the `New` and `Shared with you` badges and writing the chosen list with ids and `use`; build 1 name-only lists shown ticked; the Microsoft code view and its four endings; the LIFX one, several and none cases writing `lifx.bulb` as a serial and the IP override hiding the search; the statuses shown (11.3 D); the draft holding no secret; Reset.
15. Layout (build 2): the headless check of `homebridge-notify-switch` SPEC 11.2 item 18 in both host themes at 800 and 390 pixels: contrast of secondary text and locked fields, no horizontal scroll, the iframe never scrolling. It runs as `npm run test:layout` (`test/layout/layout-check.mjs`), not as part of `npm test`: it needs Playwright with Chromium and the Homebridge UI's own stylesheet (`HOMEBRIDGE_UI_CSS`), neither of which the plugin depends on, so `npm ci` on the Pi installs no browser. From build 3 it also opens the Status from other apps section with the input on, Replace key's question, a test result and a sender of each kind, a calendar card's Advanced, and Custom and Off on the color rows, and counts the read-only Address and Setup code boxes as locked fields. From build 3.1 it also opens the chooser's Outlook options, a new Outlook card and an existing Outlook address with How to get this link, has the interval selects with a saved value not in their list and the address change notice, and measures each theme and width three times: everything open, then Colors collapsed (the status input, the On a Call switch and Teams status turned off on the page), then Colors expanded. From build 3.2 it also shows the Working switch checkbox ticked, Warn before meetings set, the Copy button on each address line with one clicked, a Cleared sender beside an Expired one, and it clicks Add calendar with the mouse under an empty Outlook card Address and expects the click to land (11.2 item 11); after Colors expanded it measures Right now three more times: in the meeting warning, Not working, and with a time on another day, so each theme and width is measured six times. With several bulbs (13.3) the LIFX bulbs card has a checkbox per bulb found, a saved bulb missing, and Test light's result for each bulb.
16. Status API (build 3), by calling the request handler directly with synthetic request and response objects (no socket is opened, per `CLAUDE.md`), plus the server's start and port-in-use paths with `http.createServer` mocked: every row of 18.4, every error key, the check order of 18.4 item 8, constant-time comparison used for both forms, the signature against the test vector of `docs/status-input.md` 2.4, a signature over a body that differs by one byte, `clock_skew` at 301 seconds both ways and acceptance at 300, `replayed` for an equal and a smaller `ts` with `lastTs` in the answer, `lastTs` never given away: for a sender with a replay entry, a request with a wrong signature, a malformed `Authorization` header, a `ts` outside the window, the plain key, and the plain key while it is off each get their own 401 (`unauthorized`, `clock_skew` or `plain_key_off`) with no `lastTs` field and no other sign of the entry, and the body is not parsed before authentication passes, a report captured during a call and sent again after `clear` and again after expiry (both `replayed`), a replay table entry outliving the 20-sender display list, entries dropped once 300 seconds old, the table surviving a reload of `inputs.json`, the startup floor when `inputs.json` is missing (refused before startup time, accepted after, gone after 300 seconds), a captured signed `GET /v1/status` answered twice (the stated exception), the plain key form with `allowPlainKey` on and `plain_key_off` with it off (the key not compared), the `auth` recorded per sender, the text rule of 18.4 item 3 ("Alex’s iMac" accepted, NFC and NFD forms of one name matching one sender, 64 code points of emoji accepted and 65 refused, each refused character class), `clear` with and without an active report and with `ttlSeconds`, the `id` in `/v1/ping`, 403 for a non-local address (by injecting the remote address into the handler), rate limit and `Retry-After`, the 20-sender limit, `clear`, expiry with a fake clock and the expiry timer, `inputs.json` reload with expired entries dropped, no CORS headers, `OPTIONS` 405, and that no log line or response contains the key.
17. Precedence with inputs (build 3): each status at its rule, combined with Teams presence and calendar events, rule 10 with and without an `offline` report, the reason naming the sender and app.
18. On a Call switch (build 3): on, off, the safety timeout, restore after restart with the time remaining and after the time has passed.
19. Settings page (build 3): the Status from other apps section (11.3 I), key generation format, Replace key, the setup code built from `/input/info`, Test, the sender list; the per-calendar interval (11.3 C); the color presets (11.3 D); the three lines of the bulb in use (11.3 E), and that opening the page with LIFX on makes no `/lifx/discover` call.
20. CLI `input`, `input --setup-code` and `input test` (with `fetch` mocked), and the UI server's `/input/info` and `/input/test` (with `os.networkInterfaces`, the multicast DNS socket, `dns.lookup` and `fetch` mocked: a host name that resolves to the host, one that resolves elsewhere, one that times out).
21. Per-calendar interval (build 3): two sources with different intervals reload on their own schedules.
22. Host name check (build 3.1, 18.11), with the `dgram` socket mocked: an answer with the host's own address, an answer with another address only, no answer, a malformed packet, a compressed name, a socket error, the `dns.lookup` fallback confirming and not, and the 10-minute cache.
23. Address change notice (build 3.1, 18.11 item 6): `statusInput.advertised` and `addressChange` in the state file, the log line once per change, nothing for a host name, and the page notice until `config.json` is saved.
24. Settings page (build 3.1): the masked setup code and its shared Show and Hide; the three interval selects (each option saves the right seconds, `Same as Settings` saves none, 90 shows as `1 minute 30 seconds` and is kept, the platform value follows live in the card option); the statuses shown (calendars only: four rows and `5 more statuses`; the On a Call switch adds In a call; the status input or Teams status shows all nine; turning them off hides rows again; hidden colors are saved unchanged; no `Teams only` anywhere); the chooser's two Outlook options, the Outlook card and its steps, and the collapsed steps on an existing Outlook address.
25. Calendar reading (build 3.2, 5.4): every fixture read identically to walking every series from `DTSTART` in full, over windows across more than a year; generated series of every frequency (with `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `COUNT`, `UNTIL`, `EXDATE`, a time zone across daylight saving changes, and all-day series) compared the same way; a generated feed (100 daily series that ended in 2019, 300 open daily series started in 2016, 100 weekly series, 5,000 single events) read in under 1 second; an hourly series started in 2023 giving today's occurrences; a series repeating every second reaching the cap with one "Repeat limit" line per source; a weekly Friday meeting whose next occurrence moved to Thursday; a declined invitation by `EMAIL=`; `WORKINGELSEWHERE` free.
26. Timing (build 3.2, 8.1): a meeting that starts while a calendar check waits on a slow server changes the status within one second of its start; the boundary timer set from the clock read after a send to an offline bulb; every timer delay at most Node's maximum, a far expiry never firing at once.
27. Bulb choice (build 3.2, 13.2 item 4): the office bulb goes silent and a kitchen bulb answers, and the kitchen bulb is never sent a color; the office bulb found again at a new address; the same with a remembered bulb; `lifx.bulb` naming another bulb still moves to it.
28. Reserved sender (build 3.2, 18.4 item 3): `Home app` refused with `invalid_sender`, as written and in forms that normalize to it (a no-break space, fullwidth letters), for a report and for `clear`; `home app` and `Home app 2` accepted.
29. When (build 3.2): today, tomorrow, a weekday within 6 days and a date beyond, across midnight, in Right now, the CLI `status` and the status line.
30. Working switch (build 3.2, 6.6): off turns the bulb off (SetPower off) whatever the Offline color, turns every sensor off and wins over the override; reports and boundaries are tracked without changing anything; on resolves at once; the state file, `GET /v1/status`, the CLI line and the two log lines; the switch restored off at startup; the accessory removed with the checkbox.
31. Meeting warning (build 3.2, 6.7), with a fake clock and a fake socket: the SetColor and its duration; Available Off (dim, then the fade); a cancelled meeting during the fade; back-to-back meetings; another status showing; the warning off; a slow calendar check; the Meeting Soon sensor.
32. Statuses shown (build 3.2, 11.3 D): `statusInput.reported` in the state file and in `inputs.json` across a restart; on the page, calendars only, the On a Call switch, the status input alone adding In a call only, an app's report adding its status, and a report older than 30 days not.
33. Settings page (build 3.2): the Copy button on each address line; Cleared and Expired; the Working switch checkbox; Warn before meetings; the Colors help line; Right now with Not working, the meeting warning and days; and that a message on leaving a field waits until the pointer is released, so a click on a button below an empty required field lands.
34. Several bulbs (build 3.2, 13.3), with a fake clock and a fake socket: two bulbs chosen are both sent every color, the refresh, the meeting warning's fade and the Working switch's off; one silent bulb does not delay the other's send; an old `lifx.bulb` configuration and an old single-object `light.json` read as one bulb; several found and none chosen writes the "several bulbs" line and sends nothing; one of two chosen bulbs missing is kept, retried, and never replaced by another that answers (13.2 item 4), with the "bulb not named" line for it alone; comma separated addresses in `lifx.host`; the state file's `lights`, the CLI `status` and `light` per bulb, and the startup and "bulbs found" lines. On the page: `lifx.bulbs` written as serial numbers with `lifx.bulb` dropped, one bulb found ticked by itself, a saved bulb missing beside others found, the none ticked error and its summary entry, the bulbs in use from `lights` (and from an old `light`), and Test light with one result per bulb.

Test helpers (`test/helpers.ts`) provide a fake `fetch` that throws on any address it was not given, a simulated network of LIFX bulbs on a fake socket, a fake clock, and a logger that records every line. Fixtures under `test/fixtures/` are synthetic; every event title in them starts with "Synthetic", and the redaction tests check that no log line contains one.

## 16. Release plan

1. Build 1 (overnight, October 7 to 8, 2026): everything in sections 3 to 10.2 and 12 to 15, the standard settings form, README, CHANGELOG, SECURITY.md, NOTICE, version `0.1.0-beta.1`, one pull request against `latest`. `reference/` is deleted in the last commit. Built October 8, 2026; every network path and the bulb were exercised with fixtures only.
2. Morning test on the Pi (done October 8, 2026: iCloud read, the Floor bulb found by discovery and answering): merge, then clone and build under the Homebridge storage directory and link it (as Generac build 1), or publish the pre-release. `homebridge-busy-light check` first, then the Home app sensors, then the bulb.
3. Build 2: the settings page of section 11 on the shared shell (no separate prototype), the UI server of 10.3, `customUi`, the build 2 configuration of 9.1 items 13 to 16, version `0.1.0-beta.2`. Then on the Pi: `git pull`, `npm ci`, `npm run build`, restart, and a Chrome pass on the page in both themes and at phone width. Built October 8, 2026: every network path and the bulb were exercised with fakes only, and the page was rendered and clicked through in a scratch Homebridge UI 5.29.0 with a synthetic configuration and no network, in both themes at 1280 and 390 pixels.
4. Build 3: the status input of section 18 (the status API and the On a Call switch), a check interval per calendar, color presets on the settings page, and the bulb in use shown when the page opens, version `0.1.0-beta.3`. Then on the Pi: the same update as build 2, then the status input from a Mac on the home network. Built October 8, 2026: the HTTP server, HomeKit and the bulb were exercised with fakes only (no socket opened), and the page was rendered and clicked through in a scratch Homebridge UI 5.29.0 with a synthetic configuration and no network.
5. Build 3.1: what the pass on the Pi on October 8, 2026, found: Busy Light found by name through multicast DNS (18.11), the setup code masked, intervals as durations, only the statuses the setup can produce on the Colors list and the sensors, and the Outlook published calendar link as the recommended Microsoft 365 setup, version `0.1.0-beta.4`. The configuration format does not change. `0.1.0-beta.4` was the first version published to npm.
6. Build 3.2 (October 9, 2026): the fixes from a code review and a test pass after the first public beta (recurring events read without freezing Homebridge, a moved occurrence, the boundary timer, the bulb choice, and smaller ones), the day in `until` times, Cleared senders, the Working switch, the meeting warning, the narrower statuses shown, copy buttons for the addresses, several LIFX bulbs (added to the build by the owner on October 9, 2026), and the README header, version `0.1.0-beta.5`. The configuration gains `workingSwitch` and `meetingWarningSeconds`, both off when absent, and `lifx.bulbs` in place of `lifx.bulb`, which is still read. After merging, the owner creates the GitHub release `v0.1.0-beta.5`; the release workflow publishes it through npm trusted publishing with provenance, its only path from this build.
7. Build 4 (the former build 3): README with masked screenshots, and a reinstall from npm through the Homebridge UI.
8. Soak, r/homebridge tester post, `1.0.0`, then the Homebridge verification request.

## 17. Decisions and open items

- 2026-10-07: Name `homebridge-busy-light`, display name Busy Light. The one-word "busylight" is avoided as a package name because it is a commercial product's name; it is kept as a keyword.
- 2026-10-07: Google Calendar by secret iCal address, not OAuth. Google's device code flow does not allow calendar scopes.
- 2026-10-07: `ical.js` allowed as a runtime dependency for recurrence.
- 2026-10-07: Other HomeKit lights are reached through sensors and Home automations. A Homebridge plugin cannot command another HomeKit accessory.
- 2026-10-07: Available and Out of office exist only as roll-up sensors, since an individual sensor would be identical.
- 2026-10-07: Icon direction 2C "Lit day" on slate `#36434F`.
- 2026-10-07: LIFX bulbs are discovered automatically; an IP address is only a fallback. A discovered bulb is addressed untagged by serial number.
- 2026-10-07: Microsoft 365 is complete in build 1, including plain-language handling of refused sign-ins with a link to the administrator instructions.
- 2026-10-08: Counts in log lines use the singular when the count is 1 (`1 calendar`, `Trying again in 1 minute.`). Written as first specified, the first "Source failed" line would always read `1 minutes`.
- 2026-10-08: The startup line says `light on` while the bulb is still being found, since its address is not known yet.
- 2026-10-08: A new warn line, "Bulb not named", for a `lifx.bulb` that matches none of the bulbs found. The "no bulb" and "several bulbs" lines did not fit that case.
- 2026-10-08: Rule 10 of 6.3 reads "no fresh presence", so a stale Teams status contributes nothing (6.5 item 3) and calendar-only resolution applies, as in the proof of concept.
- 2026-10-08: The override switch gives Do not disturb even with no fresh data; it has no source and no `until`.
- 2026-10-08: `until` is worked out by trying the rules at each later event boundary (6.3 item 2). When presence and an event both satisfy a rule, the event names the source.
- 2026-10-08: Owner addresses for declined invitations are pooled across all sources (one person).
- 2026-10-08: When ical.js rejects a whole file for one bad event, each event is parsed on its own (5.4 item 5).
- 2026-10-08: A 304 reuses parsed events for up to 6 hours, then the calendar is downloaded in full, so the window keeps moving without keeping the body in memory.
- 2026-10-08: Graph `workingElsewhere` is free and an unrecognised `showAs` is busy.
- 2026-10-08: Microsoft refresh errors other than `invalid_grant` and `interaction_required` are a refusal (4.3.1 reason) or, for 5xx and `temporarily_unavailable`, Not reachable. Network failures during sign-in are retried and do not use up a code.
- 2026-10-08: The token file is checked on every token use, and a waiting device code flow ends when a token appears, so a CLI sign-in shows within one tick.
- 2026-10-08: A source without a Microsoft token is checked every tick (only the token file is read); Retry-After wins over a shorter retry step.
- 2026-10-08: The remembered bulb is used at startup without discovery; if its first send is not answered, discovery runs at once. A bulb found at a new address is sent the color straight away. With no bulbs found at all, the chosen bulb is kept.
- 2026-10-08: LIFX replies are matched by type and sequence on the client's own port, not by the source field.
- 2026-10-08: The CLI reads `light.json` but never writes it, so running it as another user cannot leave a file Homebridge cannot replace. `check` never starts a sign-in and does not print the plugin's retry lines.
- 2026-10-08: Validation details and messages are listed in 9.1 items 9 to 11 and the message table. The second Microsoft source with Teams status on is skipped.
- 2026-10-08: The settings form's Colors and LIFX groups are titled "Colors" and "LIFX bulb", and the sensor checkboxes use the accessory name endings of section 7; SPEC 9.2 gave no titles for these. The form was rendered in Homebridge UI 5.29.0 before release (9.2, build 1 item 6).
- 2026-10-08: The override switch's Accessory Information uses Model "Override switch" and Serial Number `override`. `ConfiguredName` is set only where the HAP definition lists it, which today is neither service.
- 2026-10-08: The `debug` option writes debug lines at info level.
- 2026-10-08: `pollSeconds` is capped at 240 and `calendarSeconds` at 600 (9.1 item 12). With longer intervals, presence or events would go stale between checks and the status would flip or turn Unknown. `lifx.refreshSeconds` is capped at a day.
- 2026-10-08: From a review before the pull request: the device code flow ends cleanly when another caller notices a CLI sign-in first (it used to stop Homebridge), and a token file that cannot be written keeps the sign-in in memory; a Graph 403 refusal clears only when the refused read works again; `invalid_grant` after a refusal still starts a new sign-in; `check` never starts one; one warning per Microsoft source; the override switch answers HomeKit at once; an unnamed iCloud calendar is never named by its path.
- 2026-10-08: CLI output wording, beyond the log lines it shares with the plugin, is recorded in 10.2. `@homebridge/hap-nodejs` is a development dependency only, for the platform tests.
- 2026-10-08: On the Pi, broadcast discovery found the user's bulb (Floor) with `lifx.bulb` and `lifx.host` empty, and it acknowledged the untagged color send.
- 2026-10-08: Build 2 needs no separate design prototype. The shell code and rules of the sibling plugins are the design; `assets/` holds Busy Light's own banner and marks.
- 2026-10-08: Calendars are picked from a list after Connect (iCloud and Microsoft 365). Nothing is ticked by default, and a calendar added later stays off until ticked. Calendars are matched by id, falling back to the name.
- 2026-10-08: Each calendar (or Google and URL source) counts for "Busy and out of office" or "Out of office only" (`use`).
- 2026-10-08: Microsoft 365 lists the user's Outlook calendars to pick from, with `Calendars.Read` only.
- 2026-10-08: The LIFX bulb is found by the page as soon as "Use a LIFX bulb" is ticked; the IP address moves under Advanced as the exception. Build 1's form made both optional fields look required.
- Open: confirm that a bulb given only by IP acknowledges a tagged packet with a zero target.
- Open: confirm the `shared` and `subscribed` resource types on the user's iCloud account (10.3 item 1); Universalis Automatic and Ayling are likely candidates.
- Open: confirm `outOfOfficeSettings` is present on `/me/presence` in the user's tenant.
- Open: Google can take hours to reflect a change in the secret address feed. Measure it and say so in the README.
- Open: iCloud calendars shared from another person, and subscribed calendars inside iCloud, have not been checked against discovery.
- Closed 2026-10-08: the settings page prototype from Design (section 11). Build 2 was built without one, as decided above.
- Open: confirm that LIFX bulbs acknowledge with the request's sequence and reply to the sender's port, as the LAN protocol documents, on the user's bulb.
- 2026-10-08: The settings form's lists are not reorderable (`orderable: false`), after the calendar entry stuck to the pointer in Homebridge UI 5.29.0 on the Pi. Order has no meaning for any of them.
- 2026-10-08: The App-specific password help links to account.apple.com and to Apple's instructions (support.apple.com/en-us/102654), both opening in a new tab. The Homebridge UI renders field descriptions as HTML. The custom settings page (build 2) keeps both links under "Where do I find this?".
- 2026-10-08 (build 2): The footer mark is drawn inline (11.1 item 9), so `scripts/build-ui.mjs` copies only the banner beside the bundle. The build prompt asked for both files to be copied; this file wins.
- 2026-10-08 (build 2): A Microsoft 365 `calendars` item without an `id` cannot be read, so it is ignored with the warning of 9.1 item 16 ("must be a calendar name or entry, ignored"); no new message. The warnings of item 16 name the item's path (`calendars[0].calendars[2]`), not its `id`.
- 2026-10-08 (build 2): "Listed calendar gone" applies to iCloud as well as Microsoft 365: an entry that matches no calendar at discovery is reported once, until it is found again (5.1 step 4 was silent).
- 2026-10-08 (build 2): Subscribed iCloud calendars are listed for the page but never read, by the page or the plugin, and are left out of "New calendars", since they cannot be ticked. On the page they never carry the New badge, which would otherwise stay for ever.
- 2026-10-08 (build 2): The `reset-pending` marker is handled without a log line; section 12 has none for it.
- 2026-10-08 (build 2): A Microsoft 365 source's `calendars` list is kept and read from the configuration even when `useCalendar` is off, so turning the option off and on again keeps the choice; it is not used while off.
- 2026-10-08 (build 2): UI server details settled in 10.3: the error keys for each kind of failure (items 1 and 2), Microsoft polling on demand with no server timers, an invalid source id or non-GUID IDs answered without asking Microsoft (item 3), `Calendars.Read` only for the list (item 4), `/lifx/test` ending on the saved Available color and its addressing (item 5), and no log lines (item 8).
- 2026-10-08 (build 2): Connect on a Microsoft 365 card that is already signed in (the state file says connected, or it signed in on this page) with "Use Outlook calendars" on lists the calendars without a new code; "Not signed in" when listing covers the case where the token has gone. When listing is refused at that point, Connect asks for a new code instead of showing the refusal, since a sign-in made for Teams status alone has no `Calendars.Read`; a refusal right after a new sign-in is shown. The busy label while listing is "Connecting…" (as for iCloud), and "Getting a code…" while a code is requested.
- 2026-10-08 (build 2): "Choose at least one calendar." also applies to the saved rows shown before Connect, so unticking every calendar can never be saved as an empty list, which would mean every calendar.
- 2026-10-08 (build 2): A ticked calendar that Connect does not list (deleted or unshared) stays as a ticked row with its name, so it can be unticked. After Connect, a first beta name, or an id that no longer matches, takes the id of the listed calendar it names, and of every other calendar of that name, each ticked, as the plugin reads them all; an entry never matched keeps its name as written.
- 2026-10-08 (build 2): The "Counts for" help shows once under the rows, not under every ticked row.
- 2026-10-08 (build 2): Results have no Dismiss link (11.3 has no string for one); a result stays until the next Test or Connect. A Google "not a calendar" result shows both of its sentences in one box.
- 2026-10-08 (build 2): "Remove {name}?" uses the card's title, so an unnamed card asks "Remove New calendar?".
- 2026-10-08 (build 2): The shell's draft banner and issues summary strings come from the shell contract and `homebridge-notify-switch` 11.3, and are listed in 11.3 G so that every string the page shows is in 11.3. Summary entries for fields outside a card are labelled with the section heading (Settings, Colors) or the LIFX card title. The shell's "Fill in the new ..." line has no Busy Light string and is not used.
- 2026-10-08 (build 2): Out of office words is one text field with the words separated by commas; 11.3 has no list strings (Add, None yet).
- 2026-10-08 (build 2): Right now: "Add a calendar to see your status here." wins over "Busy Light has not started yet." when both apply, and a state file with no status yet reads as not started.
- 2026-10-08 (build 2): Lights: a saved bulb that a search does not find gets the "was not found just now" line, followed by the usual one or several case (one other bulb found is used and written as its serial; nothing is saved until Save). With none found, only that line shows. Its label is the state file's light label when `lifx.bulb` is a serial, else `lifx.bulb` as written. A first beta bulb name found by the search is written as its serial.
- 2026-10-08 (build 2): Lights: with LIFX already on when the page opens, no search runs (11.2 item 5); Search again searches. Test light sends `{ brightness, serial, host }` for a found bulb, `{ brightness, host }` with an IP address under Advanced, and `{ brightness, serial }` for a saved serial not found yet. Its help sits beside the button, and the IP address help is the two sentences of 11.3 E joined. Advanced inside the LIFX card opens by itself when an IP address or a resend interval other than the default is set (shell rule C3).
- 2026-10-08 (build 2): The copy check reads 11.3 in both directions: every string the page shows is in 11.3, and every string of 11.3 is in the page's copy module.
- 2026-10-08 (build 2): The layout check of 15 item 15 runs separately from `npm test`, as `npm run test:layout`. Run October 8, 2026, against Homebridge UI 5.29.0's stylesheet: clean in light and dark at 800 and 390 pixels.
- 2026-10-08 (build 2): Before the pull request, the page was run in a scratch Homebridge UI 5.29.0 with a synthetic configuration and no network (the UI server's network and UDP replaced), and clicked through with a real mouse and keyboard in light and dark at 1280 and 390 pixels: every card, iCloud Connect and ticking, Counts for, Google and URL Test, the Microsoft code view to the end and its list, the chooser, Colors Off, the bulb search choosing a bulb and Test light, Advanced, the sensors, the summary box, the Reset dialog and the host's SAVE. The saved block read back through the plugin's own configuration reader with no issues.
- 2026-10-08: `0.1.0-beta.1` was never published, so skipping it is fine: the first npm release publishes whatever version is current at the time. Build 3's SPEC (written as `design/build-3-spec.md` and folded into this file by build 3) moves that release to build 4 and updates 16 item 4, so 16 is left as it stands here.
- 2026-10-08 (build 2): From a review before the pull request: Test light with no bulb chosen on the page (the build 1 setup, with `lifx.bulb` and `lifx.host` empty) uses the bulb the plugin would choose (10.3 item 5); `/microsoft/calendars` never writes or deletes the plugin's token file (10.3 item 4); a poll answer for a code that was cancelled and replaced no longer closes the new code view; an iCloud name keeps every calendar of that name, as build 1 did (5.1 step 4); a token or reset marker that cannot be written answers instead of throwing (10.3); the configuration load and update errors show the 11.3 G strings alone; and the Show and Hide buttons carry no label beyond their own text.
- 2026-10-08 (build 3): The status input is generic and independent of any sender app. Two channels: an HTTP API on the local network and a HomeKit On a Call switch. Statuses enter the existing precedence as presence signals. Reports expire (default 180 seconds, at most 12 hours). Local addresses and a key only, no TLS. `docs/status-input.md` is the public description for app builders.
- 2026-10-08 (build 3): Added the same day after review: apps sign requests with HMAC-SHA256 so the key never crosses the network (a laptop on another network could otherwise hand the key to whatever device has the home address there), with a per-sender replay rule; the plain key stays for Shortcuts and curl, behind a setting the user can turn off once every sender signs (one plain request seen on the network gives the key away). The replay table is kept apart from the display list, for 300 seconds after each `ts`, through `clear` and expiry, and across restarts, with a startup floor when it is lost; a replay of a captured `inCall` right after a call ends is refused. A signed `GET` is replayable within the window by design, being read-only. Names are Unicode (the macOS default computer name has a curly apostrophe), counted in code points after NFC. `clear` is idempotent and returns `expiresAt: null`. Busy Light is found by its `.local` host name when the host advertises one, so a DHCP change does not break senders; an own Bonjour service was considered and left for later, because Node has no built-in mDNS and the host already runs Homebridge's advertiser and usually Avahi on port 5353.
- 2026-10-08 (build 3): The settings page shows the bulb in use from the state file when it opens (11.3 E), after the pass on the Pi found that with LIFX already on the page opened with only `Search again`, which read as if no bulb were set up.
- 2026-10-08 (build 3): The build 3 additions were folded from `design/build-3-spec.md` as revised by pull requests #8 (the replay table and its startup floor, `lastTs` on `replayed`, `statusInput.allowPlainKey` with `plain_key_off`, and the Signed and Plain key badges) and #9 (the test that `lastTs` is returned only after the signature checks out), both merged while build 3 was running and picked up before the status API was built.
- 2026-10-08 (build 3): 2.3 item 3 (never sending data elsewhere) gains the answers the status input gives to senders on the local network, which section 18 needs.
- 2026-10-08 (build 3): The new 11.3 strings went into the page's copy module in the SPEC commit, because the copy check reads 11.3 in both directions and every commit stays green. The check fills the number message with the ranges 11.3 quotes, and treats addresses, the setup code format, the `/input/test` error keys and the sender name `Home app` as data, not copy.
- 2026-10-08 (build 3): Configuration messages the SPEC did not give are in the 9.1 message table: `must be a set of status input settings` and `must be a set of call switch settings` (warn), and the port and hours fallbacks. The key is trimmed, and with the status input off it is not checked (no line). The 9.2 titles of the new fields come from 11.3 I and 11.3 C, the form groups are titled "Status from other apps" and "On a Call switch", and a calendar's own interval has no description in the form (the page's help names the Settings section, which the form does not have).
- 2026-10-08 (build 3): The page model carries a calendar's own `calendarSeconds` from the configuration commit on, so saving the page never dropped it before the card showed the field.
- 2026-10-08 (build 3): Within one rule of 6.3 an event names the source first (it carries an end time), then Teams presence, then the most recent report (6.3 item 3). A report's reason carries its app; `until` is null for a report.
- 2026-10-08 (build 3): "Sender changed" is logged when a sender becomes active or its status or app changes, not on every repeat, since a sender repeats every 60 seconds (12).
- 2026-10-08 (build 3): The switch's report has no expiry in the store, is never refused by the 20-sender limit (it is the user's own) and is loaded inactive at startup; the platform restores it from the switch (18.7 item 4).
- 2026-10-08 (build 3): A sender that has only ever sent `clear` is not listed. A cleared sender stays listed, inactive (badge Expired), with its last status, until it leaves the 12-hour, 20-sender list (18.7 item 5).
- 2026-10-08 (build 3): A report kept from a channel that is now off in the configuration does not count (6.5 item 2).
- 2026-10-08 (build 3): `inputs.json` is `{ "version": 1, "senders", "replay" }` (18.7 item 4). With both a replay entry and the startup floor applying, the later of the two is the floor and `lastTs` (18.7 item 7).
- 2026-10-08 (build 3): API error messages: the SPEC and `docs/status-input.md` gave keys only. Each error has one fixed plain sentence, recorded in 18.4 item 6, the same for every cause of `unauthorized`, so an answer says nothing about why. `clock_skew` gives the difference in whole seconds, rounded up.
- 2026-10-08 (build 3): `"app": null` and `"ttlSeconds": null` read as absent. A body must be a JSON object; an array, a string or `null` is `invalid_json` (18.4 item 2).
- 2026-10-08 (build 3): The signature is checked before the clock window, so a wrong signature is `unauthorized` whatever its `ts`, and only a key holder learns the clock difference (18.8 item 6).
- 2026-10-08 (build 3): `replayed` is not logged: the key was right, so the "wrong key" line would mislead (12, 18.8 item 3).
- 2026-10-08 (build 3): Each kind of refused request (wrong key, clock off, plain key off, not local) is logged once per address per hour, separately (12 note 7).
- 2026-10-08 (build 3): The server listens on `::` with `ipv6Only` off (every IPv4 and IPv6 address), or on `0.0.0.0` when the host has no IPv6. Requests time out after 10 seconds, a 403 or 413 answer closes the connection, and every answer has `Cache-Control: no-store` (18.3 item 1).
- 2026-10-08 (build 3): The rate limit counts requests from local addresses only, since a non-local request is refused before it (18.6). The authorization scheme is matched without regard to case (18.8 item 4).
- 2026-10-08 (build 3): A `GET` is not checked for a media type; its signature covers whatever body arrives, normally none (18.4 item 2).
- 2026-10-08 (build 3): The startup floor's moment is when the engine loads `inputs.json`, at `didFinishLaunching`, the same moment the server starts (18.7 item 7).
- 2026-10-08 (build 3): Turning the On a Call switch on while it is already on starts the safety period again, so a shortcut run at each call start keeps it on. The switch turning itself off at startup, because its time passed while Homebridge was down, writes the timeout line too, which uses the singular for 1 hour (12 note 1, 18.9 item 3).
- 2026-10-08 (build 3): Outside the build's scope but found while building it: the build 1 test "the token file is watched before each refresh" failed now and then, because file modification times come from the kernel's coarse clock and two writes 5 ms apart can share one. The token store now also notices a new file by its inode, since every write renames a new file into place (4.4 item 6). It went into the state file and CLI commit.
- 2026-10-08 (build 3): The state file's `reason` carries `app` when a report with an app decided the status. A switch entry in `inputs` has `"auth": null`, and `statusInput.id` is null before the input first starts (10.1 note 6).
- 2026-10-08 (build 3): CLI `input` wording is recorded in 10.2 item 7.
- 2026-10-08 (build 3): The `.local` name is built from the first label of the host name, so a host name that already carries a domain still gives `name.local`. A `.local` name that resolves only to an internal address (127.0.0.1) is not the host name (18.11 item 1).
- 2026-10-08 (build 3): The test report of `input test` and `/input/test` is signed with the key and sends `ttlSeconds` 30; the key itself never crosses even the loopback interface (10.3 item 9).
- 2026-10-08 (build 3): `/input/info` and `/input/test` details are recorded in 10.3 item 9.
- 2026-10-08 (build 3): Opening the page calls `/input/info` as well as `/version` and `/status` when the status input is saved on, since 11.3 I shows the addresses whenever the box is ticked (11.2 item 5 amended).
- 2026-10-08 (build 3): Right now shows the status row with no calendars saved when the status input or the On a Call switch is saved on (6.5 item 5); "Add a calendar to see your status here." is for neither (11.3 B).
- 2026-10-08 (build 3): Test on the page: no answer from the UI server reads as `notListening`, and an `other` result shows the API's own message as data, since 11.3 I has no string for it (11.3 I item 2).
- 2026-10-08 (build 3): The port help names the default port 8582 (11.3 I item 3).
- 2026-10-08 (build 3): The summary box labels the port and hours `Status from other apps`. The section has no card. Apps reporting now shows whether or not the box is ticked, since the switch reports there too (11.3 G, 11.3 I item 1).
- 2026-10-08 (build 3): A stored key that breaks the rule (possible only by hand) is replaced by Replace key, or by ticking the box again. Restoring a draft with the input on and no saved key makes a new key, as ticking does (11.3 I item 4).
- 2026-10-08 (build 3): Teams only (11.3 D): with the status input on, another app can report every one of those statuses, so the badge shows only while no Microsoft 365 source uses Teams status and the status input is off; In a call also loses it while the On a Call switch is on. The build 3 design said the badges stay; this keeps them true. Alex confirmed it on October 8, 2026.
- 2026-10-08 (build 3): The bulb in use (11.3 E): the label falls back to the host when the state file has none; `answered` null (nothing sent yet) reads as answering, so only false gives the "did not answer" line; a `light` that is off or has no host gives "has not found a bulb yet". Nothing shows until the first `/status` answer, and each answer redraws the line in place until a search replaces it.
- 2026-10-08 (build 3): Presets (11.3 D): choosing Custom keeps the current color (or the row's last custom color, or white after Off with none); a custom color equal to a preset stays under Custom while the page is open; the chosen swatch carries a ring in the text color, so it reads in both themes. Arrow keys wrap around, and Home and End go to the first and last swatch.
- 2026-10-08 (build 3): `GET /v1/status` and its `reason`: 18.4 and the state file gave the reason a calendar's name and an event's end time, while 18.10 item 3 says a sender learns nothing about calendars or events, and a signed `GET` can be replayed and travels as plain HTTP. 18.10 wins: `reason.source` names only an active sender (whose name the answer lists anyway) and is otherwise null, and `reason.until` is always null. `docs/status-input.md` 2.3 now says so, along with the `tentative` overall status and the `Home app` sender's nulls.
- 2026-10-08 (build 3): From a review before the pull request: `Retry-After` counted from one request too early, so a client that waited exactly that long was refused again (18.6); a report or `clear` that noticed another sender's expiry hid it from the engine, so its "Sender expired" line could be lost (18.7 item 3); the 10-second request timeout was checked only every 30 seconds (18.3 item 1); the rate and log maps kept every address for ever (18.6); and the fallback 500 answer lacked `Cache-Control`. Each is fixed in its scope commit, the first, second and fourth with a test; the timeout and the header sit on the real `http.createServer` path, which tests replace. The review found no crash path and no way for the key, a token or a calendar address to reach a log line, the state file, an answer or the page's draft.
- 2026-10-08 (build 3): CI on the pull request's first push failed once, on Node 24, in the build 2 test "the override switch answers HomeKit at once". The test timed the switch against a 150 ms stopwatch, and the switch's path includes a synchronous state file write, so a slow runner can exceed it without the switch waiting for anything. It now checks the order instead (HomeKit's answer comes while the apply is still waiting on the silent bulb), which no machine speed can fail and which still fails when the switch waits. In item 5's commit, which carries the platform tests.
- 2026-10-08 (build 3): The scratch pass found the read-only Address and Setup code boxes drawn as light boxes in dark mode, unlike the locked Key field beside them; they now take the locked-field background (11.2), and the layout check counts them as locked fields. The layout check then ran on October 8, 2026 against Homebridge UI 5.29.0's stylesheet: clean in light and dark at 800 and 390 pixels.
- 2026-10-08 (build 3): Before the pull request, the page was run in a scratch Homebridge UI 5.29.0 with a synthetic configuration (the Pi's shape: no status input) and a synthetic state file with one active and one expired sender, with no network (the UI server's host name, addresses, name lookup and loopback test replaced), and clicked through with a real mouse and keyboard in light and dark at 1280 and 390 pixels: Right now naming the sender and app, the bulb in use on open, the section off and on, Show, Copy setup code, Replace key with Cancel and with Replace, Test not listening and then received, Allow the plain key off, a bad port and a bad hours value in place and in the summary box, the On a Call switch hours, a calendar card's Advanced, a preset by mouse, a preset by arrow key and Custom with a hex value, and the host's SAVE. Each saved block read back through the plugin's own configuration reader with no issues.
- 2026-10-08 (build 3.1): Build 3.1 collects what the pass on the Pi on October 8, 2026, found: the name `homebridge.local` was never confirmed (it resolves to `127.0.0.1` through `/etc/hosts` on the Pi, while Avahi answers it on the network; a one-off multicast DNS query from the Pi got its own address back within 1.5 seconds), the setup code showed the key in full, intervals in seconds confused, the nine colors and Teams only badges confused a calendar-only setup, and an Outlook published calendar link worked with no IT involvement (a new meeting appeared within about 2 minutes). The configuration format does not change.
- 2026-10-08 (build 3.1): Strings that build 3.1 takes off the page moved to `homebridge-ui/src/retiring.ts` in the SPEC commit and left with their last use, since the copy check reads 11.3 and `copy.ts` in both directions and every commit stays green. The module is deleted with the Outlook item.
- 2026-10-08 (build 3.1): The chooser tile `Outlook or Microsoft 365` needed help text, as every tile has one, and the old Microsoft 365 help (an app registration from the administrator) would contradict the recommended link: `Outlook calendars, by a published link or by signing in.`
- 2026-10-08 (build 3.1): `Check status every (seconds)` keeps its words, as the build asked, but drops `(seconds)`, as `Check for changes every` and `Reload calendars every` do, since the options carry their units (11.3 F).
- 2026-10-08 (build 3.1): Durations (11.3 G): `{m} minute {s} seconds` is written `1 minute {s} seconds`, the only case where minute is singular. Seconds stay `{n} seconds`, as given, since every listed value is 15 or more.
- 2026-10-08 (build 3.1): Multicast DNS (18.11 item 1): the A record must be for the name asked about; the query uses the legacy unicast form measured on the Pi, with Node's default multicast TTL, a random id the answer must echo, and an early end at the first confirming answer. With no non-internal IPv4 address no query is sent.
- 2026-10-08 (build 3.1): Address change notice (18.11 item 6): the Homebridge UI gives the page no save event, so "until the page is saved" is read from `config.json`: the plugin records `statusInput.addressChange` (`{ from, to, at }`) beside `advertised`, and `/input/info` returns it only while `config.json` is older than it, since the host's Save writes `config.json` (10.3 item 10). Only a change from one IPv4 address to another triggers it; a recorded host name never does. The plugin checks when the status input starts and every 10 minutes, and reads both fields back from the previous state file at startup, so the record survives a restart and a run with the status input off.
- 2026-10-08 (build 3.1): Colors (11.3 D): with the other statuses shown, every row is in the precedence order rather than the hidden ones appended, so "the one highest in this list wins" stays true.
- 2026-10-08 (build 3.1): SPEC 9.2: the standard form keeps numbers in seconds, so its titles keep `(seconds)`; only the page shows durations (9.2 form detail 8).
- 2026-10-08 (build 3.1): The copy check treats `calendarSeconds`, `config.json` and the three Outlook hosts as data the page reads or compares, not words it shows.
- 2026-10-08 (build 3.1): The masked setup code shows one dot per character, and Show and Hide hold through a redraw of the section until the page is reloaded (11.3 I).
- 2026-10-08 (build 3.1): Interval selects (11.3 C, F): a value not in the list sits among the others in order of duration; a value outside the plugin's range, possible only by hand, is shown and written back as it is, and the plugin falls back with its warning as before. The card's `Same as Settings` option is updated in place when Reload calendars every changes, without redrawing the calendar cards. The page limits and messages for the three intervals are removed.
- 2026-10-08 (build 3.1): Statuses you use (11.3 D, E): the line sits below the rows and above the precedence line; shown or not is page state; the sensors follow the same rule; and Lights is redrawn with Colors whenever the status input, the On a Call switch or a source's Teams status changes on the page.
- 2026-10-08 (build 3.1): Outlook card (11.3 C): the steps, help and link sit between Name and Address, since step 3 says "paste it below", and the Address takes focus. A second card named Outlook gets the existing duplicate name message. The two options are tiles in the chooser's style in a row below the four tiles, and the Outlook tile carries `aria-expanded`. Whether a card counts as Outlook is read from its address when the card is drawn.
- 2026-10-08 (build 3.1): Found while extending the layout check: leaving an empty required field by clicking a button below it shows the field's message on blur, which moves the button down before the mouse is released, so that click is lost. This is the shell's validation on blur, unchanged since build 2, and is left as it is in this build; the check pastes the Outlook address first, as a person would.
- 2026-10-08 (build 3.1): Before the pull request the suite was also run with `dgram.createSocket`, `net` and `fetch` (and `dns.lookup`) replaced by functions that throw and record the attempt (15, opening paragraph).
- 2026-10-09 (build 3.2): Build 3.2 collects what was open after the first public beta: fixes from an independent code review and a test pass on October 9, 2026 (each proved with a failing test or a timing), and the owner's requests. Sections 8.1 and 8.2 change as well as those the build prompt listed, since the boundary timer and the bulb refresh live there.
- 2026-10-09 (build 3.2): Recurring events (5.4 item 3). ical.js's documented way to start an expansion later is `Event.iterator(startTime)`, which builds a `RecurExpansion` whose rule iterator is anchored at that time; `Recur.iterator`'s own documentation says the start must be the event's start, because the rule's defaults and its interval are read from it. So the start lines up with the series (`DTSTART` moved on by whole intervals, keeping its wall-clock time, day and month) and sits a full period before the window, so that the one period that can differ ends before it. A series with `COUNT` cannot start late (the count would restart), so it is skipped when its end can be worked out without walking, and otherwise walked from `DTSTART`, which its count bounds. `RDATE`, several `RRULE`s and `RANGE=THISANDFUTURE` changes keep the full walk. Occurrences before the window are passed over by their wall-clock time with a day's margin, as a time zone moves it by at most 14 hours. The result was compared with build 3.1's walk over every frequency with intervals, BY parts, `COUNT`, `UNTIL`, `EXDATE`, a time zone across both daylight saving changes and all-day series, at windows across months, with no difference; a test keeps the comparison. The feed of the review (100 ended, 300 open daily, 100 weekly series and 5,000 single events) took 76.7 seconds with build 3.1's walk in this build's container, and under half a second now.
- 2026-10-09 (build 3.2): The cap of 20,000 iterations stays as a safety net; reaching it writes a new warn line, "Repeat limit" (12), once per source for as long as Homebridge runs. A minutely series walks about 4,300 occurrences (a day's margin and the two-day window), well inside it; only a series repeating every second reaches it.
- 2026-10-09 (build 3.2): A changed occurrence (5.4 item 2) is included when its own times overlap the window, whatever its original date, and it is included even when its `RECURRENCE-ID` names an occurrence the rule does not give (one removed by `EXDATE`, say), since it is in the data. Build 3.1 read a changed occurrence only through ical.js's lookup by the text of its `RECURRENCE-ID` as the walk reached its original date; in this build's container the moved Thursday meeting was lost when the series was in UTC and the `RECURRENCE-ID` carried a `TZID` for the same instant, and when the series also listed the date in `EXDATE`. The occurrence a change replaces is now found by instant as well as by text.
- 2026-10-09 (build 3.2): `until` stays an ISO time in the state file (10.1). The build prompt lists "the state file's reason" among the places that show an `until` time; the state file is read by programs, so it keeps the exact time, and Right now and the CLI, which show the state file's reason, format it with its day.
- 2026-10-09 (build 3.2): When (11.3 G, 12): days are counted by the calendar in the local time zone (the browser's on the page, the host's in the log and the CLI), so 11:50 PM until 12:10 AM reads `tomorrow at 12:10 AM`. Weekdays and months are named in English, since every word around them is English; the time keeps the locale, as before. A time already past (a state file left over) reads as `{Month day} at {time}`.
- 2026-10-09 (build 3.2): The Working switch (6.6): `notWorking` writes no "Status change" line, since the Working lines say what happened, and the first status after the switch turns on does. The "Working off" line is also written once at startup when the switch is restored off, so the log always says why the light is off. Right now shows the Off swatch, as the light is off. The state file's `reason` is null, as for `unknown`.
- 2026-10-09 (build 3.2): The meeting warning (6.7): with the In a meeting color `off` there is nothing to fade to, so no warning starts. When the status becomes Available inside the warning time (a short gap between meetings), the bulb is first set to the Available color with no fade, so the fade starts from it rather than from the previous meeting's color. The bulb refresh is skipped during the warning, since a refresh would end the fade. The state file carries `meetingWarning: { meetingAt }`, which Right now reads. Beginning a warning writes a debug line only (counts and times), as section 12 has no line for it.
- 2026-10-09 (build 3.2): Warn before meetings sits at the bottom of the Colors card, below Reset colors, so the rows and the controls about them stay together. Its first option reads `Off`, not `Off (default)`; a hand-edited value outside the list is kept as one more option, as for the intervals.
- 2026-10-09 (build 3.2): The Meeting Soon sensor's help shows always, so its meaning is clear; while the warning is Off it sorts with the sensors that cannot happen, with `Nothing in your setup reports this yet.` after its help. Its key is `meetingSoon`, and its UUID seed is `busy-light:sensor:meeting-soon`, as the build prompt gives it, rather than `busy-light:sensor:meetingSoon`.
- 2026-10-09 (build 3.2): The Working switch checkbox sits below the three steps under Lights rather than between the sensor list and the steps, which explain the sensors.
- 2026-10-09 (build 3.2): The statuses shown (11.3 D): with the narrower rule, one status can be hidden alone, so the line has a singular, `1 more status comes from Teams or from other apps.` A report counts for the rule when it came through the status API; the On a Call switch reports only In a call, which the switch already shows.
- 2026-10-09 (build 3.2): Jeronimo is named in the help of Status from other apps (`for example Jeronimo on your Mac or a Stream Deck button`), replacing "a call helper", with the name linked to https://jeronimo.app; the sentence keeps its length, so it does not crowd the section. Nothing in the status input depends on Jeronimo.
- 2026-10-09 (build 3.2): Bulb choice (13.2 item 4): "no bulb has ever been chosen" means none this run and none remembered in `light.json` that fits `lifx.bulb`. When the chosen bulb is not found, a debug line says so; the "Bulb silent" warning has already been written.
- 2026-10-09 (build 3.2): The reserved sender (18.4 item 3) is compared after NFKC, the widest Unicode normalization, so look-alike forms such as a no-break space or fullwidth letters are refused too, and with case kept, as senders are matched with case kept.
- 2026-10-09 (build 3.2): Timers (8.1 item 5): a timer that fires early is set again for the time left, and the resolve takes the timer's time as now only when it fires within a second of it, so a far expiry can no longer make the engine think the future has come.
- 2026-10-09 (build 3.2): Cleared (11.3 I): the On a Call switch turned off, by hand or by its safety period, is `Cleared`, since the switch withdrew the report. A state file written before build 3.2 has no `ended`, and its inactive senders read as `Expired`, as before. The CLI `input` lists `cleared` the same way.
- 2026-10-09 (build 3.2): The page writes `workingSwitch` and `meetingWarningSeconds` into every block it saves, off by default, as it writes `statusInput` and `callSwitch`, so the file reads as the page shows. An earlier block reads unchanged without them.
- 2026-10-09 (build 3.2): The independent review before the pull request found two cases where a late start (5.4 item 3.2) differed from walking in full, each proved with a failing test: a monthly rule with `BYMONTH` (`FREQ=MONTHLY;BYMONTH=3,6,9,12;BYDAY=-1FR` read on March 27, 2026 lost that day's occurrence, as ical.js steps through `BYMONTH` by position from the first listed month whatever month the walk starts in), and a yearly February 29 rule whose `DTSTART` was in July (started late, ical.js gave March 1, 2027). Both are now walked from `DTSTART`, which the reviewer's fuzzing of about 12,000 windows found to be the only cases that differ. The fix is its own commit after the scope commits, for scope item 2, rather than a rewrite of that commit.
- 2026-10-09 (build 3.2): The lost click (11.2 item 11). The message waits for the pointer's release rather than for the click itself, since a click on something that does not take it (the card's background, say) would leave the message waiting; the release is followed by one turn of the event loop, so the click that the release produces lands first. Pointer presses are watched on the whole document in the capture phase, so a press anywhere counts, and a release outside the frame (which the frame never hears) is covered by the frame's `blur` and the 5 second fallback. Leaving a field with the keyboard, or by a script, shows the message at once, as before. The layout check's workaround (pasting into the Address before the click) is gone: it clicks Add calendar with the mouse under the empty Address and fails with "the click on Add calendar under the empty Outlook Address was lost" when the chooser does not open, then clicks again so the rest of the run still reports; run against the build 3.1 behavior it fails in all four views.
- 2026-10-09 (build 3.2): The layout check (15 item 15) measures Right now in its new states by changing the stand-in host's `/status` answer and running the page's 15 second poll at once (the stand-in records the page's 15 second interval), rather than waiting 15 seconds for each, or adding a hook to the page for the check.
- 2026-10-09 (build 3.2): The README header (C5 of the build prompt) follows `homebridge-notify-switch`: no `#` title line, since the banner's alt text carries the name and the opening paragraph follows the badges. The not-affiliated line sits under the opening paragraph and also stays under License, with the trademark sentence. The Jeronimo callout is a plain `>` quote with a bold first sentence, as the Status callout is, since npm shows GitHub's `[!NOTE]` alert syntax as text. The README says only that Jeronimo will report calls through the status input, nothing about how it is set up, since that is Jeronimo's to describe.
- 2026-10-09 (build 3.2): "Intervals" in the docs scope of the build prompt is read as a README section, "How often Busy Light checks": a table of the four intervals the page sets (Check status every, Reload calendars every, Check for changes every, Send the color again every) and the statement that none of them delays the light at a meeting's start or end or the meeting warning's beginning (8.1 item 3). It replaces the single line at the end of Configuration. "Light only during meetings" is its own section (C7), so the Contents list can point at it.
- 2026-10-09 (build 3.2): `docs/status-input.md` describes `notWorking` under both `POST /v1/status` (the overall status in the answer) and `GET /v1/status`, says that sending it is `400 invalid_status`, and that `reason` is null with it, as with `unknown`.
- 2026-10-09 (build 3.2): The release workflow's header says how the dist-tag follows the release: a pre-release publishes under `beta`, any other release under `latest`. A release created with the label None is not a pre-release, so `v0.1.0-beta.5` publishes under `latest`; the tag check against `package.json` is unchanged.
- 2026-10-09 (build 3.2): Several bulbs (C8, added to the build by the owner on October 9, 2026, as follow-up commits for scope items 1, 4, 10, 12, 14 and 15 rather than rewrites of them). `lifx.bulbs` reuses the list messages of 9.1 (`must be a list`, `must be text, ignored`) rather than a new one. A `lifx.host` with one bad part is ignored as a whole, with the existing message, so a typo never sends to half the bulbs silently.
- 2026-10-09 (build 3.2): The state file's `lights` keeps one entry while no bulb is chosen, shaped as `light` was (`enabled` false when LIFX is off, a null `host` while none is found), so a reader can tell LIFX off from no bulb yet without the configuration; with bulbs chosen it has one entry per bulb.
- 2026-10-09 (build 3.2): With no bulbs wanted, a single remembered bulb is used at startup as before; several remembered bulbs (the list was emptied by hand) are not, and discovery decides, since the owner chose none of them.
- 2026-10-09 (build 3.2): On the page, one bulb found with `lifx.bulbs` naming others and not it is listed with an unticked checkbox under the lines of the missing bulbs, with no heading line, rather than replacing them as the single radio choice did: the copy has no line for one bulb to choose from, and a found bulb must not displace a saved one that is only switched off (13.2 item 4). The none ticked error applies only when several were found in this visit, since that is when the choice is on the page.
- 2026-10-09 (build 3.2): `/lifx/test` takes a list of bulbs and answers one result per bulb, and still reads the single bulb of build 2 and build 3. With an address under Advanced, Test light tests each address. The results use the existing one-bulb strings when one bulb is tested, as C8 asks, and the new per-bulb strings otherwise; the address stands in for a bulb with no name.
- 2026-10-09 (build 3.2): `Busy Light will use the bulb at {ip}.` shows once per address under Advanced rather than as a new plural line, and the field keeps its label, `Bulb IP address`.
- 2026-10-09 (build 3.2): The CLI `light` with no bulb given exits 1 when any bulb did not answer, as it does for one bulb.
- 2026-10-09 (build 3.2): Several bulbs, as built. `Bulb IP address` no longer asks phones for the decimal keypad, which has no comma, so several addresses (and a host name) can be typed. The page keeps the names of the bulbs found by any search in the visit, so a saved bulb missing from a later search is still named rather than shown by its serial number. A search that changes nothing checks the page again, so with several found and none ticked Save is disabled at once. Ticking a bulb saves the ticked bulbs in the order found, then any saved bulb not found now, so a bulb switched off at the wall stays chosen. The CLI `light` prints its answer lines itself, in the order of `lifx.bulbs`, rather than through the controller's "bulb silent" lines.
- 2026-10-09 (build 3.2): A second independent review before the pull request, of the several bulbs send path, proved six defects with failing tests, fixed with those tests in follow-up commits for scope items 4 and 10: two bulbs going silent together sent only the first to its new address; the 5 minute discovery for a missing bulb found a chosen bulb at a new address and sent it nothing; a bulb chosen by a discovery another bulb's send started was never sent the color; one silent bulb held up the next color on the bulbs that answer, because each apply waited for every bulb's answers (13.3 item 1); Test light paired results with the wrong bulbs when a saved name was not found (10.3 item 5); and two entries naming the same bulb kept discovery running. The fix gives each bulb its own lane, lets an apply go on without waiting for the bulbs' answers, and has every discovery send the last color to the bulbs it moves or chooses; `idle` and a tick still wait for the lanes, so the plugin's tests and its next tick see the bulbs settled.
- Open (build 3.2): calendars are read from 24 hours before now to 24 hours after (section 5), so an `until` time is never more than a day away and reads as a time today or `tomorrow at {time}`; the weekday and date forms of 11.3 G are in place for when the window grows. Whether to read further ahead, so that a Friday afternoon can say `until Monday at 9:00 AM`, is a question for Alex (it costs more reading and changes the `events` count of 10.1). Until then the window stays as it was, marked `TODO(alex)` at `WINDOW_MS` in `src/calendar.ts`.
- Open (build 3): check each color preset on Floor during the Pi pass, noting any the bulb renders poorly (orange and yellow especially). Alex decided on October 8, 2026 to keep the values as they are until then. The configuration keeps whatever hex the user saved.

## 18. Status input

### 18.1 Purpose

Calendars say when a meeting is scheduled. Other apps can know more: that a call is live in Teams, Zoom or FaceTime, that the user is presenting, or has stepped away. The status input lets any app tell Busy Light, through either of two channels, without depending on any particular app:

1. **The status API**: HTTP on the local network (18.2 to 18.8 and 18.11).
2. **The On a Call switch**: a HomeKit switch (18.9), for senders that should make no network requests, such as Apple Shortcuts.

Busy Light treats every report as a presence signal alongside Teams presence (6.3).

### 18.2 Statuses a sender may report

`outOfOffice`, `doNotDisturb`, `inCall`, `inMeeting`, `busy`, `away`, `available`, `offline`, and `clear` (withdraws that sender's report). `tentative` and `unknown` are not accepted.

### 18.3 Server

1. Off unless `statusInput.enabled` is on (9.1 item 17). When on, the platform starts a Node `http` server at `didFinishLaunching` on `statusInput.port` (default 8582), on all IPv4 and IPv6 addresses (`::` with `ipv6Only` off, or `0.0.0.0` on a host without IPv6), and closes it on Homebridge `shutdown`. A request times out after 10 seconds, checked every second (Node's default check every 30 seconds would let it run to 40). A 403 or 413 answer closes the connection. Every answer Busy Light writes carries `Cache-Control: no-store`.
2. A port that cannot be opened is logged once ("Status input could not start") and leaves the input off until the next restart; the state file records the error (10.1).
3. Node built-ins only. No new dependency.
4. Instance id: 12 random bytes written base64url without padding (16 characters), created the first time the status input starts and kept in `busy-light/instance.json`. It is not a secret. It lets a sender confirm it reached this Busy Light and not another device at the same address (18.11). It changes only if that file is deleted.

### 18.4 Requests

| Method and path | Key | Body | Response |
| --- | --- | --- | --- |
| `GET /v1/ping` | no | none | `200 { "service": "busy-light", "apiVersion": 1, "version", "id" }` (`id` as 18.3 item 4) |
| `POST /v1/status` | yes | `{ "sender", "status", "app"?, "ttlSeconds"? }` | `200 { "accepted": true, "expiresAt", "status" }` (`status` is the resulting overall status, which from build 3.2 may be `notWorking`, 6.6) |
| `GET /v1/status` | yes | none | `200 { "status", "reason", "senders": [{ "sender", "status", "app", "expiresAt" }] }` |

1. Authentication is by either form of 18.8: a signature (items 4 to 8) or the plain key (item 9).
2. Bodies are `application/json` (parameters allowed after a semicolon), at most 2048 bytes of UTF-8, an object with only the four fields above. A body that is JSON but not an object (an array, a string, `null`) is `invalid_json`. `"app": null` and `"ttlSeconds": null` read as absent. A `GET` is not checked for a media type; its signature covers whatever body arrives (normally none).
3. Text rule, for `sender` (required) and `app` (optional): a JSON string, normalized to Unicode NFC, of 1 to 64 Unicode code points (not bytes, and not UTF-16 units; an emoji such as U+1F4DE counts as one), with no leading or trailing white space, and with none of: control characters (Unicode category Cc), U+2028, U+2029, or the bidirectional formatting characters U+202A to U+202E and U+2066 to U+2069. Everything else is allowed, including curly apostrophes ("Alex’s iMac", the macOS default computer name), accented letters and emoji. The stored and displayed form is the NFC form. A value that breaks the rule gets `invalid_sender` or `invalid_app`; nothing is trimmed or rewritten silently. From build 3.2 the sender name `Home app` is reserved for the On a Call switch (18.9): a `sender` whose NFKC form is `Home app` (as written, or with a no-break space or fullwidth letters, for example) is refused with `invalid_sender`, for a report and for `clear` alike, so no app can appear in the list as the switch. The comparison keeps case, as matching senders does (18.7 item 1).
4. `ttlSeconds`: an integer from 30 to 43200, default 180.
5. `clear`: removes that sender's report and answers `200 { "accepted": true, "expiresAt": null, "status" }`, also when the sender has no active report (clearing is idempotent). `app` and `ttlSeconds` are allowed with `clear`, checked against their rules, and otherwise ignored, so a sender can send the same shape every time. `clear` is never refused with 409.
6. Errors are `{ "error", "message" }` with the codes and keys of `docs/status-input.md` section 2.6: `invalid_json`, `unknown_field`, `invalid_sender`, `invalid_status`, `invalid_app`, `invalid_ttl` (400), `unauthorized`, `clock_skew`, `replayed`, `plain_key_off` (401; `replayed` also carries `lastTs`, 18.8 item 7), `not_local` (403), `not_found` (404), `method_not_allowed` (405, with `Allow`), `too_many_senders` (409), `too_large` (413), `unsupported_media_type` (415), `rate_limited` (429, with `Retry-After` in seconds). Each error has one fixed `message`, the same for every cause of `unauthorized`, so an answer says nothing about why: `invalid_json` `The body is not a JSON object.`, `unknown_field` `Only sender, status, app and ttlSeconds are allowed.`, `invalid_sender` `sender must be 1 to 64 characters, with no control characters and no spaces at either end.`, `invalid_status` `status must be outOfOffice, doNotDisturb, inCall, inMeeting, busy, away, available, offline or clear.`, `invalid_app` as `invalid_sender` with `app`, `invalid_ttl` `ttlSeconds must be a whole number from 30 to 43200.`, `unauthorized` `Missing or wrong key, a wrong signature, or a malformed Authorization header.`, `clock_skew` `The signed ts is {n} seconds from Busy Light's clock.` (whole seconds, rounded up), `replayed` `The signed ts is not greater than the last one accepted from this sender.`, `plain_key_off` `The plain key is turned off in Busy Light. Sign the request.`, `not_local` `Busy Light takes requests from the local network only.`, `not_found` `There is nothing at this path.`, `method_not_allowed` `This path does not take that method.`, `too_many_senders` `20 senders are already active. Wait for one to expire, or clear one.`, `too_large` `The body is over 2048 bytes.`, `unsupported_media_type` `The body must be application/json.`, `rate_limited` `More than 60 requests in a minute from this address.`
7. No CORS headers on any response, and `OPTIONS` answers 405.
8. Checks run in this order: local address (403), rate limit (429), path and method (404, 405), size (413), media type (415), authentication (401, except `/v1/ping`; a signature is checked over the raw body bytes, before JSON parsing), JSON (400), fields (400), the replay rule (401 `replayed`, 18.8 item 7), sender count (409).

### 18.5 Local network only

A request whose remote address (after unwrapping an IPv4-mapped IPv6 address) is not in 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, ::1, fc00::/7 or fe80::/10 is refused with 403 before anything else is read. `X-Forwarded-For` and similar headers are ignored.

### 18.6 Rate limit

60 requests per rolling minute per remote address, counting every request from a local address, refused ones included (a request from outside is refused by 18.5 before it is counted). The 61st and later get 429 with `Retry-After`: the seconds until the 60th most recent request leaves the window, so a client that waits that long is accepted. Only the last 61 times of an address are kept, and once more than 256 addresses are held, those with no request in the window are dropped (the log throttle of 18.8 item 3 drops its entries older than an hour the same way).

### 18.7 Senders and expiry

1. The latest report from a sender (matched by the NFC form of `sender`, case-sensitive) replaces its earlier one. `clear` removes it.
2. A report expires `ttlSeconds` after it arrives. At most 20 unexpired senders; a report from a 21st gets 409.
3. Expiry is checked on every tick and by a timer set to the next expiry (as the event boundary timer of 8.1 item 3), so a status changes the moment its report expires. A report or `clear` that finds another sender's report expired keeps it for the next check, so its "Sender expired" line is still written.
4. Unexpired reports are kept in `busy-light/inputs.json` (mode 600, written atomically on every change) and reloaded at startup, so a long report (for example two hours of Do not disturb) survives a Homebridge restart. Expired entries are dropped on load. The file is `{ "version": 1, "senders": [...], "replay": [{ "sender", "ts" }] }`. The switch's report has no expiry in the store (the switch keeps its own safety period, 18.9), is never refused by the 20-sender limit, and is loaded inactive at startup; the platform restores it from the switch.
5. The last 20 senders seen in the past 12 hours, expired or not, are kept for display (10.1, 11.3 I) with their last status, app, time and how they authenticated (`signed` or `plain`). `inputs.json` keeps this list too. It has nothing to do with the replay rule, which has its own table (item 6). A sender that has only ever sent `clear` is not listed; a cleared sender stays listed, inactive, with its last status. From build 3.2 each entry also records how it ended: `cleared` after `clear` (and the switch's sender after the switch turned off, by hand or by its safety period), `expired` when its report ran out (also while Homebridge was down), and none while active (10.1 item 8).
6. **Replay table.** For every sender with an accepted signed `POST /v1/status`, Busy Light keeps that request's `ts`, updated on each one, `clear` included. An entry is kept until Busy Light's clock is more than 300 seconds past its `ts` (after that, the window of 18.8 item 6 refuses the old request anyway), whatever happens to the sender's report: `clear`, expiry, leaving the display list, or the 20-sender limit change nothing. There is no size limit, since only a correctly signed request adds an entry. The table is written to `inputs.json` with every change and reloaded at startup, dropping entries already more than 300 seconds old.
7. **Startup floor.** When `inputs.json` is missing or unreadable at startup (a first start, a deleted file), Busy Light cannot know the last `ts` of any sender, so for 300 seconds after startup it refuses with `replayed` any signed report whose `ts` is not later than the moment the status input started (when `inputs.json` is loaded, at `didFinishLaunching`). Normal senders, whose `ts` is the current time, are not affected. When a sender has a replay entry and the floor also applies, the later of the two is the floor and `lastTs`.
8. **Reported statuses** (from build 3.2). For each status reported through the status API (not `clear`, and not the switch's report), Busy Light keeps when it was last reported, in `inputs.json` as `"reported": { "<status>": "<ISO time>" }` and across restarts. The state file gives it as `statusInput.reported` (10.1 item 8), so the settings page shows a status's color row once an app has reported it in the last 30 days (11.3 D). Reset deletes it with the rest of `busy-light/`.

### 18.8 Key and authentication

1. `statusInput.key`: 32 to 128 characters from `A-Z a-z 0-9 - _`. The settings page generates 32 random bytes with `crypto.getRandomValues` and writes them base64url without padding (43 characters).
2. The key is never logged, never written to the state file, and never returned by the API.
3. A failed authentication is logged once per remote address per hour for each kind, separately (12 note 7). `replayed` is not logged.
4. **Signed requests** (for apps). The key never crosses the network. Header: `Authorization: BusyLight-HMAC-SHA256 ts=<ts>, sig=<sig>`, the two parameters in either order, separated by a comma and optional spaces, each exactly once. The scheme name is matched without regard to case.
5. `ts` is the sender's clock in whole milliseconds since 1970 UTC, as decimal digits. `sig` is the lowercase hex HMAC-SHA256, keyed with the UTF-8 bytes of the key, of the string `v1` LF method LF path LF ts LF body hash, where LF is one U+000A, method is upper case (`POST`, `GET`), path is the request path without the query string (`/v1/status`), and body hash is the lowercase hex SHA-256 of the raw body bytes (of the empty string for a request without a body). The test vector in `docs/status-input.md` section 2.4 is normative; a test checks it.
6. A signature is compared in constant time. It is checked before the clock window, so a wrong signature is `unauthorized` whatever its `ts`, and only a key holder learns the clock difference. A `ts` more than 300 seconds from Busy Light's clock gets 401 `clock_skew`, whose message gives the difference in whole seconds, rounded up.
7. Replay rule, `POST /v1/status` only: a signed report whose `ts` is not greater than the sender's entry in the replay table (18.7 item 6), or not later than the startup floor while it applies (18.7 item 7), gets 401 `replayed` with `"lastTs"`, the stored `ts` as a string of digits (or the floor), so a sender whose clock stepped back can continue from `lastTs` plus 1. Only a request with a valid signature reaches this rule, so only a key holder learns `lastTs`. Together with the 300-second window, a captured report can never be replayed, during a call, after `clear`, after expiry or across a restart.
   - **Exception, stated plainly:** a signed `GET /v1/status` has no sender and no replay rule. Someone who captured one can send it again within 300 seconds and receive the current overall status and sender list, which anyone on the network can already read from the plain HTTP traffic. It changes nothing.
8. A malformed signed header (missing or repeated parameter, `ts` not digits, `sig` not 64 lowercase hex characters) gets 401 `unauthorized`.
9. **Plain key** (for Apple Shortcuts, curl and testing): `Authorization: Bearer <key>`, compared in constant time. It has no replay rule. One such request seen on the network gives away the key, which can then sign anything, so it is accepted only while `statusInput.allowPlainKey` is on (9.1 rule 17). With it off, a plain-key request gets 401 `plain_key_off` before the key is compared, and the key is not looked at. `docs/status-input.md` tells app builders to sign and to keep the plain form for the user's own tools.
10. Each sender in the display list (18.7 item 5) records whether its last report was signed or plain, so the settings page can show which senders still send the key itself (11.3 I) and when it is safe to turn the plain key off.

### 18.9 The On a Call switch

1. With `callSwitch.enabled` on, a Switch accessory `{name} On a Call`, UUID from `busy-light:call-switch`, Accessory Information as the override switch (7 item 5) with Model "Call switch" and Serial Number `call-switch`.
2. While it is on, the sender `Home app` reports `inCall` with no app; turning it off removes that report. HomeKit's write is answered at once.
3. It turns itself off `callSwitch.hours` (1 to 12, default 3) after it was turned on. The time it was turned on is kept in the accessory context, so after a restart the switch is restored with the time remaining, or turned off if the time has passed (which writes the timeout line). Turning it on while it is already on starts the safety period again, so a shortcut run at each call start keeps it on.
4. Turned off when the configuration no longer enables it; the accessory is removed then (7 item 6).

### 18.10 What a sender can and cannot do

1. A report enters the precedence of 6.3 like Teams presence; it cannot lower a higher status (a sender's `available` does not hide a calendar meeting).
2. The override switch (rule 1) still wins over everything.
3. A sender learns the overall status (`GET /v1/status`) and the names, statuses and apps of the active senders, nothing about calendars or events. So the answer's `reason.source` names a source only when it is one of the active senders it lists, and is null for a calendar, Teams or the override; `reason.until` is always null. The overall status itself may be `tentative`, which only a calendar gives, or from build 3.2 `notWorking`, while the Working switch is off (6.6), with `reason` null; a sender may see it but never send it. The meeting warning (6.7) is not visible to senders: the status stays `available`.

### 18.11 Finding Busy Light by name

On the Homebridge Raspberry Pi image, `{os.hostname()}.local` resolves through `/etc/hosts` to `127.0.0.1` on the Pi itself, so build 3's check with `dns.lookup` alone never confirmed the name, although Avahi answers it on the network (found on the Pi, October 8, 2026). From build 3.1 the name is confirmed the way other devices find it.

1. The name is `{os.hostname()}.local`, from the host name up to its first dot, in lower case. It is confirmed by asking the network, the way other devices find it: one multicast DNS query, type A, class IN, for that name, sent with Node's `dgram` from an ephemeral port to 224.0.0.251:5353 (the legacy unicast form of RFC 6762, so answers come back to that port), and the answers collected for 1.5 seconds. The name is confirmed when an A record for that name in any answer carries one of the host's own non-internal IPv4 addresses. The query id is random and an answer must echo it, as legacy unicast answers do. Names in answers may be compressed; packets that are not answers, answer another query, or cannot be read are ignored. The wait ends at the first answer that confirms the name. With no non-internal IPv4 address there is nothing for an A record to match, so no query is sent.
2. When multicast DNS gives no confirmation (no answer, an error, or only other addresses), `dns.lookup` is tried as before (all addresses, 2-second timeout), with the same rule.
3. A confirmed name is the **host name**. The settings page, the setup code and the CLI use it first; the IPv4 addresses are always listed below it as a fallback. Without a confirmed name, the first IPv4 address is used and the "reserve this address" help of 11.3 I shows, as before. The setup code is `busylight://{host}:{port}/?key={key}&id={id}`; an IPv6 address is written in brackets.
4. The result is cached for 10 minutes in the UI server. The CLI `input` command runs the check itself. The plugin runs it when the status input starts and every 10 minutes after, for item 6.
5. The check never fails the page: any error means "no host name".
6. Address change notice. The plugin keeps the address it last gave senders (the host name, or the first IPv4 address when there is none) in the state file as `statusInput.advertised` (10.1 item 7). When there is no host name and the first IPv4 address differs from the one recorded, it logs once, as a warning, `Homebridge's address changed from {old} to {new}. Apps that use the old address need the new setup code.` (12), records the change as `statusInput.addressChange`, and the settings page shows that sentence above the Address line until the page is saved (10.3 item 10). A host name never triggers it: only a change from one IPv4 address to another does.
7. Busy Light does not advertise a Bonjour service of its own (17).
