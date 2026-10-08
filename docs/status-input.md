# Reporting status to Busy Light from another app

Busy Light can take status from other apps on your network: a call app helper, a dictation app, a Stream Deck button, a script, or anything else that knows you are on a call. This document is for the people building those apps. It describes everything a sender needs, and nothing in it depends on any particular app.

There are two ways in:

1. **The status API**: a small HTTP interface on your local network. Use it from an app or script that can make HTTP requests.
2. **The On a Call switch**: a switch in the Home app. Use it from Apple Shortcuts, Siri, a Home tile or a Home automation, with no network code in the sender at all.

Both lead to the same place: Busy Light combines what senders report with your calendars and Microsoft Teams status, and the light and the Home app sensors follow.

Status of this document: the specification for API version 1, written October 8, 2026, ahead of the build that implements it. Section and rule numbers refer to Busy Light's `SPEC.md`.

## 1. What a sender can report

A sender reports one of these statuses. Busy Light combines them with everything else in this order of precedence, highest first, and the highest that applies wins:

| Status | Shown as | Typical use |
| --- | --- | --- |
| `outOfOffice` | Out of office | An app that knows you are away for the day |
| `doNotDisturb` | Do not disturb | Focus or presenting |
| `inCall` | In a call | A call is live: the call app holds the microphone |
| `inMeeting` | In a meeting | A meeting is in progress without audio, for example an in-person one |
| `busy` | Busy | Busy without a meeting |
| `away` | Away | Stepped away |
| `available` | Available | Explicitly free |
| `offline` | Offline | Not working (the light is off by default) |
| `clear` | (nothing) | This sender has no opinion any more |

Two consequences of the order:

1. A sender cannot make you look free when your calendar says you are in a meeting: `available` is below `inMeeting`. To force a status, Busy Light has its own override switch.
2. `clear` is how a sender withdraws. Use it when the call ends, rather than `available`, unless the sender really knows you are free.

Busy Light only ever learns the status, an optional app name and the sender's name. **Never send meeting titles, participants, audio, transcripts or anything else.** The API rejects any field it does not know.

## 2. The status API

### 2.1 Turning it on

The status API is off until the user turns it on in Busy Light's settings, under **Status from other apps**. The page then shows:

1. The address, for example `http://192.168.4.10:8582`. The port is 8582 unless the user changed it.
2. A key: 43 random characters. Treat it like a password.
3. A setup code combining both, to copy into your app in one step:

```
busylight://192.168.4.10:8582/?key=Rk7fJ3...
```

Parse it as a URL: the host and port are the address, `key` is the key, and the scheme tells you it is a Busy Light setup code. Accept it pasted with surrounding spaces.

The user can replace the key at any time, which disconnects every sender until it gets the new one. Show a clear message when you receive `401`.

### 2.2 Security model

1. **Local network only.** Busy Light refuses requests from addresses that are not private (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, fc00::/7, fe80::/10, ::1) with `403`. Do not expose the port to the internet.
2. **Plain HTTP with a key.** There is no TLS, as with most devices on a home network, so the key crosses your network unencrypted. It only lets someone on your network change the light.
3. **Rate limit.** 60 requests a minute from one address; beyond that `429` with `Retry-After`.
4. **No browser access.** The API sends no CORS headers, and the key travels in an `Authorization` header, so a web page cannot call it.

### 2.3 Requests

Every request except `/v1/ping` carries:

```
Authorization: Bearer <key>
```

Bodies are JSON (`Content-Type: application/json`), at most 2 KB.

#### `GET /v1/ping`

No key needed. Use it to check an address before saving it.

```json
{ "service": "busy-light", "apiVersion": 1, "version": "0.1.0-beta.3" }
```

#### `POST /v1/status`

Report this sender's status. The latest report from a sender replaces its earlier one.

