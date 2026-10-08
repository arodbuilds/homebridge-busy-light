# Build 3 SPEC additions

Written October 8, 2026, while build 2 was running, as a separate file so the two could not collide. Build 3 folds this into `SPEC.md` in its first commit (item 1 of the build 3 prompt) and then deletes this file. Section numbers refer to `SPEC.md` as build 2 leaves it.

The public, app-independent description of the status API and the On a Call switch is `docs/status-input.md`. Where this file and that document disagree, fix the document, not this file: this file goes into `SPEC.md`, which wins.

Build 3 has three parts:

- **A. Status input**: any app on the local network can report a status (a new SPEC section 18, plus changes to sections 2, 6, 7, 9, 10, 11, 12, 15, 16, 17).
- **B. Per-calendar check interval**.
- **C. Color presets** in place of hex codes on the settings page.
- **D. The bulb in use, shown when the page opens** (found on the Pi on October 8, 2026).

Version: `0.1.0-beta.3`.

---

## A. Status input

### A.1 New SPEC section 18, "Status input"

#### 18.1 Purpose

Calendars say when a meeting is scheduled. Other apps can know more: that a call is live in Teams, Zoom or FaceTime, that the user is presenting, or has stepped away. The status input lets any app tell Busy Light, through either of two channels, without depending on any particular app:

1. **The status API**: HTTP on the local network (18.2 to 18.8 and 18.11).
2. **The On a Call switch**: a HomeKit switch (18.9), for senders that should make no network requests, such as Apple Shortcuts.

Busy Light treats every report as a presence signal alongside Teams presence (6.3).

#### 18.2 Statuses a sender may report

