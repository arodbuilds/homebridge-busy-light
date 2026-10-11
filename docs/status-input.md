# Reporting status to Busy Light from another app

Busy Light can take status from other apps on your network: a call app helper, a dictation app, a Stream Deck button, a script, or anything else that knows you are on a call. This document is for the people building those apps. It describes everything a sender needs, and nothing in it depends on any particular app.

There are two ways in:

1. **The status API**: a small HTTP interface on your local network. Use it from an app or script that can make HTTP requests.
2. **The On a Call switch**: a switch in the Home app. Use it from Apple Shortcuts, Siri, a Home tile or a Home automation, with no network code in the sender at all.

Both lead to the same place: Busy Light combines what senders report with your calendars and Microsoft Teams status, and the light and the Home app sensors follow.

Status of this document: describes Busy Light 1.0.0. The status API (API version 1) and the On a Call switch came in 0.1.0-beta.3; 0.1.0-beta.4 finds Busy Light by name more reliably (section 2.1) and changes nothing a sender sends or receives; 0.1.0-beta.5 reserves the sender name `Home app` for the On a Call switch and adds `notWorking`, an overall status a sender may see but never sends (section 2.3); 1.0.0 refuses invisible format characters in `sender` and `app` (section 2.3). Written October 8, 2026 and revised the same day (signed requests, names in Unicode, `clear`, finding Busy Light by name, sending from a laptop that leaves home, replay memory, the plain key setting and sender restarts), then updated for what the build settled: the error messages, `null` fields, the body as an object, and the order of the checks. Updated October 9, 2026 for 0.1.0-beta.5, and October 10, 2026 for 1.0.0. Section and rule numbers refer to Busy Light's `SPEC.md`, section 18.

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

1. The address. When Busy Light can confirm its name on the network, the address uses it, for example `http://homebridge.local:8582`, so it keeps working when the router hands out a new IP address. Busy Light confirms the name the way your app would find it: one multicast DNS query for the name, answered with one of its own addresses (from 0.1.0-beta.4; before, a Raspberry Pi whose name resolves to 127.0.0.1 on the Pi itself was never confirmed). The IP address, for example `http://192.0.2.10:8582`, is listed as well. The port is 8582 unless the user changed it.
2. A key: 43 random characters. Treat it like a password.
3. A setup code combining the address, the key and Busy Light's id, to copy into your app in one step:

```
busylight://homebridge.local:8582/?key=Rk7fJ3...&id=q3Lr8vT0cXw2mN5a
```

The user can also print it on the Homebridge computer with `homebridge-busy-light input --setup-code`.

The setup code's host is the name when Busy Light can confirm it, and otherwise the first IPv4 address. Parse it as a URL: the host (a name, an IPv4 address, or an IPv6 address in brackets) and port are the address, `key` is the key, `id` is this Busy Light's id (section 2.7), and the scheme tells you it is a Busy Light setup code. Accept it pasted with surrounding spaces. Keep the host as given; do not resolve a name once and store the IP address, or a router change breaks your app again.

The user can replace the key at any time, which disconnects every sender until it gets the new one. Show a clear message when you receive `401 unauthorized`.

### 2.2 Security model

1. **Local network only.** Busy Light refuses requests from addresses that are not private (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, fc00::/7, fe80::/10, ::1) with `403`. Do not expose the port to the internet.
2. **Signed requests.** Apps sign each request with the key (section 2.4), so the key itself never crosses the network. Busy Light refuses a signature from a clock more than 5 minutes off, and refuses a report whose `ts` is not newer than the last one it accepted from that sender. It remembers that `ts` for 5 minutes whatever happens to the report (cleared, expired) and across a Homebridge restart, so a captured report can never be sent again, not even right after the call ends. The one exception is `GET /v1/status`: it has no sender, so a captured one can be sent again within 5 minutes, and it only reads the status, which is visible on the network anyway.
3. **Plain key, for the user's own tools.** Busy Light also accepts the key itself in the request (`Authorization: Bearer <key>`), because Apple Shortcuts and a quick curl test cannot sign. This form sends the key unencrypted, and one such request seen on the network gives away the key, which can then sign anything. So the user can turn it off: **Allow the plain key** in Busy Light's settings, on until the user turns it off. With it off, a plain-key request gets `401 plain_key_off`. The settings page shows, for each sender, whether its last report was signed, so the user knows when it is safe to turn the plain key off. **Apps must sign.**
4. **Plain HTTP.** There is no TLS, as with most devices on a home network. With signed requests, someone watching the network can see the statuses and sender names, but cannot learn the key, change the light, or replay what they saw.
5. **Rate limit.** 60 requests a minute from one address; beyond that `429` with `Retry-After`.
6. **No browser access.** The API sends no CORS headers, and authentication travels in an `Authorization` header, so a web page cannot call it.

