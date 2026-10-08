# homebridge-generac SPEC

Source of truth for the plugin. Every build updates this file, README.md and CHANGELOG.md. UI copy lives in section 11.3 and is used verbatim.

Status: draft 1, September 15, 2026. Auth flow validated live on September 15, 2026.

## 1. Overview

**homebridge-generac** (display name "Generac for Homebridge") exposes the standby generators on a Generac Mobile Link account to HomeKit. It is read only.

Each generator becomes one accessory with:
- **Running** contact sensor: open while the engine runs.
- **Fault** contact sensor: open on Warning status, active alarms or warnings, or the control switch in OFF.
- **Maintenance Due** contact sensor: open when Generac flags service.
- **Battery** service: starting-battery voltage as a level plus HomeKit's low-battery flag.

Optionally, one **Attention needed** occupancy sensor for the platform, on while the plugin cannot sign in.

Successor to the unmaintained `homebridge-mobilelink`. Ground-up rewrite; no code shared.

## 2. Scope

### 2.1 In scope for 0.1.0
1. One Mobile Link account per Homebridge instance.
2. Sign-in from the settings page (email, password, then an SMS, authenticator or email code), or from the CLI.
3. Generators (apparatus type 0).
4. Adaptive polling with backoff.
5. Per-generator display name override.
6. Settings page on the Homebridge plugin shell.
7. Exercising sensor with retroactive detection from the last-exercise event.

### 2.2 Deferred
1. Propane tank monitors (type 2) as a battery-percentage accessory: on hold until a tester with a tank monitor volunteers. No release is planned, and nothing the plugin shows promises it.
2. Remote start, stop or exercise. No command endpoint has been validated and the plugin stays read only until one is.
3. Multiple accounts.

### 2.3 Never
1. Storing the Mobile Link password anywhere.
2. Sending `Authorization: DPoP` to the resource server (section 5.3).
3. Using Generac's logo, wordmark, brand orange or the `heroImageUrl` asset.

## 3. Names and versions

- npm: `homebridge-generac`. GitHub: `arodbuilds/homebridge-generac`, default branch `latest`.
- Platform alias in config.json: `Generac`. Default `name`: `Generac`.
- Display name in package.json (`displayName`): `Generac`. Banner, README title and settings-page banner: `Generac for Homebridge`.
- Versioning: `0.1.0-beta.1` first, betas on the npm `beta` tag, then `1.0.0` as first stable.
- Node `^20.18.0 || ^22.10.0 || ^24.0.0`. Homebridge `^1.8.0 || ^2.0.0-beta.0`.
- CI tests on Node 20, 22 and 24.
- Runtime dependencies: `@homebridge/plugin-ui-utils` only. Auth and HTTP use Node built-ins.
- License Apache-2.0, copyright line "Copyright 2026 Alex Rodriguez (arodbuilds) https://alex-rodriguez.com". NOTICE credits the ha-generac auth flow (sslivins, pjordanandrsn) and homebridge-mobilelink (Nicholas Penree).

## 4. Authentication

### 4.1 Flow
Generac moved Mobile Link login to Auth0 on April 21, 2026. The tenant is `auth.ecobee.com` (Generac owns ecobee). The plugin performs the iOS app's flow:

1. `GET /authorize` with PKCE (S256), `dpop_jkt` = thumbprint of a fresh P-256 key, `client_id` = the iOS app's, `redirect_uri` = the app scheme, `audience https://prod.ecobee.com/api/v1`, `scope openid email offline_access invoke:api`, `prompt=login`. Follow the 302 to `/u/login/identifier` and keep its `state`.
2. `POST /u/login/identifier?state=` with `username`, `js-available=true`, `webauthn-available=true`, `is-brave=false`, `webauthn-platform-available=true`, `action=default`. Expect 302 to `/u/login/password`.
3. `POST /u/login/password?state=` with `username`, `password`, `action=default`. Expect 302 to `/authorize/resume`. A 400 with no `data-error-code` means the password was never reset after April 21, 2026 (Generac did not migrate password hashes).
4. `GET /authorize/resume?state=` in a loop (max 3):
   - 302 to the app scheme: take `code`, done.
   - 302 to `/u/mfa-sms-challenge`, `/u/mfa-otp-challenge` or `/u/mfa-email-challenge`: ask the user for the code; `POST` it with `state`, `code`, `action=default`. Wrong code re-presents the challenge; allow three tries.
   - 302 to any other `/u/mfa-*`: unsupported factor (push, WebAuthn, voice). Fail with the copy in 11.3.
   - 302 to `/u/custom-prompt/*`: `POST state, action=default` once to accept; continue.