`outOfOffice`, `doNotDisturb`, `inCall`, `inMeeting`, `busy`, `away`, `available`, `offline`, and `clear` (withdraws that sender's report). `tentative` and `unknown` are not accepted.

#### 18.3 Server

1. Off unless `statusInput.enabled` is on (9.1 item 17). When on, the platform starts a Node `http` server at `didFinishLaunching` on `statusInput.port` (default 8582), on all IPv4 and IPv6 addresses, and closes it on Homebridge `shutdown`.
2. A port that cannot be opened is logged once ("Status input could not start") and leaves the input off until the next restart; the state file records the error (10.1).
3. Node built-ins only. No new dependency.
4. Instance id: 12 random bytes written base64url without padding (16 characters), created the first time the status input starts and kept in `busy-light/instance.json`. It is not a secret. It lets a sender confirm it reached this Busy Light and not another device at the same address (18.11). It changes only if that file is deleted.

#### 18.4 Requests

| Method and path | Key | Body | Response |
| --- | --- | --- | --- |
| `GET /v1/ping` | no | none | `200 { "service": "busy-light", "apiVersion": 1, "version", "id" }` (`id` as 18.3 item 4) |
| `POST /v1/status` | yes | `{ "sender", "status", "app"?, "ttlSeconds"? }` | `200 { "accepted": true, "expiresAt", "status" }` (`status` is the resulting overall status) |
| `GET /v1/status` | yes | none | `200 { "status", "reason", "senders": [{ "sender", "status", "app", "expiresAt" }] }` |

1. Authentication is by either form of 18.8: a signature (items 4 to 8) or the plain key (item 9).
2. Bodies are `application/json` (parameters allowed after a semicolon), at most 2048 bytes of UTF-8, an object with only the four fields above.
3. Text rule, for `sender` (required) and `app` (optional): a JSON string, normalized to Unicode NFC, of 1 to 64 Unicode code points (not bytes, and not UTF-16 units; an emoji such as U+1F4DE counts as one), with no leading or trailing white space, and with none of: control characters (Unicode category Cc), U+2028, U+2029, or the bidirectional formatting characters U+202A to U+202E and U+2066 to U+2069. Everything else is allowed, including curly apostrophes ("Alex’s iMac", the macOS default computer name), accented letters and emoji. The stored and displayed form is the NFC form. A value that breaks the rule gets `invalid_sender` or `invalid_app`; nothing is trimmed or rewritten silently.
4. `ttlSeconds`: an integer from 30 to 43200, default 180.
5. `clear`: removes that sender's report and answers `200 { "accepted": true, "expiresAt": null, "status" }`, also when the sender has no active report (clearing is idempotent). `app` and `ttlSeconds` are allowed with `clear`, checked against their rules, and otherwise ignored, so a sender can send the same shape every time. `clear` is never refused with 409.
6. Errors are `{ "error", "message" }` with the codes and keys of `docs/status-input.md` section 2.6: `invalid_json`, `unknown_field`, `invalid_sender`, `invalid_status`, `invalid_app`, `invalid_ttl` (400), `unauthorized`, `clock_skew`, `replayed`, `plain_key_off` (401; `replayed` also carries `lastTs`, 18.8 item 7), `not_local` (403), `not_found` (404), `method_not_allowed` (405, with `Allow`), `too_many_senders` (409), `too_large` (413), `unsupported_media_type` (415), `rate_limited` (429, with `Retry-After` in seconds).
7. No CORS headers on any response, and `OPTIONS` answers 405.
8. Checks run in this order: local address (403), rate limit (429), path and method (404, 405), size (413), media type (415), authentication (401, except `/v1/ping`; a signature is checked over the raw body bytes, before JSON parsing), JSON (400), fields (400), the replay rule (401 `replayed`, 18.8 item 7), sender count (409).

#### 18.5 Local network only

A request whose remote address (after unwrapping an IPv4-mapped IPv6 address) is not in 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, ::1, fc00::/7 or fe80::/10 is refused with 403 before anything else is read. `X-Forwarded-For` and similar headers are ignored.

#### 18.6 Rate limit

60 requests per rolling minute per remote address, counting every request including refused ones. The 61st and later get 429 with `Retry-After`.

#### 18.7 Senders and expiry

1. The latest report from a sender (matched by the NFC form of `sender`, case-sensitive) replaces its earlier one. `clear` removes it.
2. A report expires `ttlSeconds` after it arrives. At most 20 unexpired senders; a report from a 21st gets 409.
3. Expiry is checked on every tick and by a timer set to the next expiry (as the event boundary timer of 8.1 item 3), so a status changes the moment its report expires.
4. Unexpired reports are kept in `busy-light/inputs.json` (mode 600, written atomically on every change) and reloaded at startup, so a long report (for example two hours of Do not disturb) survives a Homebridge restart. Expired entries are dropped on load.
5. The last 20 senders seen in the past 12 hours, expired or not, are kept for display (10.1, 11.3 I) with their last status, app, time and how they authenticated (`signed` or `plain`). `inputs.json` keeps this list too. It has nothing to do with the replay rule, which has its own table (item 6).
6. **Replay table.** For every sender with an accepted signed `POST /v1/status`, Busy Light keeps that request's `ts`, updated on each one, `clear` included. An entry is kept until Busy Light's clock is more than 300 seconds past its `ts` (after that, the window of 18.8 item 6 refuses the old request anyway), whatever happens to the sender's report: `clear`, expiry, leaving the display list, or the 20-sender limit change nothing. There is no size limit, since only a correctly signed request adds an entry. The table is written to `inputs.json` with every change and reloaded at startup, dropping entries already more than 300 seconds old.
7. **Startup floor.** When `inputs.json` is missing or unreadable at startup (a first start, a deleted file), Busy Light cannot know the last `ts` of any sender, so for 300 seconds after startup it refuses with `replayed` any signed report whose `ts` is not later than the moment the status input started. Normal senders, whose `ts` is the current time, are not affected.

#### 18.8 Key and authentication

1. `statusInput.key`: 32 to 128 characters from `A-Z a-z 0-9 - _`. The settings page generates 32 random bytes with `crypto.getRandomValues` and writes them base64url without padding (43 characters).
2. The key is never logged, never written to the state file, and never returned by the API.
3. A failed authentication of any kind is logged once per remote address per hour (12).
4. **Signed requests** (for apps). The key never crosses the network. Header: `Authorization: BusyLight-HMAC-SHA256 ts=<ts>, sig=<sig>`, the two parameters in either order, separated by a comma and optional spaces, each exactly once.
5. `ts` is the sender's clock in whole milliseconds since 1970 UTC, as decimal digits. `sig` is the lowercase hex HMAC-SHA256, keyed with the UTF-8 bytes of the key, of the string `v1` LF method LF path LF ts LF body hash, where LF is one U+000A, method is upper case (`POST`, `GET`), path is the request path without the query string (`/v1/status`), and body hash is the lowercase hex SHA-256 of the raw body bytes (of the empty string for a request without a body). The test vector in `docs/status-input.md` section 2.4 is normative; a test checks it.
6. A signature is compared in constant time. A `ts` more than 300 seconds from Busy Light's clock gets 401 `clock_skew`, whose message gives the difference in seconds.
7. Replay rule, `POST /v1/status` only: a signed report whose `ts` is not greater than the sender's entry in the replay table (18.7 item 6), or not later than the startup floor while it applies (18.7 item 7), gets 401 `replayed` with `"lastTs"`, the stored `ts` as a string of digits (or the floor), so a sender whose clock stepped back can continue from `lastTs` plus 1. Only a request with a valid signature reaches this rule, so only a key holder learns `lastTs`. Together with the 300-second window, a captured report can never be replayed, during a call, after `clear`, after expiry or across a restart.
   - **Exception, stated plainly:** a signed `GET /v1/status` has no sender and no replay rule. Someone who captured one can send it again within 300 seconds and receive the current overall status and sender list, which anyone on the network can already read from the plain HTTP traffic. It changes nothing.
8. A malformed signed header (missing or repeated parameter, `ts` not digits, `sig` not 64 lowercase hex characters) gets 401 `unauthorized`.
9. **Plain key** (for Apple Shortcuts, curl and testing): `Authorization: Bearer <key>`, compared in constant time. It has no replay rule. One such request seen on the network gives away the key, which can then sign anything, so it is accepted only while `statusInput.allowPlainKey` is on (9.1 rule 17). With it off, a plain-key request gets 401 `plain_key_off` before the key is compared, and the key is not looked at. `docs/status-input.md` tells app builders to sign and to keep the plain form for the user's own tools.
10. Each sender in the display list (18.7 item 5) records whether its last report was signed or plain, so the settings page can show which senders still send the key itself (11.3 I) and when it is safe to turn the plain key off.

#### 18.9 The On a Call switch

1. With `callSwitch.enabled` on, a Switch accessory `{name} On a Call`, UUID from `busy-light:call-switch`, Accessory Information as the override switch (7 item 5) with Model "Call switch" and Serial Number `call-switch`.
2. While it is on, the sender `Home app` reports `inCall` with no app; turning it off removes that report. HomeKit's write is answered at once.
3. It turns itself off `callSwitch.hours` (1 to 12, default 3) after it was turned on. The time it was turned on is kept in the accessory context, so after a restart the switch is restored with the time remaining, or turned off if the time has passed.
4. Turned off when the configuration no longer enables it; the accessory is removed then (7 item 6).

#### 18.10 What a sender can and cannot do

1. A report enters the precedence of 6.3 like Teams presence; it cannot lower a higher status (a sender's `available` does not hide a calendar meeting).
2. The override switch (rule 1) still wins over everything.
3. A sender learns the overall status (`GET /v1/status`) and the names, statuses and apps of the active senders, nothing about calendars or events.

#### 18.11 Finding Busy Light by name

1. The UI server's `/input/info` resolves `{os.hostname()}.local` with `dns.lookup` (all addresses, 2-second timeout). When it resolves to at least one of the host's own non-internal addresses, that name is Busy Light's **host name** (for example `homebridge.local`; Raspberry Pi OS and the Homebridge image advertise it through Avahi). Otherwise there is no host name.
2. The settings page, the setup code and the CLI use the host name when there is one, and the first IPv4 address otherwise. The IPv4 addresses are always listed too, as a fallback.
3. The setup code is `busylight://{host}:{port}/?key={key}&id={id}`. An IPv6 address is written in brackets.
4. Without a host name, the page shows the help of 11.3 I asking the user to reserve the address in the router.
5. Busy Light does not advertise its own Bonjour service in this build (17).

### A.2 Changes to existing sections

**2.1** add: "9. A status input that lets any app on the local network report a status (section 18), and an On a Call switch in the Home app."

**6.3 Precedence**: a *presence signal* is Teams presence or an unexpired status input report. Rules 2 to 9 apply to every presence signal:

- Rule 2 adds: or a report says `outOfOffice`.
- Rule 3 adds: or a report says `doNotDisturb`.
- Rule 4 adds: or a report says `inCall`.
- Rule 5 adds: or a report says `inMeeting`.
- Rule 6 adds: or a report says `busy`.
- Rule 8 adds: or a report says `away`.
- Rule 9 adds: or a report says `available`.
- Rule 10 becomes: "There is no fresh Teams presence and no report says `offline`: `available`."
- Rule 11 is unchanged ("Otherwise: `offline`").

The reason's `source` is the sender's name, and with an `app`, the line in Right now reads `From {sender} ({app}).` (11.3 B). `until` is null for a report.

**6.5 Freshness and Unknown**: reports are fresh until they expire (18.7). Item 4 counts a report as fresh data. Item 5 becomes: "With no calendars configured and both the status input and the On a Call switch off, the status is `unknown`."

**7 HomeKit model**: add item 8 pointing to 18.9.

**9 Configuration**: add to the example and the rules:

```json
"statusInput": { "enabled": false, "port": 8582, "key": "", "allowPlainKey": true },
"callSwitch": { "enabled": false, "hours": 3 }
```

- Rule 17: `statusInput.enabled` is a boolean; `port` an integer from 1024 to 65535 (default 8582); `key` as 18.8; `allowPlainKey` a boolean, default true (so Shortcuts and a curl test work from the start; the page offers to turn it off once every sender signs). With `enabled` on and a missing or invalid key, the status input stays off with the error `statusInput.key: must be 32 to 128 letters, digits, hyphens or underscores`.
- Rule 18: `callSwitch.enabled` a boolean; `hours` an integer from 1 to 12 (default 3), falling back with a warning.
- `config.schema.json` gains both blocks (the standard form is no longer shown, but Homebridge checks the block against it).

**10.1 State file**: add

```json
"statusInput": { "enabled": true, "port": 8582, "listening": true, "error": null, "id": "q3Lr8vT0cXw2mN5a" },
"inputs": [ { "sender": "CallWatch on Alex’s iMac", "status": "inCall", "app": "Microsoft Teams", "via": "api", "lastHeard": "...", "expiresAt": "...", "active": true } ]
```

`via` is `api` or `switch`. `inputs` holds the senders of 18.7 item 5, each with `"auth": "signed"` or `"plain"` (the replay table stays in `inputs.json` only). The key is never in the state file.

**10.2 CLI**: add `input`:

| Command | Does |
| --- | --- |
| `input` | Prints whether the status input and the On a Call switch are on, the port, the instance id, the address by host name when there is one (18.11), the addresses of the Homebridge host (`http://{ip}:{port}`, one per non-internal IPv4 address), and the senders from the state file. |
| `input --setup-code` | Also prints the setup code, after the line `The setup code contains your key. Treat it like a password.` |
| `input test` | Sends a signed `inCall` for 30 seconds from the sender `Busy Light test` to the running plugin on `127.0.0.1`, using the configured key, and prints the response or the error. |

**10.3 UI server**: add

| Endpoint | Request | Response |
| --- | --- | --- |
| `/input/info` | none | `{ "hostname": "homebridge.local", "addresses": ["192.168.4.10"], "port", "id" }` (`hostname` as 18.11, or null; non-internal IPv4 addresses of the host; `id` from `instance.json`, created there if missing; the page builds the address and setup code) |
| `/input/test` | `{ "port", "key" }` | `{ "ok": true }` or `{ "error": "notListening" \| "unauthorized" \| "other", "message" }`: sends a signed `inCall` for 30 seconds from `Busy Light test` to `127.0.0.1:{port}` |

**11.1 Anatomy**: a new section between Calendars and Colors: **Status from other apps** (11.3 I).

**12 Logging**: add, verbatim:

| When | Level | Line |
| --- | --- | --- |
| Input started | info | `Status input is listening on port {port}.` |
| Input failed | error | `Status input could not start: port {port} is already in use.` (or `: {short reason}.` for any other failure) |
| Input key invalid | error | `statusInput.key: must be 32 to 128 letters, digits, hyphens or underscores` |
| Sender changed | info | `{sender} reports {Display name}.` or `{sender} reports {Display name} from {app}.` |
| Sender cleared | info | `{sender} cleared its status.` |
| Sender expired | info | `{sender}'s status expired.` |
| Wrong key | warn | `Status input: refused a request with a wrong key from {ip}.` (any failed authentication except `clock_skew` and `plain_key_off`; once per address per hour) |
| Clock off | warn | `Status input: refused a request from {ip} whose clock is {n} seconds off.` (once per address per hour) |
| Plain key off | warn | `Status input: refused a request from {ip} that sent the key itself. Turn on Allow the plain key, or have that app sign its requests.` (once per address per hour) |
| Not local | warn | `Status input: refused a request from {ip}, which is not on the local network.` (once per address per hour) |
| Call switch timeout | info | `{name} On a Call turned itself off after {n} hours.` |

Sender and app names are labels chosen by the sender and may be logged; nothing else from a request is.

**15 Testing**: add

16. Status API, by calling the request handler directly with synthetic request and response objects (no socket is opened, per `CLAUDE.md`), plus the server's start and port-in-use paths with `http.createServer` mocked: every row of 18.4, every error key, the check order of 18.4 item 8, constant-time comparison used for both forms, the signature against the test vector of `docs/status-input.md` 2.4, a signature over a body that differs by one byte, `clock_skew` at 301 seconds both ways and acceptance at 300, `replayed` for an equal and a smaller `ts` with `lastTs` in the answer, a report captured during a call and sent again after `clear` and again after expiry (both `replayed`), a replay table entry outliving the 20-sender display list, entries dropped once 300 seconds old, the table surviving a reload of `inputs.json`, the startup floor when `inputs.json` is missing (refused before startup time, accepted after, gone after 300 seconds), a captured signed `GET /v1/status` answered twice (the stated exception), the plain key form with `allowPlainKey` on and `plain_key_off` with it off (the key not compared), the `auth` recorded per sender, the text rule of 18.4 item 3 ("Alex’s iMac" accepted, NFC and NFD forms of one name matching one sender, 64 code points of emoji accepted and 65 refused, each refused character class), `clear` with and without an active report and with `ttlSeconds`, the `id` in `/v1/ping`, 403 for a non-local address (by injecting the remote address into the handler), rate limit and `Retry-After`, the 20-sender limit, `clear`, expiry with a fake clock and the expiry timer, `inputs.json` reload with expired entries dropped, no CORS headers, `OPTIONS` 405, and that no log line or response contains the key.
17. Precedence with inputs: each status at its rule, combined with Teams presence and calendar events, rule 10 with and without an `offline` report, the reason naming the sender and app.
18. On a Call switch: on, off, the safety timeout, restore after restart with the time remaining and after the time has passed.
19. Settings page: the Status from other apps section (11.3 I), key generation format, Replace key, the setup code built from `/input/info`, Test, the sender list; the per-calendar interval (part B); the color presets (part C).
20. CLI `input`, `input --setup-code` and `input test` (with `fetch` mocked), and the UI server's `/input/info` and `/input/test` (with `os.networkInterfaces`, `dns.lookup` and `fetch` mocked: a host name that resolves to the host, one that resolves elsewhere, one that times out).

**16 Release plan**: build 3 is this file; build 4 is the README screenshots and the first npm release (the former build 3).

**17 Decisions**: add, dated 2026-10-08: the status input is generic and independent of any sender app; two channels (HTTP API on the local network, HomeKit On a Call switch); statuses enter the existing precedence as presence signals; reports expire (default 180 s, at most 12 h); local addresses and a key only, no TLS; `docs/status-input.md` is the public description for app builders. Added the same day after review: apps sign requests with HMAC-SHA256 so the key never crosses the network (a laptop on another network could otherwise hand the key to whatever device has the home address there), with a per-sender replay rule; the plain key stays for Shortcuts and curl, behind a setting the user can turn off once every sender signs (one plain request seen on the network gives the key away). The replay table is kept apart from the display list, for 300 seconds after each `ts`, through `clear` and expiry, and across restarts, with a startup floor when it is lost; a replay of a captured `inCall` right after a call ends is refused. A signed `GET` is replayable within the window by design, being read-only. Names are Unicode (the macOS default computer name has a curly apostrophe), counted in code points after NFC. `clear` is idempotent and returns `expiresAt: null`. Busy Light is found by its `.local` host name when the host advertises one, so a DHCP change does not break senders; an own Bonjour service was considered and left for later, because Node has no built-in mDNS and the host already runs Homebridge's advertiser and usually Avahi on port 5353.

### A.3 Settings page copy, 11.3 I "Status from other apps" (verbatim)

- Heading: `Status from other apps`
- Help: `Let other apps on your network tell Busy Light you are on a call or busy, for example a call helper on your Mac or a Stream Deck button.` and the link `How apps connect` (`https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/status-input.md`, new tab)
- Checkbox: `Let other apps set your status`
- When ticked:
  - `Address`: read-only, monospace, `http://{host name}:{port}` first when there is a host name, then `http://{ip}:{port}`, one line per address from `/input/info`
  - With no host name, the help `Your router may give Homebridge a new address later, and apps would stop reaching it. Reserve this address for Homebridge in your router.`
  - `Key`: read-only password field with `Show` and `Hide`, and the button `Copy key` (then `Copied`)
  - `Setup code`: read-only, monospace, `busylight://{host}:{port}/?key={key}&id={id}` (the host name, or the first address, as 18.11), the button `Copy setup code` (then `Copied`), and the help `Paste this into the app that will report your status. It contains your key, so treat it like a password.`
  - Text button `Replace key`, inline question `Replace the key? Every app using the current key stops working until you give it the new one.` with `Replace` (danger) and `Cancel`
  - Button `Test` (busy `Testing…`), help `Reports a call for 30 seconds, so the light should turn red.`; results `Busy Light received the test.`, and for `notListening` `Busy Light is not listening yet. Save, restart Homebridge, then test again.`, for `unauthorized` `The running Busy Light has a different key. Save and restart Homebridge, then test again.`
  - State-file error: `Busy Light could not open port {port}. Another program may be using it. Choose another port under Advanced.`
  - Checkbox `Allow the plain key`, ticked by default, help `Apps that sign their requests never send the key. Apple Shortcuts and curl send the key itself, so anyone watching your network could copy it. Turn this off once every app below shows Signed. If the key may have been seen, replace it too.`
  - Advanced disclosure: `Port` (1024 to 65535, default 8582), help `Change it only if another program on this computer already uses {port}.`
- Subheading: `Apps reporting now`
  - Empty: `No app has reported in the last 12 hours.`
  - Row: the sender name; the status display name, and ` from {app}` when there is one; the meta `Last heard {relative time}`; the badge `Active` (success tone) or `Expired` (secondary tone); and the badge `Signed` (secondary tone) or `Plain key` (warning tone) for how its last report authenticated. The Home app switch appears as the sender `Home app`, with no authentication badge.
- Checkbox: `Add an On a Call switch to the Home app`, help `Turn it on from a shortcut, Siri or a Home tile while you are on a call. Useful for apps that should not make network requests themselves.`
  - When ticked: `Turn it off by itself after (hours)` (1 to 12, default 3)
- Validation (11.3 H style): port `Enter a whole number from 1024 to 65535.`; hours `Enter a whole number from 1 to 12.`

The page generates the key when the checkbox is first ticked and no key exists. Changes apply after Save and a Homebridge restart, as everywhere on the page.

---

## B. Per-calendar check interval

1. **9.1 rule 19**: any source may have `calendarSeconds`, an integer from 60 to 600. Missing means the platform `calendarSeconds`. Invalid falls back with a warning.
2. **8.1 item 2** becomes: reload any calendar source whose last check is older than its own `calendarSeconds`, or the platform's when it has none.
3. **11.3 C**, every card: an Advanced disclosure at the bottom of the card body with `Check for changes every (seconds)` (60 to 600), empty by default, placeholder `e.g. {platform value}`, help `Leave empty to use Reload calendars every, under Settings.` Validation `Enter a whole number from 60 to 600.`
4. **15**: a test that two sources with different intervals reload on their own schedules.

---

## C. Color presets

Replaces the row described in **11.3 D** (the configuration format does not change: colors stay `#RRGGBB` or `off`).

1. Each status row shows its display name and a group of preset swatches, as a radio group: `Red` `#FF0000`, `Orange` `#FF6A00`, `Yellow` `#FFD000`, `Green` `#00FF00`, `Blue` `#0050FF`, `Purple` `#B400FF`, `White` `#FFFFFF`, `Off`, and `Custom`.
2. Each swatch is a button showing its color (Off as an outlined circle with a line through it, Custom as a swatch of the current custom color with the label), with the name as its accessible label and `aria-checked` for the chosen one. Arrow keys move between them; the names appear as tooltips and, below 600 px, as text under each swatch.
3. A saved color equal to a preset (without regard to case) selects that preset. Any other `#RRGGBB` selects Custom.
4. Choosing Custom shows the browser's color picker and the hex field (monospace) beside it, with the validation `Enter a color as #RRGGBB, for example #FF0000.` They are hidden otherwise.
5. The defaults of 6.2 are presets: Out of office Purple, Do not disturb, In a call and In a meeting Red, Busy Orange, Tentative and Away Yellow, Available Green, Offline Off. `Reset colors` restores them.
6. The `Teams only` badges and the line `When more than one applies, the one highest in this list wins.` stay.
7. **17**, open item: check each preset on a real LIFX bulb and adjust the hex values where the bulb renders them poorly (orange and yellow especially). The configuration keeps whatever hex the user saved.

---

## D. The bulb in use, shown when the page opens

Found in the pass on the Pi, October 8, 2026: with LIFX already on, the page opens with only `Search again` under "Use a LIFX bulb", because no search runs on open (11.2 item 5). It reads as if no bulb is set up, which is the confusion build 2 set out to remove. The state file already knows the bulb, so no network call is needed.

1. **11.3 E**: with "Use a LIFX bulb" on, no IP address under Advanced, and no search yet in this visit, the results line comes from the state file's `light` (10.1), read through `/status`:
   - With a `label` and `host` and `answered` true: `Busy Light is using {label} ({host}).`
   - With a `label` and `host` and `answered` false: `Busy Light is using {label} ({host}), but it did not answer last time.`
   - With no light in the state file (the plugin has not found one, or has not run since LIFX was turned on): `Busy Light has not found a bulb yet. Search again to look for one.`
2. `Search again` stays below the line, and a search replaces the line with its results as now.
3. **11.2 item 5** is unchanged: opening the page still calls only `/version` and `/status`.
4. **15**: page tests for the three lines, and that opening the page with LIFX on makes no `/lifx/discover` call.