### 2.3 Requests

Every request except `/v1/ping` carries an `Authorization` header (section 2.4). Bodies are JSON (`Content-Type: application/json`), at most 2048 bytes of UTF-8.

#### `GET /v1/ping`

No key needed. Use it to check an address and confirm it is the right Busy Light before you send anything (section 2.7).

```json
{ "service": "busy-light", "apiVersion": 1, "version": "1.0.0", "id": "q3Lr8vT0cXw2mN5a" }
```

#### `POST /v1/status`

Report this sender's status. The latest report from a sender replaces its earlier one.

```json
{
  "sender": "CallWatch on Alex’s iMac",
  "status": "inCall",
  "app": "Microsoft Teams",
  "ttlSeconds": 180
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `sender` | yes | Text (see below). Name your app and the device, so the user can tell senders apart: "CallWatch on Alex’s iMac". Keep it stable; it identifies the sender. |
| `status` | yes | One of the statuses in section 1. |
| `app` | no | Text (see below): the name of the app the status comes from, such as "Zoom". Shown to the user. Nothing else about the app. |
| `ttlSeconds` | no | How long the report stays valid without being repeated: 30 to 43200 (12 hours). Default 180. |

Text rule for `sender` and `app`:

1. Any Unicode text, from 1 to 64 characters, where a character is a Unicode code point: not a byte, and not a UTF-16 unit. Curly apostrophes, accented letters and emoji are fine. The macOS default computer name ("Alex’s iMac", with a curly apostrophe) is fine as it is.
2. Busy Light normalizes the text to Unicode NFC before checking, storing and comparing it, so the same name typed two ways is one sender.
3. Not allowed: leading or trailing spaces, control characters (newlines and tabs included), U+2028, U+2029, the bidirectional formatting characters U+202A to U+202E and U+2066 to U+2069, and from Busy Light 1.0.0 any other Unicode format character (category Cf), such as a zero-width space (U+200B), a word joiner (U+2060) or a soft hyphen (U+00AD): they are invisible, and could make one name look like another. Two are allowed: the zero-width non-joiner (U+200C) and the zero-width joiner (U+200D), so words in scripts that need them (Persian, Sinhala, Malayalam) can be written and joined emoji, such as a person at a laptop, stay whole. Subdivision flags (England, Scotland), which are built from tag characters, are refused. Busy Light never trims or rewrites a name; it refuses it with `invalid_sender` or `invalid_app`.
4. The sender name `Home app` is reserved for the On a Call switch (section 3): from Busy Light 0.1.0-beta.5, a `sender` that is `Home app` in any Unicode form that normalizes to it (with a no-break space or fullwidth letters, for example) is refused with `400 invalid_sender`, and from 1.0.0 also with any invisible character inside it (a format character, a zero-width joiner, a variation selector or a combining grapheme joiner, say), or with a blank character (a Hangul filler or the Braille blank) or two spaces in place of the space.
5. Look-alike letters from other scripts are accepted: `Ноme app`, written with a Cyrillic `Н` and `о`, is a different name, and Busy Light cannot refuse such names in general, since a name may be in any script. This is a known limitation, accepted because a sender needs the key to report at all, and because the user's list of apps shows each app's own row with its Signed or Plain key badge, which the switch's own `Home app` row never has.

The body must be a JSON object; anything else (an array, a string, `null`) is `400 invalid_json`. `"app": null` and `"ttlSeconds": null` are read as if the field were absent. Any field other than the four above is rejected with `400 unknown_field`.

Response `200`:

```json
{ "accepted": true, "expiresAt": "2026-10-09T12:06:00.000Z", "status": "inCall" }
```

`status` in the response is Busy Light's resulting overall status, which may differ from what you sent if something higher applies. It can also be `tentative`, which a sender cannot report but a tentative event in the user's calendar gives (it ranks between `busy` and `away`), so do not decode it against the list in section 1 alone. From Busy Light 0.1.0-beta.5 it can also be `notWorking`: the user has turned off Busy Light's Working switch at the end of the day, the light is off, and that is above everything, so your report is accepted and kept but changes nothing until the switch is turned on. `notWorking` is a value a sender may see, never one it sends: sending it is `400 invalid_status`.

`clear` removes this sender's report:

1. The response is `200 { "accepted": true, "expiresAt": null, "status": "..." }`, with the overall status after clearing.
2. It succeeds whether or not the sender had an active report, so sending it twice, or after the report expired, is fine.
3. `app` and `ttlSeconds` may be sent with it and are ignored (they must still follow their rules), so you can send the same shape every time.
4. `clear` is never refused for too many senders.

#### `GET /v1/status`

Busy Light's current overall status, for apps that want to show it.

```json
{
  "status": "inCall",
  "reason": { "source": "CallWatch on Alex’s iMac", "until": null },
  "senders": [
    { "sender": "CallWatch on Alex’s iMac", "status": "inCall", "app": "Microsoft Teams", "expiresAt": "2026-10-09T12:06:00.000Z" }
  ]
}
```

1. `status` is one of the statuses in section 1 (never `clear`), `tentative` (from a calendar), `unknown` when Busy Light has no fresh information, or, from Busy Light 0.1.0-beta.5, `notWorking` while the user's Working switch is off (see the `POST /v1/status` response above).
2. `reason` is null while the status is `unknown` or `notWorking`. Otherwise `reason.source` is the name of the active sender that decided the status, or null when something else decided it (a calendar, Teams, or the user's override switch). A sender learns nothing about calendars or events, so `reason.until` is always null.
3. `senders` lists the active senders. `app` is null when the sender named none. The On a Call switch appears as the sender `Home app`, with `app` and `expiresAt` null (it turns itself off on its own schedule, section 3).

### 2.4 Signing a request

```
Authorization: BusyLight-HMAC-SHA256 ts=<ts>, sig=<sig>
```

1. `ts`: your clock, in whole milliseconds since January 1, 1970 UTC, as digits.
2. Build the string to sign from five lines joined by a single line feed (`\n`), with no line feed at the end:
   1. `v1`
   2. the method in capitals: `POST` or `GET`
   3. the path without any query string: `/v1/status`
   4. `ts`, exactly as in the header
   5. the lowercase hex SHA-256 of the exact body bytes you send (for a `GET`, of nothing: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)
3. `sig`: the lowercase hex HMAC-SHA256 of that string, keyed with the key's characters as UTF-8 bytes (the key as given, not decoded from base64).
4. Sign the bytes you send. If your JSON encoder runs again after signing, the hash no longer matches.
5. Each report from a sender must carry a `ts` greater than that sender's previous one, or it is refused with `401 replayed`. Take the current time in milliseconds, and if it is not greater than the last `ts` you sent, use the last one plus 1.
   1. **Store your last `ts`** where it survives your app restarting (for example in user defaults), and read it back at launch. Otherwise a clock that stepped backward (a time sync, a manual change) leaves your next reports below the one Busy Light remembers, and they are refused with `replayed` for no reason you can see.
   2. A `replayed` answer carries `"lastTs"`, the `ts` Busy Light remembers for you (a string of digits). Store `lastTs` plus 1 as your last `ts` and send the report again once. Do not loop: if that is refused too, show the error.
6. Keep the computer's clock set automatically. A `ts` more than 300 seconds from Busy Light's clock is refused with `401 clock_skew`, and the message says by how much, in whole seconds rounded up. Busy Light checks the signature first, so a request with a wrong signature gets `unauthorized` whatever its `ts`.
7. The scheme name `BusyLight-HMAC-SHA256` is matched without regard to case. `ts` and `sig` may come in either order, separated by a comma and optional spaces, each exactly once; anything else is `401 unauthorized`.

Test vector. With the key `Synthetic-test-key-0000-do-not-use-anywhere`, `ts` `1791547380000` and this exact body (81 bytes, with a curly apostrophe):

```
{"sender":"CallWatch on Alex’s iMac","status":"inCall","app":"Microsoft Teams"}
```

1. Body hash: `d87cbcae7bc01e3f04b5b78ad997ab04615f82b49f198efbdb4ebb68399c78c2`
2. String to sign: `v1\nPOST\n/v1/status\n1791547380000\nd87cbcae7bc01e3f04b5b78ad997ab04615f82b49f198efbdb4ebb68399c78c2`
3. `sig`: `27e0b09262e123c86c9d6ac1b749c7e11e89ac581d18f693c35eb17f6f468291`

If your code produces that `sig`, it signs correctly.

### 2.5 Keeping a status alive

Reports expire so that a sender that crashes, sleeps or loses its network never leaves the light red. The pattern:

1. Send the new status as soon as it changes.
2. While the status is anything other than `clear`, send it again every 60 seconds with the default `ttlSeconds` of 180. Two missed repeats are tolerated.
3. When the reason ends (the call is over), send `clear`.
4. On quit or sleep, send `clear` if you can. If you cannot, the report expires by itself.

For a status the user sets deliberately and that should last, such as "do not disturb for the next two hours", send it once with a longer `ttlSeconds` instead of repeating it.

### 2.6 Errors

Every error is JSON: `{ "error": "<key>", "message": "<plain sentence>" }`. `replayed` adds one field, `lastTs`. The message is a fixed sentence for each `error` (only `clock_skew` adds the number of seconds), the same for every cause of `unauthorized`, so act on `error` and show `message` to the user if you like. Every answer Busy Light writes, error or not, has `Cache-Control: no-store`.

Busy Light checks a request in this order and answers with the first problem it finds: local address (`403`), rate limit (`429`), path and method (`404`, `405`), size (`413`), media type for a `POST` (`415`), authentication (`401`, not for `/v1/ping`), JSON (`400`), fields (`400`), the replay rule (`401 replayed`), sender count (`409`). So a request that fails authentication gets `401` whatever its body, which is not read as JSON first, and only a correctly signed request can get `replayed` and learn `lastTs`.

| Code | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not a JSON object |
| 400 | `unknown_field` | A field not listed in 2.3 |
| 400 | `invalid_sender`, `invalid_status`, `invalid_app`, `invalid_ttl` | That field breaks its rule |
| 401 | `unauthorized` | Missing or wrong key, a wrong signature, or a malformed `Authorization` header |
| 401 | `clock_skew` | The signed `ts` is more than 300 seconds from Busy Light's clock |
| 401 | `replayed` | The signed `ts` is not greater than this sender's previous one. The answer also has `"lastTs"` (section 2.4, item 5) |
| 401 | `plain_key_off` | The plain key was sent, and the user has turned off Allow the plain key |
| 403 | `not_local` | The request came from outside the local network |
| 404 | `not_found` | Unknown path |
| 405 | `method_not_allowed` | Wrong method for the path |
| 409 | `too_many_senders` | 20 senders are already active; wait for one to expire or `clear` |
| 413 | `too_large` | Body over 2048 bytes |
| 415 | `unsupported_media_type` | Not `application/json` |
| 429 | `rate_limited` | Over 60 requests a minute; see `Retry-After` |

If the port does not answer at all, the status API is turned off, Homebridge is not running, or you are not on the home network.

### 2.7 Laptops and other senders that leave home

A laptop that goes to an office, a hotel or a coffee shop keeps its setup code, and the same private address (written `192.0.2.10` in these examples) may belong to a stranger's device on that network. A sender must not report to whatever answers there.

1. **Sign every request** (section 2.4). Then nothing sent to the wrong device gives away the key or can be used against the user's Busy Light. This is the main protection; the steps below keep a sender quiet and correct.
2. **Confirm it is the user's Busy Light before reporting.** When the network changes, when the Mac wakes, and before the first report after a failure, call `GET /v1/ping` at the setup code's host and send reports only if `service` is `busy-light` and `id` equals the setup code's `id`. Otherwise treat Busy Light as not reachable. (`/v1/ping` needs no key, so the check costs nothing and sends nothing secret.)
3. **When Busy Light is not reachable, stay quiet.** Do not retry more than once a minute, and do not queue reports to send later: a status is about now, and an old one replayed on return would be wrong.
4. **Never fall back to the plain key** after a signed request fails.
5. **On returning home**, after the check in step 2 succeeds, send the current status fresh. Whatever the sender reported before it left has expired by then.
6. **Tell the user** in plain words when the app cannot reach Busy Light ("Busy Light is not reachable on this network"), without alarming them: away from home this is expected.

### 2.8 Examples

curl, with the plain key, for a quick test from a computer at home:

```sh
curl -sS -X POST http://homebridge.local:8582/v1/status \
  -H "Authorization: Bearer $BUSY_LIGHT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sender":"Test on my laptop","status":"inCall","app":"Zoom"}'