5. `POST /oauth/token` (JSON) with `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, and a `DPoP` proof header. On `400 use_dpop_nonce`, retry once with the returned `dpop-nonce`.

All login requests carry the iOS Safari user agent; token and API requests carry the Mobile Link CFNetwork user agent. A cookie jar is required across steps 1 to 4; the final hop is an app-scheme URL, so all redirects are followed manually.

### 4.2 Refresh
`POST /oauth/token` with `grant_type=refresh_token` and a DPoP proof. Access tokens last 7200 s. Auth0 does **not** rotate this client's refresh tokens (validated: two refreshes returned the same token). The plugin refreshes 120 s before expiry and never re-logs-in on its own.

### 4.3 Revocation
Changing the Mobile Link password revokes the refresh token (validated September 15, 2026: `403 invalid_grant "Unknown or invalid refresh token"`). On `invalid_grant` the plugin enters **Reconnect needed**: logs once at error level, turns the Attention needed sensor on if enabled, marks sensors not responding, and retries the refresh hourly in case the token was merely delayed. It never asks for a password.

### 4.4 Storage
Credentials live outside config.json at `<homebridge storagePath>/homebridge-generac/credentials.json`, mode 600, written atomically (temp file plus rename):

```json
{ "email": "you@example.com", "refresh_token": "…", "dpop_private_key_pem": "…", "created_at": "2026-09-15T15:22:34Z" }
```

The platform re-checks this file every 60 s while it has no working client, so a sign-in from the settings page takes effect without a restart. Fallback read locations, in order: `credentialsPath` from config if set; `~/.homebridge/homebridge-generac/credentials.json`.

## 5. Mobile Link API

Base `https://app.mobilelinkgen.com/api/v5`. Bearer auth. `Accept: application/json`.

### 5.1 Endpoints
- `GET /Apparatus/list` → array of apparatus summaries. Fields used: `apparatusId`, `type`, `name`, `serialNumber`, `modelNumber`, `apparatusStatus`, `isConnected`, `showWarning`.
- `GET /Apparatus/details/{id}` → full detail. See the fixture `test/fixtures/details-generator-ready.json`. Returns 500 for non-Generac devices (linked ecobee), which the plugin treats as skip, not failure.

### 5.2 Apparatus types
| type | meaning | handling |
|---|---|---|
| 0 | generator | accessory |
| 1 | unknown | log once, skip |
| 2 | propane tank monitor | log once as not supported, skip |
| 7 | linked ecobee thermostat | log once as skipped, never call details |

### 5.3 Bearer, not DPoP
The access token is DPoP-bound (`cnf.jkt`) but the resource server does not implement DPoP. `Authorization: DPoP` with a valid proof returns 401. Send `Authorization: Bearer <token>` to the API and DPoP proofs only to `/oauth/token`. This is documented inline in `api.ts` and must not be "fixed."

### 5.4 Rate limits
Generac rate-limits per account and has publicly objected to third-party polling. The plugin logs in never, refreshes at most every ~2 hours, and polls per section 8.

## 6. Data model

`toGeneratorState(detail, list, options)` in `model.ts` is pure and fixture-tested.

- `apparatusStatus`: 1 Ready, 2 Running, 3 Exercising, 4 Warning, 5 Stopped, 6 Communication Issue, 7 or 0 Unknown. `statusLabel` and `statusText` from the payload are shown in the UI when present.
- Properties are keyed by numeric `type`, never by `name`: 70 Battery Voltage (string "13.6"), 71 Engine Hours (number), 95 Exercise Minutes (string, minutes past midnight: 605 = 10:05 AM), 88 Fuel Type (string enum: 1 natural gas; 2 and 3 presumed propane and diesel), 32 Hours of Protection (number). Values are coerced from mixed string and number.
- `fault` is true when any of: status Warning; status Stopped and `faultOnStopped`; status Communication Issue or `isConnected=false` and `faultOnDisconnected`; `showWarning`; `alarms[]` non-empty; `warnings[]` non-empty; `currentAlarm` not "0". `faultReasons[]` lists which.
- `maintenanceDue` = `hasMaintenanceAlert || maintenance[].length > 0`.
- `exercising` = status 3. `lastExerciseAt` = `alert.timestamp` when `alert.eventType` is 42, else null. The event is recorded at exercise completion (observed: 10:06 for a 10:00 start).
- `connected` = `isConnected`.
- Battery percent = linear map of volts from 11.8 (0) to 12.8 (100), clamped. Low = volts ≤ `batteryLowVoltage`. Charging state reported as Not chargeable.
- `weather.temperature` may be F or C; normalised to F for display only.