```json
{
  "sender": "CallWatch on Alex's iMac",
  "status": "inCall",
  "app": "Microsoft Teams",
  "ttlSeconds": 180
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `sender` | yes | 1 to 64 printable characters. Name your app and the device, so the user can tell senders apart: "CallWatch on Alex's iMac". Keep it stable; it identifies the sender. |
| `status` | yes | One of the statuses in section 1. |
| `app` | no | 1 to 64 printable characters: the name of the app the status comes from, such as "Zoom". Shown to the user. Nothing else about the app. |
| `ttlSeconds` | no | How long the report stays valid without being repeated: 30 to 43200 (12 hours). Default 180. |

Any other field is rejected with `400 unknown_field`.

Response `200`:

```json
{ "accepted": true, "expiresAt": "2026-10-09T14:03:00.000Z", "status": "inCall" }
```

`status` in the response is Busy Light's resulting overall status, which may differ from what you sent if something higher applies.

#### `GET /v1/status`

Busy Light's current overall status, for apps that want to show it.

```json
{
  "status": "inCall",
  "reason": { "source": "CallWatch on Alex's iMac", "until": null },
  "senders": [
    { "sender": "CallWatch on Alex's iMac", "status": "inCall", "app": "Microsoft Teams", "expiresAt": "2026-10-09T14:03:00.000Z" }
  ]
}
```

`status` is one of the statuses in section 1 (never `clear`) or `unknown` when Busy Light has no fresh information.

### 2.4 Keeping a status alive

Reports expire so that a sender that crashes, sleeps or loses its network never leaves the light red. The pattern:

1. Send the new status as soon as it changes.
2. While the status is anything other than `clear`, send it again every 60 seconds with the default `ttlSeconds` of 180. Two missed repeats are tolerated.
3. When the reason ends (the call is over), send `clear`.
4. On quit or sleep, send `clear` if you can. If you cannot, the report expires by itself.

For a status the user sets deliberately and that should last, such as "do not disturb for the next two hours", send it once with a longer `ttlSeconds` instead of repeating it.

### 2.5 Errors

Every error is JSON: `{ "error": "<key>", "message": "<plain sentence>" }`.

| Code | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not JSON |
| 400 | `unknown_field` | A field not listed in 2.3 |
| 400 | `invalid_sender`, `invalid_status`, `invalid_app`, `invalid_ttl` | That field breaks its rule |
| 401 | `unauthorized` | Missing or wrong key |
| 403 | `not_local` | The request came from outside the local network |
| 404 | `not_found` | Unknown path |
| 405 | `method_not_allowed` | Wrong method for the path |
| 409 | `too_many_senders` | 20 senders are already active; wait for one to expire or `clear` |
| 413 | `too_large` | Body over 2 KB |
| 415 | `unsupported_media_type` | Not `application/json` |
| 429 | `rate_limited` | Over 60 requests a minute; see `Retry-After` |

If the port does not answer at all, the status API is turned off, or Homebridge is not running.

### 2.6 Examples

curl:

```sh
curl -sS -X POST http://192.168.4.10:8582/v1/status \
  -H "Authorization: Bearer $BUSY_LIGHT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sender":"Test on my laptop","status":"inCall","app":"Zoom"}'
```

Swift (macOS):

```swift
var request = URLRequest(url: URL(string: "http://192.168.4.10:8582/v1/status")!)
request.httpMethod = "POST"
request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONEncoder().encode(["sender": "MyApp on iMac", "status": "inCall", "app": "Microsoft Teams"])
let (_, response) = try await URLSession.shared.data(for: request)
```

A Mac app that talks to a device on the local network triggers macOS's Local Network permission prompt the first time; plan for it in your onboarding.

Apple Shortcuts: a **Get Contents of URL** action with method POST, a header `Authorization` set to `Bearer ` followed by the key, and a JSON request body with `sender` and `status`.

## 3. The On a Call switch

For senders that should not make network requests themselves, Busy Light can add a switch to the Home app: **{name} On a Call** (for example "Busy Light On a Call"). The user turns it on in Busy Light's settings, under **Status from other apps**.

1. While the switch is on, the sender "Home app" reports `inCall`. Turning it off withdraws it (`clear`).
2. It turns itself off after a safety period, 3 hours by default (1 to 12, set by the user), in case nothing turns it off.
3. Anything that can control a HomeKit switch can use it: a shortcut's **Home** action ("Set Busy Light On a Call to On"), Siri ("Turn on Busy Light On a Call"), a Home tile, a Home automation, or a Stream Deck with a HomeKit plugin.

An app that wants to stay off the network can therefore run two of the user's shortcuts, one when a call starts and one when it ends, and let the shortcuts set the switch. HomeKit carries the change to Busy Light with its own security.

The switch reports only `inCall`. For other statuses, use the status API.

## 4. Checklist for app builders

1. Let the user paste the setup code; check it with `GET /v1/ping`.
2. Pick a stable `sender` name that includes the device.
3. Send on change, repeat every 60 seconds while not `clear`, send `clear` when done.
4. Send only `sender`, `status`, `app` and `ttlSeconds`. Never content.
5. Handle `401` (key replaced), `403` (wrong network), `429` (back off) and no answer (Busy Light off) with a plain message to the user.
6. Expect the overall status to differ from what you sent; Busy Light decides.