```

curl, signed (macOS `shasum` and `openssl`):

```sh
BODY='{"sender":"Test on my laptop","status":"inCall","app":"Zoom"}'
TS=$(( $(date +%s) * 1000 ))
HASH=$(printf %s "$BODY" | shasum -a 256 | cut -d' ' -f1)
SIG=$(printf 'v1\nPOST\n/v1/status\n%s\n%s' "$TS" "$HASH" | openssl dgst -sha256 -hmac "$BUSY_LIGHT_KEY" | sed 's/^.* //')
curl -sS -X POST http://homebridge.local:8582/v1/status \
  -H "Authorization: BusyLight-HMAC-SHA256 ts=$TS, sig=$SIG" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

Swift (macOS), signed, with CryptoKit:

```swift
import CryptoKit
import Foundation

func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
    bytes.map { String(format: "%02x", $0) }.joined()
}

let body = try JSONEncoder().encode(["sender": "MyApp on Alex’s iMac", "status": "inCall", "app": "Microsoft Teams"])
let ts = String(Int64(Date().timeIntervalSince1970 * 1000)) // keep it above the last ts you sent
let message = ["v1", "POST", "/v1/status", ts, hex(SHA256.hash(data: body))].joined(separator: "\n")
let sig = hex(HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: SymmetricKey(data: Data(key.utf8))))

var request = URLRequest(url: URL(string: "http://homebridge.local:8582/v1/status")!)
request.httpMethod = "POST"
request.setValue("BusyLight-HMAC-SHA256 ts=\(ts), sig=\(sig)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = body
let (_, response) = try await URLSession.shared.data(for: request)
```