## 7. HomeKit model

One `PlatformAccessory` per generator, UUID from `homebridge-generac:generator:{apparatusId}`. Display name = `generators[].name` override if present, else the Mobile Link name.

Services:
1. AccessoryInformation: Manufacturer "Generac", Model = productInfo Description (e.g. "22KW/999 GUARD-NO T/SW AL") else `modelNumber`, SerialNumber, FirmwareRevision = the numeric part of the plugin version ("0.1.0" for "0.1.0-beta.1"), since HAP truncates pre-release suffixes.
2. ContactSensor subtype `running`, name "{Name} Running". Open (CONTACT_NOT_DETECTED) while `running`.
3. ContactSensor subtype `fault`, name "{Name} Fault". Open while `fault`.
4. ContactSensor subtype `maintenance`, name "{Name} Maintenance Due". Open while `maintenanceDue`.
5. Battery: BatteryLevel, StatusLowBattery, ChargingState NOT_CHARGEABLE.
6. ContactSensor subtype `exercising`, name "{Name} Exercising", created when `exerciseSensor` is true. Opens when a poll observes status 3, or when `lastExerciseAt` changes to a newer value than the one persisted in state.json (retroactive). Stays open until both the status has left 3 and `exerciseHoldMinutes` have elapsed since the last trigger. On first run the current `lastExerciseAt` is recorded without opening the sensor. Live detection relies on the exercise watch window (section 8), which runs from 10 minutes before the exercise time until 20 minutes after it.

Every contact sensor carries `StatusActive` (= `connected`, and false after three consecutive poll failures) and `StatusFault` (= `fault`). ConfiguredName is set once and never overwritten so the user's Home app renames stick.

Getters return cached state and never throw. `update()` pushes every poll and is not gated on identity fields.

Platform-level optional accessory: OccupancySensor "Generac Attention Needed" (UUID `homebridge-generac:attention`), created only when `attentionSensor` is true, occupancy detected while in Reconnect needed. Removed when the setting is turned off.

Not an Outlet, Switch or any other service. Rationale in README.

## 8. Polling and backoff

- Idle interval `pollIdleMinutes` (default 10, minimum 2). Used when no generator is active.
- Active interval `pollActiveSeconds` (default 90, minimum 60). Used while any generator is Running, Exercising or `fault`.
- One poll = `/Apparatus/list` then `/Apparatus/details/{id}` for each type-0 apparatus. A details failure for one generator logs a warning and continues with the others.
- On any other failure: exponential backoff with ±20% jitter starting at the active interval, capped at 30 minutes. After three consecutive failures, sensors report StatusActive false.
- On `invalid_grant`: Reconnect needed state, retry hourly.
- A poll is triggered immediately when credentials appear or change on disk.
- Exercise watch window: when `exerciseTime` is set (or derivable from the API), poll at the active interval from 10 minutes before it until 20 minutes after it, every day, in the host's local time zone: 30 minutes a day at the active interval. It opens early because the unit can start before the time Mobile Link reports (section 16, September 26, 2026). A window that crosses midnight is handled: an exercise at 00:05 opens the window at 23:55 the day before. `WATCH_BEFORE_MINUTES` = 10 and `WATCH_AFTER_MINUTES` = 20 in `exercise.ts`.

## 9. Configuration (config.json)

```json
{
  "platform": "Generac",
  "name": "Generac",
  "pollIdleMinutes": 10,
  "pollActiveSeconds": 90,
  "batteryLowVoltage": 12.0,
  "faultOnStopped": true,
  "faultOnDisconnected": false,
  "attentionSensor": false,
  "exerciseSensor": true,
  "exerciseTime": "10:00",
  "exerciseHoldMinutes": 5,
  "debug": false,
  "credentialsPath": "",
  "generators": [
    { "apparatusId": 2053735, "name": "Blue Door" }
  ]
}
```