Notes for a Mac app:

1. **Local Network permission.** The first request to a device on the local network triggers macOS's Local Network prompt; plan for it in your onboarding.
2. **App Transport Security.** `URLSession` refuses plain HTTP to most hosts. `NSAllowsLocalNetworking` in the app's `NSAppTransportSecurity` dictionary allows `.local` names and unqualified names, which covers the usual setup code. For an IP address host, Apple's guidance has changed over the years: older releases exempted IP addresses from ATS entirely, and Apple's networking engineer has since said IP addresses need `NSExceptionDomains` entries, which accept CIDR ranges (`192.168.0.0/16` with `NSExceptionAllowsInsecureHTTPLoads`), with a fix for a CIDR bug in later iOS 17 releases. Not yet verified on macOS 27: test both a `.local` host and an IP address host on the macOS versions you support before relying on either. Network framework connections are not subject to ATS.

Apple Shortcuts: a **Get Contents of URL** action with method POST, a header `Authorization` set to `Bearer ` followed by the key, and a JSON request body with `sender` and `status`. Shortcuts cannot sign, so it sends the key itself, and works only while Allow the plain key is on: use it only from a device that stays at home, and prefer the On a Call switch (section 3), which needs no key at all.

## 3. The On a Call switch

For senders that should not make network requests themselves, Busy Light can add a switch to the Home app: **{name} On a Call** (for example "Busy Light On a Call"). The user turns it on in Busy Light's settings, under **Status from other apps**.