No secrets in config.json. `generators[]` holds only display-name overrides and is written by the settings page's Rename. Unknown ids are ignored. `credentialsPath` is Advanced-only and absent from the settings page. `exerciseTime` is a 24-hour "HH:MM" string and optional; when absent the API's Exercise Minutes value is used as the default.

`config.schema.json` mirrors these keys with the labels and help from 11.3 and sets `customUi: true` (build 2).

## 10. UI server (build 2)

`src/ui/server.ts` on `@homebridge/plugin-ui-utils`, compiled with the platform and started through `homebridge-ui/server.js` (the file the Homebridge UI looks for), so it shares the auth, credentials and state modules. Endpoints:

| endpoint | request | response |
|---|---|---|
| `/status` | none | `{ account: { state: "not_connected" \| "checking" \| "connected" \| "reconnect_needed", email?, lastChecked? }, generators: [GeneratorState], others: [{ type, name }], version }`. `checking` when credentials exist but state.json has no account entry newer than the credentials' `created_at`. |
| `/connect/start` | `{ email, password }` | `{ step: "code", method: "sms" \| "otp" \| "email" }` or `{ step: "done" }` or `{ error: "wrong_password" \| "unknown_email" \| "unsupported_factor" \| "network" }` |
| `/connect/code` | `{ code }` | `{ step: "done" }` or `{ error: "wrong_code" \| "too_many" \| "expired" }` |
| `/connect/cancel` | none | `{ ok: true }` |
| `/disconnect` | none | `{ ok: true }` (deletes credentials.json and clears the account section of state.json) |
| `/reset` | none | `{ ok: true }` (the Reset dialog: deletes credentials.json and state.json and leaves a `reset-pending` marker under the data directory; the platform removes every cached accessory on its next start and deletes the marker) |

Rename does not go through the server: it edits `generators[]` in the page through `homebridge.getPluginConfig()` and `updatePluginConfig()`; the host's SAVE persists it.

The login runs inside the UI server process. `/connect/start` calls `login()` with an `mfaPrompt` that returns a promise resolved by the next `/connect/code`. The pending login expires after 5 minutes (`expired`). The password is held in memory for the duration of `login()` and never written or logged. On success the server writes credentials.json; the platform picks it up within 60 s (section 4.4).

`/status` reads credentials.json and the platform's last state file `<storagePath>/homebridge-generac/state.json`, which the platform writes after every poll (generator states, other devices, timestamp, account state). The UI never calls Generac directly except during Connect.

## 11. Settings page (build 2)

### 11.1 Anatomy, top to bottom
1. Banner (shell banner component; the only place the plugin carries colour).
2. Intro paragraphs (11.3 A).
2a. Affiliation line, muted, directly under the intro (11.3 A). It is never in the footer.
3. "Mobile Link account" heading, one line of help, the account card in one of four states (11.3 B). Connect and Reconnect replace the card in place with the two-step flow (11.3 C).
4. "Generators" heading, one line of help, one card per generator (11.3 D) or the empty line. Under the cards, one "Also on your account" line per non-generator device.
5. "Settings" heading and a single collapsed Disclosure (11.3 E). Nothing else shows when collapsed.
6. Closing line, CreditFooter (mark, name, version, site link with `?ref=generac`, issues link).

Desktop max width 800 px in the host modal; phone layout at 390 px collapses the 12-column grid to single column. Both host themes.

### 11.2 Shell invariants
Inherit `homebridge-notify-switch` `design/HANDOFF.md` and its SPEC 11.2 item 28 in full: no palette of its own, host variables for every colour, `:root` rules for anything that must win, iframe never scrolls, no `vh` or sticky, validation on blur with "{Label} is required.", sentence case, uppercase buttons from `text-transform` only, no em dashes, no emoji, placeholders italic "e.g." examples.