1. While the switch is on, the sender "Home app" reports `inCall`. Turning it off withdraws it (`clear`).
2. It turns itself off after a safety period, 3 hours by default (1 to 12, set by the user), in case nothing turns it off. Turning it on while it is already on starts the safety period again, so a shortcut that turns it on at the start of every call keeps it on through a long day of calls.
3. Anything that can control a HomeKit switch can use it: a shortcut's **Home** action ("Set Busy Light On a Call to On"), Siri ("Turn on Busy Light On a Call"), a Home tile, a Home automation, or a Stream Deck with a HomeKit plugin.

An app that wants to stay off the network can therefore run two of the user's shortcuts, one when a call starts and one when it ends, and let the shortcuts set the switch. HomeKit carries the change to Busy Light with its own security, at home and away.

The switch reports only `inCall`. For other statuses, use the status API.

## 4. Checklist for app builders

1. Let the user paste the setup code. Keep its host as a name when it is one, and check it with `GET /v1/ping`, comparing `id`.
2. Pick a stable `sender` name that includes the device. The computer's own name, curly apostrophe and all, is fine.
3. Sign every request (section 2.4), and check your code against the test vector. Never send the plain key from an app: the user may have turned it off, and sending it gives the key away.
4. Store your last `ts` across restarts, and on `replayed` continue from `lastTs` plus 1, once.
5. Send on change, repeat every 60 seconds while not `clear`, send `clear` when done.
6. Send only `sender`, `status`, `app` and `ttlSeconds`. Never content.
7. Follow section 2.7 when the network changes: confirm the `id` before reporting, stay quiet when Busy Light is not reachable, never queue old reports, and send the current status fresh on return.
8. Handle `401` (`unauthorized`: key replaced; `clock_skew`: the clock is off; `replayed`: your `ts` went backwards, see item 4; `plain_key_off`: an app sent the plain key), `403` (wrong network), `429` (back off) and no answer (Busy Light off or not on this network) with a plain message to the user.
9. Expect the overall status to differ from what you sent, including `notWorking` and `tentative`, which you never send; Busy Light decides.