Generac additions:
- Status badges on the generator card use the host's success (Ready), info (Running, Exercising), danger (Fault) and secondary (Not responding) subtle variables.
- `crypto.randomUUID` is unavailable over plain http in the host; do not use it in the UI (Peloton build 3 finding).
- The Rename control is the card's footer button and edits in place; Save persists.
- The account card is redrawn from every `/status` response. The Connect flow replaces the card in place and hands control back to the card renderer when it ends; it never leaves a view of its own behind. The Disconnect question is page state, so a redraw keeps it open.
- Reset (Settings disclosure) calls `/reset`, then replaces the platform block with the defaults through `updatePluginConfig()`; the host's SAVE persists it and the restart that follows removes the accessories.
- Dialogs are never fixed-position overlays: the page sits in an iframe the host sizes to its content, so `position: fixed` pins to the iframe's own top and a dialog can land off-screen (Alex's pass, September 15, 2026). The Reset dialog renders inline directly below the Reset link and the Disconnect question inline on its card; after either opens, the page calls `scrollIntoView({ block: 'center' })` on it, which scrolls the host's modal (same-origin iframe).
- Dialogs and confirmations use the host's card surface and text variables in both themes; no white-on-dark cards.

### 11.3 Copy (verbatim)

**A. Intro**
- Banner title: `Generac for Homebridge`
- Banner tagline: `Standby generator status in the Home app`
- Intro 1: `Generac for Homebridge shows the standby generators on your Mobile Link account in the Home app. Each generator appears as a Running sensor, a Fault sensor, a Maintenance Due sensor, an Exercising sensor and a starting battery reading.`
- Intro 2: `It is read only. It cannot start, stop or exercise the generator. Connect your account below and your generators are found for you.`
- Account heading: `Mobile Link account`
- Account help: `One account per Homebridge instance. Use the email and password you use in the Mobile Link app.`
- Generators heading: `Generators`
- Generators help: `Every generator on the account gets a card here. You can rename each one.`
- Generators empty: `No generators yet. Connect your Mobile Link account above and they appear here within a minute.`
- Settings heading: `Settings`
- Closing: `Your generators appear in the Home app as sensors. Add them to automations; for example, turn on a light when Running opens.`
- Affiliation: `Not affiliated with or endorsed by Generac Power Systems, Inc. Generac and Mobile Link are its trademarks. Uses Generac's undocumented Mobile Link API, which can change without notice.`

**B. Account card**
- Card title: `Mobile Link account`
- Not connected body: `Sign in once with your Mobile Link email and password. Your password is used to sign in and is not stored.`
- Not connected button: `Connect`
- Checking badge: `Checking`. No Connect button.
- Checking body: `Signed in. Homebridge picks up the new sign-in within a minute.`
- Checking slow line, added with no other change when `/status` still reports `checking` 120 seconds after the code step (or after the page first saw the Checking state): `Homebridge hasn't picked it up yet. Restart Homebridge from Power Options.`
- Connected badge: `Connected`
- Connected meta: `Last checked {relative time}`
- Disconnect link: `Disconnect`
- Disconnect question: `Disconnect this account? The plugin will stop updating your generators until you connect again.` Buttons `Disconnect` (danger) and `Keep`.
- Reconnect badge: `Reconnect needed`
- Reconnect body: `Mobile Link signed this plugin out. This happens after a password change or if Generac revokes access. Sign in again to resume updates.`
- Reconnect attention line (only when the sensor is on): `The Attention needed sensor is on in HomeKit until you reconnect.`
- Reconnect button: `Reconnect`

**C. Connect flow**
- Step 1 fields: `Email` (placeholder `e.g. you@example.com`), `Password` (help `Used once to sign in. Not stored.`)
- Step 1 buttons: `Sign in`, `Cancel`. Busy label `Signing in…`
- Wrong password: `Mobile Link rejected that password. If you haven't reset it since Generac's security update on April 21, 2026, reset it in the Mobile Link app, then try again.`
- Unknown email: `Mobile Link doesn't recognize that email.`
- Network: `Couldn't reach Mobile Link. Try again in a minute.`
- Step 2 title: `Enter your code`
- Step 2 body SMS: `Mobile Link texted a code to the phone on your account.`
- Step 2 body authenticator: `Enter the code from your authenticator app.`
- Step 2 body email: `Mobile Link emailed a code to {email}.`
- Step 2 second line: `Didn't get it? Cancel and sign in again.`
- Step 2 field: `Code` (mono, placeholder `e.g. 123456`)
- Step 2 buttons: `Continue`, `Cancel`
- Wrong code: `That code didn't work. Check for a newer message and try again.`
- Three failures (Continue disabled): `Too many attempts. Cancel and sign in again.`
- Expired: `That sign-in timed out. Cancel and sign in again.`
- Unsupported factor: `Your account uses a sign-in method this plugin can't complete. In the Mobile Link app, switch to text message or an authenticator app, then try again.` Single button `Cancel`.

**D. Generator card**
- Title: generator name; badge `Maintenance due` (warning) when flagged
- Subtitle lines: model; `S/N {serial}`
- Status badges: `Ready to run` (or Generac's `statusLabel` when present), `Running`, `Exercising`, `Fault`, `Not responding`
- Fault reasons, one per line, from `faultReasons` rendered as: `Switch in OFF`, `{n} active alarm(s)`, `{n} active warning(s)`, `Alarm code {code}`, `Warning status`, `Lost connection`
- Not responding note: `Mobile Link hasn't heard from this generator since {time}.`
- Rows: `Battery` `{volts} V` with badge `Low` at or below threshold; `Fuel` `{percent}%` with help `Propane models only` (row hidden on non-propane units); `Engine hours` `{n} h`; `Exercise time` `{time} weekly` (the configured `exerciseTime`, 12-hour, else the API value); `Last exercise` `{date} at {time}`; `Last seen` `{relative time}`
- Footer button: `Rename`. Inline field label `Name`, buttons `Save name`, `Cancel`. Required message `Name is required.`
- Also lines: `Also on your account: Propane tank monitor (not supported).` and `Also on your account: ecobee thermostat "{name}" (already in HomeKit, skipped).`

**E. Settings (Advanced disclosure)**
- `Name` (required, default `Generac`)
- `Poll interval while idle (minutes)` default 10, min 2, help `Mobile Link updates every few minutes and limits how often you can check. Faster than this rarely helps.` Error `Minimum is 2 minutes.`
- `Poll interval while running or in fault (seconds)` default 90, min 60, help `Used while a generator is running, exercising, or reporting a problem.` Error `Minimum is 60 seconds.`
- `Low battery threshold (volts)` default 12.0, help `A healthy starting battery on charge reads 13.4 to 13.8 V.` Renders with one decimal place (12.0) on load and after blur and accepts one decimal on input. Error for more than one decimal: `Enter volts with one decimal place, for example 12.0.`
- `Treat Stopped as a fault` default on, help `Stopped means the control switch is in OFF and the generator won't start during an outage.`
- `Treat a lost connection as a fault` default off, help `Off by default. Wi-Fi drops are common and the sensors already show Not responding.`
- `Attention needed sensor` default off, help `Adds an occupancy sensor to HomeKit that turns on when the plugin needs you to reconnect.`
- `Exercising sensor` default on, help `Adds a sensor that opens while the weekly exercise runs, or when Mobile Link reports one finished. Use it to confirm the generator exercised this week.`
- `Exercise time` (HH:MM, 24-hour, optional, placeholder `e.g. 10:00`) help `When your generator's weekly exercise starts. Prefilled from Mobile Link; correct it if your unit starts at a different time. The plugin checks more often around this time every day.` Error `Enter a time as HH:MM, for example 10:00.`
- `Exercise hold (minutes)` default 5, min 1, help `How long the Exercising sensor stays open after an exercise is detected.` Error `Minimum is 1 minute.`
- `Debug logging` default off, help `Verbose logging. Your password is never logged, even with this on.`
- Reset dialog lines: `Signs out of Mobile Link and removes the saved sign-in.`, `Removes every generator and its sensors from the Home app.`, `Clears all settings on this page.`
- Confirmation input accepts RESET in any case.
- Reset done state (replaces the dialog after Confirm): title `Reset done`, body `Click Save, then restart Homebridge to remove the generators from the Home app. Reconnect your Mobile Link account afterwards if you want them back.`

**F. Shell strings** (the plugin shell's own copy, shared with the author's other plugins)
- Disclosure summary: `Advanced`
- Reset: button `Reset plugin to fresh install`, dialog title `Reset plugin to fresh install?`, prompt `Type RESET to confirm.`, button `Confirm`, text button `Cancel`, done toast `Signed out and reset. Click Save, then restart Homebridge.`
- Password field toggle: `Show`, `Hide`
- Required field: `{Label} is required.`
- Credit footer: `Made by Alex Rodriguez`, `alex-rodriguez.com`, `Report an issue`
- Relative times: `just now`, `1 minute ago`, `{n} minutes ago`, `1 hour ago`, `{n} hours ago`, `1 day ago`, `{n} days ago`
- Failures of the host itself: `Could not load the configuration.`, `Could not update the configuration.`

## 12. Logging

- Info: credentials source on start; generator added, restored or removed; every status, fault or connection transition with battery voltage; one-time lines for skipped devices.
- Warn: poll failures with HTTP status and retry delay; unreadable credentials with the fix.
- Error: `invalid_grant` once per episode with the reconnect instruction.
- Debug (when `debug`): auth step redirects (redacted, then truncated), token refresh events, per-poll timing.
- Never: passwords, refresh tokens, access tokens, DPoP keys, MFA codes, authorization codes, sign-in `state` values, full HTML bodies.
- Redaction: every sign-in redirect that reaches a log line or an `AuthError` message goes through `redactUrl()` in `auth.ts` first, then `truncate()` (160 characters). `redactUrl()` replaces the values of the `code`, `state`, `nonce`, `code_challenge`, `code_verifier`, `id_token`, `access_token` and `refresh_token` parameters, in the query and in a `#fragment`, with `REDACTED` and keeps the key names, so a line still shows the shape of the redirect: `302 -> com.generac.mobilelink.auth0://…/callback?code=REDACTED&state=REDACTED`. Token endpoint failures (`token` and `refresh`) put only `error` and `error_description` from the payload in the message, never the whole payload or an HTML body.
- CLI `homebridge-generac login`: when a sign-in step fails it prints the step, the HTTP status and the Auth0 error code, and writes no file. With `--debug` it also saves the page to `<step>-<status>.html`, mode 600, in a `debug` folder (mode 700) next to the credentials file: `<storage>/homebridge-generac/debug/` by default (the same storage path the credentials use), or beside the `--out` file. Before writing, `redactBody()` applies the `redactUrl()` rules to every URL in the page and redacts the same keys as hidden form fields (`<input name="state" value="…">`) and JSON fields, plus anything shaped like a JWT. Nothing is ever written to the working directory. Usage: `homebridge-generac <login [--out file] [--debug] | status [--creds file]>`.
- Captures (when `debug`): on any status change or a new `lastExerciseAt`, the raw details payload is written to `<storagePath>/homebridge-generac/captures/{ISO timestamp with colons replaced by dashes}-status{n}.json`, keeping the newest 10.

## 13. Assets and branding

`assets/` holds the Claude Design export: `generac-512.png`, `generac-192.png`, `generac-mark.svg`, `generac-dark.svg`, `generac-light.svg`, `generac-footer.svg`, `generac-banner.png` (1280×320), `generac-social.png` (1280×640). Banner text: "Generac for Homebridge" and "Your standby generator in HomeKit. Status, battery, run hours and alerts from Mobile Link."

`assets/screenshots/` holds the masked README screenshots, rendered against a fake host with fictional data: `account-connected.png`, `connect-code.png`, `generator-ready.png`, `generator-fault.png` and `settings-advanced.png`. Screenshots never show a real email, serial number, address or account name. The banner and the screenshots are referenced from the repository and are not shipped in the npm package.

2026-09-25: Decided to keep the mark colour (#E8862B); the affiliation line and display name carry the non-affiliation.

## 14. Testing

- Unit, fixture-driven, no network: `model.ts` against `details-generator-ready.json` and synthesised Running, Exercising, Stopped, Warning, alarm, disconnected and maintenance variants; battery mapping; exercise time; property coercion.
- Auth unit: DPoP thumbprint known-answer against a fixed PEM; proof header and payload shape; `use_dpop_nonce` retry; `invalid_grant` classification; Auth0 error-code extraction; challenge path detection; redaction (a callback redirect logs `code=REDACTED`, an unexpected redirect's message carries no code or state value, a failed token exchange's message carries only `error` and `error_description`).
- CLI: `login` runs as a child process with `fetch` replaced by a scripted Auth0 (`test/cli-auth0-stub.ts`, loaded with `node --import`). No file is written without `--debug`; with it, the redacted page lands under the storage directory with mode 600.
- API unit with mocked `fetch`: token cached until 120 s before expiry; concurrent calls share one refresh; 401 clears the token; 500 on details is per-apparatus.
- Platform unit: type routing (0 accessory, 2 and 7 log-once), name override, backoff schedule, invalid_grant hourly.
- Live on the Pi: `homebridge-generac status`; Homebridge log on first start; Home app sensors; a captured Exercising payload as the second real fixture.

## 15. Release plan

1. Build 1: source, tooling, CLAUDE.md, release workflow, tests, version 0.1.0-beta.1. Pi test via symlink from the Homebridge web terminal.
2. Build 2: state file consumer, UI server, settings page, `customUi`, Rename, Exercising sensor with watch window and retroactive detection, captures. Chrome pass on the Pi in both themes and at phone width.
3. Build 3: affiliation line moved, README with masked screenshots, SECURITY.md, CHANGELOG dated, release workflow with a one-time token fallback for the first publish. Then: GitHub pre-release `v0.1.0-beta.1` publishes to npm `beta` with provenance; switch the npm package to a GitHub Actions trusted publisher and delete the token; reinstall from npm on the Pi through the Homebridge UI; r/homebridge tester post.
4. Soak, then r/homebridge tester post, then `1.0.0`, then the Homebridge verification issue (keywords must include `supports-hap`).
5. Propane tank monitors: on hold until a tester with a tank monitor volunteers.
6. 1.0.0: engines and CI on Node 20, 22, 24; beta defects fixed; README status line removed; GitHub release marked latest publishes to npm `latest`. Then the Homebridge verification issue.
7. 1.0.1 (build 5), during verification review: CLI `login` redaction and debug files under the storage directory only with `--debug` (section 12); exercise watch window opens 10 minutes early (section 8); Intro 1 names the Exercising sensor and drops the propane promise (11.3 A); propane tank support on hold, with every promise removed from the settings page, the log and the README (sections 2.2, 5.2, 11.3 D).

## 16. Decisions and open items

- 2026-09-15: Contact sensors, not an Outlet. Stopped is a fault by default. Disconnected is not.
- 2026-09-15: Refresh-token-only runtime; the password is never persisted. Confirmed necessary: password change revokes the token, so a stored password would only enable a headless re-login that SMS MFA blocks anyway.
- 2026-09-15: Idle poll default 10 minutes (HA project settled on 15; Generac's cloud updates every few minutes). Active poll 90 s.
- 2026-09-15: Keep by property `type`, not `name`.
- 2026-09-15: Rename kept from Design; "hide sensors" dropped.
- 2026-09-15: Exercise time is a setting prefilled from the API, not derived from it (API said 10:05, unit starts at 10:00). Exercise detection is primarily retroactive via the eventType 42 timestamp; the watch window makes live detection likely rather than lucky.
- 2026-09-15: Live pass on the Pi passed both themes. Alex's Reset and Connect pass found two page defects, fixed in build 3: the account card did not leave the Connect flow's view after the code step, and the Reset dialog rendered off-screen. The platform side worked: new credentials were picked up within 41 seconds with no restart.
- Open: fuel type enum values 2 and 3 are presumed. Confirm on a propane unit.
- Open: `tuProperties` shape for tank monitors. Needs a type-2 fixture from a tester.
- 2026-09-25: Icon colour kept as is; see section 13.
- 2026-09-19: Exercising sensor fired on the weekly exercise as designed; the eventType 42 timestamp advanced and the Notify Switch automation delivered. Live-vs-retroactive path not distinguished in the log; both are accepted.
- 2026-09-25: Verification requirements checked (May 5, 2026 revision): all met once engines include Node 24. homebridge-mobilelink is on the verified list but non-functional since Generac's April 21, 2026 auth change and unpublished since December 2023; the submission states that this plugin offers strictly more.
- 2026-09-26: Live test with debug on: the Homebridge log is clean. The CLI `login` still printed the authorization code and wrote debug pages to the working directory; both fixed in 1.0.1 (section 12).
- 2026-09-26: The unit started at 10:00 while the API reported 10:05, so the watch window opens 10 minutes early (it was 2) to cover a start before the reported time. With the prefilled 10:05, the window now opens at 09:55; before, fast polling began at 10:03 and the sensor only opened later through retroactive detection.
- 2026-09-26: Propane tank support is on hold with no planned release, until a tester with a tank monitor volunteers (the `tuProperties` open item above needs one). The settings page line, the Homebridge log line and the README no longer promise it. The 1.0.0 and 0.1.0-beta.1 CHANGELOG entries stay as they are, since they describe what shipped then.
