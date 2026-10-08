<p align="center">
  <img src="https://raw.githubusercontent.com/arodbuilds/homebridge-busy-light/latest/assets/busy-light-banner.png" alt="Busy Light for Homebridge" width="100%">
</p>

# Busy Light for Homebridge

Your calendar and Teams status on a light. Green when you are free, red when you are not.

Status: beta. Version 0.1.0-beta.4 leads with the Outlook published calendar link for work calendars, finds Busy Light by name on your network, shows intervals in minutes, and shows only the statuses your setup can produce. It has been tested against recorded responses and in the Homebridge UI, not yet against every calendar service and bulb, nor on every network. Please report what you find.

Busy Light reads your calendars and, if you use Microsoft 365, your Teams presence, and reduces them to one status. Other apps on your network can report a status too, for example a call helper that knows you are on a call. Busy Light shows the status two ways:

1. On a LIFX bulb, directly over your home network, in a color you choose for each status. No LIFX account or cloud is used.
2. As HomeKit occupancy sensors, so a Home automation can set any other HomeKit light or scene.

A typical use is a lamp outside a home office door: green when you are free, red in a meeting or on a call, purple when you are out of office, and off when Teams shows you offline.

It works with:

- Outlook and Microsoft 365: your calendar's published link, with no IT approval, or sign-in for live Teams status (see [Outlook and Microsoft 365](#outlook-and-microsoft-365))
- iCloud calendars
- Google Calendar
- Any calendar subscription link that starts with `https://` or `webcal://`

Add as many calendars as you like. Events from all of them are combined.

Other apps can report your status through a small API on your home network, or through an On a Call switch in the Home app. See [Status from other apps](#status-from-other-apps).

## Statuses

When more than one applies, the one highest in this list wins.

| Status | Default color | When |
| --- | --- | --- |
| Out of office | Purple `#B400FF` | Teams says you are out of office, or an out of office event is on now (including all-day ones) |
| Do not disturb | Red `#FF0000` | Teams is set to Do not disturb, or you are presenting or focusing, or the override switch is on |
| In a call | Red `#FF0000` | Teams shows you in a call |
| In a meeting | Red `#FF0000` | An event marked busy is on now, or Teams shows you in a meeting |
| Busy | Orange `#FF6A00` | Teams is set to Busy |
| Tentative | Yellow `#FFD000` | A tentative event is on now |
| Away | Yellow `#FFD000` | Teams shows you away or be right back |
| Available | Green `#00FF00` | Nothing else applies and Teams shows you available (or you do not use Teams) |
| Offline | Off | Teams shows you offline |

An app that reports your status (see [Status from other apps](#status-from-other-apps)) counts the way Teams presence does: an app reporting a call gives In a call, and so on. It cannot hide a higher status: an app reporting Available does not hide a meeting in your calendar.

All-day events marked busy or tentative are ignored by default, so a reminder that fills the whole day does not keep the light red. All-day out of office events always count.

Calendars have no out of office setting of their own, so for iCloud, Google and calendar links an event counts as out of office when its title contains one of the out of office words (by default: Out of office, OOO, Vacation, PTO). Invitations you declined are ignored when Busy Light knows your address (your Apple ID, or the email you give for Google).

If none of your calendars can be read for 15 minutes, and no app is reporting a status, the status becomes unknown: every sensor turns off and the bulb is left as it is, so a meeting never sticks because a calendar became unreachable.

## Install

Install Busy Light from the Plugins tab of the Homebridge UI, or run:

```shell
npm install -g homebridge-busy-light@beta
```

Then open the plugin settings, add at least one calendar, choose how the light is controlled, click Save and restart Homebridge. For a work calendar in Outlook, choose Outlook or Microsoft 365, then Published calendar link: it needs nothing from your IT department.

Until the first release is on npm, build it from source inside your Homebridge storage directory, as the user Homebridge runs as (on the Homebridge Raspberry Pi image, run `sudo hb-shell` first):

```shell
cd /var/lib/homebridge
git clone https://github.com/arodbuilds/homebridge-busy-light.git
cd homebridge-busy-light
npm ci
npm run build
cd ..
npm install ./homebridge-busy-light
```

Then restart Homebridge. To update a copy built this way, run `git pull && npm ci && npm run build` in the `homebridge-busy-light` folder and restart Homebridge.

## The settings page

Open Busy Light's settings in the Homebridge UI (Plugins, then the plugin's menu, then Plugin Config). Changes on the page take effect after you click Save and restart Homebridge. If you close the page without saving, it offers your changes back the next time you open it (without any password or calendar address, which it never keeps).

The page has six parts.

### Right now

What the running plugin shows at this moment: the color and the status, and why, for example "Until 2:30 PM, from Work." It refreshes every 15 seconds while the page is open. If it says Homebridge may not be running, the plugin has not written its state for more than 5 minutes.

### Calendars

One card per calendar. Click Add calendar and choose iCloud, Google Calendar, Outlook or Microsoft 365, or Calendar URL. Click a card's header to open or close it. The header shows the calendar's state as the running plugin sees it (Connected, Checking, Sign-in needed or Not reachable, with the reason under it), or Not saved yet for a calendar you have not saved.

**Counts for.** Each calendar counts for "Busy and out of office" (the default) or "Out of office only". Out of office only uses the calendar's out of office events and ignores the rest, which is useful for a family calendar: a family member's holiday can make you out of office, but their appointments do not make you busy. For iCloud and Microsoft 365 you choose it for each calendar you tick; for Google Calendar and Calendar URL, for the card.

**Check for changes every.** Under Advanced on each card, how often Busy Light looks for new or changed events on that calendar: 1, 2, 3, 5 or 10 minutes, or Same as Settings (the default), which follows Reload calendars every under Settings. A calendar that changes rarely, such as a team rota, can be read every 10 minutes while your main calendar is read every 3. Microsoft 365 Teams status is still checked at Check status every. A value typed in an earlier version that is not in the list (90 seconds, say) shows as its own choice, "1 minute 30 seconds", and is kept.

#### iCloud

1. Sign in at [account.apple.com](https://account.apple.com), open Sign-In and Security, then App-Specific Passwords, and create one named Busy Light. Apple's step-by-step instructions: [Sign in to apps with your Apple Account using app-specific passwords](https://support.apple.com/en-us/102654). This is not your Apple ID password, and Busy Light never sees your Apple ID password or two-factor codes.
2. Enter your Apple ID email and that app-specific password on the card, and click Connect.
3. Under "Calendars to use", tick the calendars that should count. Each row shows how many events it has today. "Shared with you" marks a calendar someone else shared with you; "New" marks one you have not chosen before. A subscribed calendar (such as a holidays calendar you subscribed to in the Calendar app) cannot be read through iCloud; add its address as a Calendar URL instead.

Calendars you add to iCloud later stay off until you tick them; the log mentions them, for example `iCloud: calendars not in use: Kids. Tick them in the plugin settings to use them.` A configuration from the first beta, which listed calendars by name, keeps working: the page shows those names ticked, and after Connect it saves them by their iCloud identifiers, so renaming a calendar in iCloud no longer matters.

If iCloud does not accept the password, the plugin tries again only once an hour so a wrong password cannot lock your Apple ID.

#### Google Calendar

1. Open Google Calendar on a computer, open Settings, pick the calendar on the left, then Integrate calendar.
2. Copy the "Secret address in iCal format". Treat it like a password: anyone with it can read the calendar. Busy Light never writes it to the log, only its host name.
3. Paste it into the card. Optionally enter your Google email, so invitations you declined are ignored.
4. Click Test. The card says how many events the calendar has today, or what went wrong.

Google refreshes the secret address on its own schedule, so a change you make in Google Calendar can take a while to reach the light.

#### Outlook and Microsoft 365

Choose **Outlook or Microsoft 365** under Add calendar. The page offers two ways in.

**Published calendar link (recommended).** Works with any Outlook or Microsoft 365 calendar, with no IT approval, and shows busy, tentative and out of office. The card it adds, named Outlook, carries these steps:

1. Open Outlook on the web and go to Settings, Calendar, Shared calendars.
2. Under Publish a calendar, choose your calendar and Can view when I'm busy, then select Publish.
3. Copy the ICS link and paste it into the card's Address, then click Test.

"Can view when I'm busy" is all Busy Light needs: the link then carries only when you are busy, tentative or out of office, and never the titles, places or people of your meetings, which is more private than sharing titles. Treat the link like a password all the same: anyone with it can see when you are busy. Busy Light never writes it to the log, only its host name. A new or moved meeting shows up within a few minutes (about 2 in testing), and the light changes when it starts. If Publish a calendar is missing, your organization has turned publishing off: ask IT, or use sign-in below. A Calendar URL card whose address is an Outlook link shows the same steps under How to get this link.

**Sign in with Microsoft 365 (advanced).** Adds your live Teams status, such as In a call, to your Outlook calendars. It needs an app registration in your organization's tenant, which only your administrator can create, and many IT departments will not approve one. You need two IDs from them: the Directory (tenant) ID and the Application (client) ID.

**What to ask for:** send your administrator the text in [docs/microsoft-365-admin-request.md](docs/microsoft-365-admin-request.md) (the card links to it as "What do I ask for?"). It is written to be copied and pasted as is: what Busy Light does, the exact registration steps, the two IDs to send back, and notes for a security review.

Once you have the two IDs:

1. Enter both on the card, and choose Use Teams status, Use Outlook calendars, or both. Only one Microsoft 365 calendar can use Teams status.
2. Click Connect. The card shows a code. Click Open Microsoft sign-in (or open that address on any device), enter the code and sign in with your work account. The card notices by itself when you have finished.
3. With Use Outlook calendars on, tick the Outlook calendars that should count ("Default" marks your main calendar). With none ticked, Busy Light reads your default calendar, as the first beta did.

Busy Light stays signed in from then on. Disconnect on the card signs it out. If Microsoft refuses the sign-in, the card says why in plain words, with the instructions to send your administrator; the log says the same, for example:

```
Work: Microsoft did not allow the sign-in: the app registration does not allow public client flows. This needs your Microsoft 365 administrator. Instructions to send them: https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/microsoft-365-admin-request.md
```

If you save a Microsoft 365 calendar without connecting it, the plugin starts the sign-in itself when Homebridge restarts and writes the code to the log, as in the first beta.

#### Calendar URL

Any calendar subscription link that starts with `https://` or `webcal://` works, for example a team rota or a shared holiday calendar. Paste it into the card and click Test. Like a Google secret address, the link is never written to the log.

### Status from other apps

Lets other apps on your network tell Busy Light you are on a call or busy: a call helper on your Mac, a dictation app, a Stream Deck button, a script. Busy Light combines what they report with your calendars and Teams status, and the light and the sensors follow. It is off until you turn it on.

**Turning it on.** Tick "Let other apps set your status". The page makes a key and shows:

- **Address**: where apps send their status, for example `http://homebridge.local:8582`, with the computer's IP addresses below it. Busy Light uses the name when the network confirms it: it asks once with multicast DNS, the way a Mac or iPhone finds the Pi. When the name cannot be confirmed, the address is the IP address and the page asks you to reserve it for Homebridge in your router. Reserving it is a good idea either way, for apps that only take an IP address. If the IP address changes, the log and the page say so, and apps need the new setup code.
- **Key**: 43 random characters. Treat it like a password. Replace key makes a new one; every app using the old key stops working until you give it the new one.
- **Setup code**: the address, the key and this Busy Light's id in one line, for example `busylight://homebridge.local:8582/?key=...&id=...`. It is masked like the key: Show on the Key field reveals both, Hide masks both. Copy setup code copies the whole code either way. Paste it into the app that will report your status.

Click Save and restart Homebridge. The log then says `Status input is listening on port 8582.` Test on the page sends a call for 30 seconds, so the light should turn red. **Allow the plain key** (on by default) lets tools that cannot sign their requests, such as Apple Shortcuts and curl, send the key itself; anyone watching your network could copy it then, so turn it off once every app under Apps reporting now shows Signed. Under Advanced you can change the port (8582) if another program already uses it.

**Apps reporting now** lists every app heard from in the last 12 hours: what it reported, when, whether it is still Active or has Expired, and whether it signs its requests (Signed) or sends the key itself (Plain key). An app's report lasts 3 minutes unless it repeats it, so an app that quits or loses its network never leaves the light red.

**The On a Call switch.** Tick "Add an On a Call switch to the Home app" and Busy Light adds a switch named "Busy Light On a Call". While it is on, your status is In a call. Turn it on from a shortcut ("Set Busy Light On a Call to On"), Siri, a Home tile or a Home automation, and off when the call ends. It turns itself off after 3 hours (1 to 12, under "Turn it off by itself after") in case nothing turns it off. It needs no key and works wherever the Home app does. It shows under Apps reporting now as "Home app".

**A test from a computer at home.** With the key in `BUSY_LIGHT_KEY` and Allow the plain key on:

```shell
curl -sS -X POST http://homebridge.local:8582/v1/status \
  -H "Authorization: Bearer $BUSY_LIGHT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sender":"Test on my laptop","status":"inCall"}'
```

The light turns red for 3 minutes, and "Test on my laptop" appears under Apps reporting now. Send `"status":"clear"` to withdraw it sooner.

**For app builders:** [docs/status-input.md](docs/status-input.md) describes the API in full: signing requests so the key never crosses the network, the statuses, how long reports last, the errors, and laptops that leave home. The API answers only on the local network; do not open the port to the internet.

### Colors

The color the light shows for each status, in the order of the status table: when more than one applies, the one highest in the list wins. Each status has a row of presets: Red, Orange, Yellow, Green, Blue, Purple, White, Off (the light turns off for that status) and Custom. Custom shows a color picker and a field for any value such as `#1A2B3C`; a color saved by hand that is not a preset shows as Custom. Arrow keys move along a row. Reset colors puts the defaults back.

The list shows the statuses your setup can produce. With calendars alone (an Outlook link, iCloud, Google or any calendar link) that is four: Out of office, In a meeting, Tentative and Available. In a call needs the On a Call switch, Status from other apps or Teams status; Do not disturb, Busy, Away and Offline need Status from other apps or Teams status. The others wait behind "5 more statuses come from Teams or from other apps." and Show all statuses, and the list changes as you turn those on or off. Hidden statuses keep their colors, and Reset colors resets all nine.

### Lights

**LIFX bulb.** Tick "Use a LIFX bulb" and the page looks for LIFX bulbs on your network straight away. With one bulb, Busy Light uses it; with several, choose one. The choice is saved by the bulb's serial number, so renaming the bulb in the LIFX app changes nothing, and the plugin finds it again if its IP address changes, so you do not need a reserved address in your router. Search again looks once more.

When the page opens, the card says which bulb the running plugin uses, for example "Busy Light is using Floor (192.168.4.50).", or that it did not answer last time, without searching the network again.

- **Brightness** scales every color.
- **Test light** shows red, then green, then your Available color on the bulb, and says whether it answered.
- Under **Advanced**: the bulb's IP address, only needed when the search cannot reach the bulb (for example when Homebridge runs in Docker without host networking), and how often the color is sent again, which recovers a bulb that was switched off at the wall (0 sends only when the status changes).

**Other lights in the Home app.** Busy Light cannot control other HomeKit lights itself. It adds occupancy sensors to the Home app, and an automation there sets the light. Each sensor is its own accessory, so you can put it in any room. By default there are three:

| Sensor | Detects occupancy while |
| --- | --- |
| Busy Light Available | Available |
| Busy Light Busy | In a meeting, in a call, do not disturb, or busy |
| Busy Light Out of Office | Out of office |

Under Show all statuses you can add one for each individual status: In a Meeting, In a Call, Do Not Disturb, Busy in Teams, Tentative, Away and Offline. Statuses your setup cannot produce yet come last there, marked "Nothing in your setup reports this yet."; you can still add them. The names start with the Name under Settings, and renaming keeps your rooms and automations.

For example, to make a Hue lamp red when you are busy:

1. In the Home app, add an automation: A sensor detects something.
2. Choose Busy Light Busy, then Detects occupancy.
3. Set your light to red.

Add a second automation on Busy Light Available to set it back to green.

### Settings

Under Advanced:

- **Name** starts the name of every sensor.
- **Check status every** (15 or 30 seconds, or 1, 2 or 4 minutes; 30 seconds by default) and **Reload calendars every** (1, 2, 3, 5 or 10 minutes; 3 minutes by default). `config.json` keeps them in seconds.
- **Ignore all-day events marked busy** (on by default). All-day out of office events always count.
- **Out of office words**, separated by commas.
- **Override switch** adds "Busy Light Override" to the Home app. While it is on, the status is Do not disturb whatever your calendars say. It keeps its state across restarts.
- **Debug logging** writes extra detail (counts and times only) to the log.
- **Reset plugin to fresh install** signs out of Microsoft 365, removes every Busy Light sensor and switch from the Home app, and clears every setting on the page. Type RESET to confirm, then click Save and restart Homebridge.

The page checks each field when you leave it, and lists anything to fix under Settings ("Fix these before saving:"); Save stays disabled until it is fixed.

## Configuration

The settings page writes this block to `config.json`. Every field except `platform` is optional, and a block written by an earlier beta keeps working as it is, with Status from other apps and the On a Call switch off.

```json
{
  "platform": "BusyLight",
  "name": "Busy Light",
  "calendars": [
    { "type": "icloud", "id": "cal-mgx3k2f1a9q", "name": "iCloud", "appleId": "you@example.com", "appPassword": "abcd-efgh-ijkl-mnop",
      "calendars": [ { "id": "/123456789/calendars/home/", "name": "Home", "use": "all" },
                     { "id": "/123456789/calendars/family-1/", "name": "Family", "use": "outOfOffice" } ] },
    { "type": "google", "id": "cal-mgx3k5b7c2d", "name": "Personal", "url": "https://calendar.google.com/calendar/ical/.../basic.ics", "email": "you@example.com", "use": "all" },
    { "type": "microsoft", "id": "cal-mgx3k8e4f6g", "name": "Work", "tenantId": "00000000-0000-0000-0000-000000000000", "clientId": "00000000-0000-0000-0000-000000000000",
      "useTeamsStatus": true, "useCalendar": true, "calendars": [ { "id": "AAMk...", "name": "Calendar", "use": "all" } ] },
    { "type": "url", "id": "cal-mgx3kb9h1j4", "name": "Team rota", "url": "webcal://example.com/rota.ics", "use": "outOfOffice", "calendarSeconds": 600 }
  ],
  "statusInput": { "enabled": true, "port": 8582, "key": "Rk7fJ3...43 random characters...", "allowPlainKey": true },
  "callSwitch": { "enabled": true, "hours": 3 },
  "colors": { "available": "#00FF00", "offline": "off" },
  "lifx": { "enabled": true, "bulb": "d073d5000001", "host": "", "brightness": 100, "refreshSeconds": 300 },
  "sensors": ["available", "busyAny", "outOfOffice"],
  "overrideSwitch": false,
  "pollSeconds": 30,
  "calendarSeconds": 180,
  "ignoreAllDayBusy": true,
  "outOfOfficeWords": ["Out of office", "OOO", "Vacation", "PTO"],
  "debug": false
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | `Busy Light` | Starts the name of every sensor |
| `calendars` | none | The calendars that count. Names must be unique. The page gives each one an `id`, which never changes |
| `calendars[].calendars` | every calendar (iCloud), the default calendar (Microsoft 365) | The calendars to read, each `{ "id", "name", "use" }`. For iCloud a plain name also works, as the first beta wrote it |
| `calendars[].use`, `calendars[].calendars[].use` | `all` | `all` (busy and out of office) or `outOfOffice` (out of office only) |
| `calendars[].calendarSeconds` | `calendarSeconds` | How often this calendar is read again (60 to 600). Leave it out to use the platform value |
| `statusInput` | off | Status from other apps: `enabled`, `port` (8582; 1024 to 65535), `key` (32 to 128 letters, digits, hyphens or underscores; the page makes one) and `allowPlainKey` (`true`) |
| `callSwitch` | off | The On a Call switch: `enabled`, and `hours` (3; 1 to 12) after which it turns itself off |
| `colors` | as in the status table | `#RRGGBB` or `off` for each status: `outOfOffice`, `doNotDisturb`, `inCall`, `inMeeting`, `busy`, `tentative`, `away`, `available`, `offline` |
| `lifx` | off | The bulb: `bulb` is its serial number (or its name from the LIFX app), `host` an IP address only when it cannot be found |
| `sensors` | the three roll-ups | Any of `available`, `busyAny`, `outOfOffice`, `inMeeting`, `inCall`, `doNotDisturb`, `busy`, `tentative`, `away`, `offline` |
| `overrideSwitch` | `false` | Adds the override switch |
| `pollSeconds` | `30` | How often the status is checked (15 to 240) |
| `calendarSeconds` | `180` | How often calendars are reloaded (60 to 600) |
| `ignoreAllDayBusy` | `true` | Ignore all-day events marked busy or tentative |
| `outOfOfficeWords` | as shown | Title words that make an iCloud, Google or calendar link event out of office |
| `debug` | `false` | Writes extra detail (counts and times only) to the log |

A mistake in the configuration never stops Homebridge: an invalid calendar is skipped with one error line naming the field, and an invalid setting falls back to its default with a warning.

The light changes at the minute a meeting starts or ends, without waiting for the next check.

## Command line

The settings page covers everything; the `homebridge-busy-light` command is the fallback, for checking from a terminal or when the page is not available. Run it as the same user Homebridge runs as (on a Raspberry Pi image, `sudo -u homebridge`), so a Microsoft sign-in is saved where the plugin looks for it.

| Command | Does |
| --- | --- |
| `homebridge-busy-light status` | Shows what the plugin is doing: the status, why, and one line per calendar |
| `homebridge-busy-light check` | Reads every calendar once and shows its state, how many events it has around now, the events on now (as times and busy, free, tentative or out of office only), and the status they give. It does not touch HomeKit or the bulb |
| `homebridge-busy-light login [name]` | Signs in to the named Microsoft 365 calendar (or the only one); the running plugin picks up the sign-in without a restart |
| `homebridge-busy-light lights` | Searches the network for LIFX bulbs and lists each one's name, serial number and IP address |
| `homebridge-busy-light light [name or IP] [#RRGGBB or off]` | Sends a color (the Available color by default) to a bulb and says whether it answered |
| `homebridge-busy-light input` | Shows whether Status from other apps and the On a Call switch are on, the addresses apps use, and the apps reporting now. It never shows the key |
| `homebridge-busy-light input --setup-code` | Prints the setup code, which contains the key, after a warning line |
| `homebridge-busy-light input test` | Sends a signed test call for 30 seconds to the running plugin, as Test on the page does |
| `homebridge-busy-light help` | Lists the commands |

Add `-U <path>` to use a Homebridge storage directory other than `/var/lib/homebridge` (or `~/.homebridge` when that does not exist).

## Privacy

- Busy Light reads each event's start, end, free or busy setting, all-day and cancelled flags, and nothing else is kept. For iCloud, Google and calendar links the title is read in memory only, to match the out of office words, and is never logged or stored.
- From Microsoft Graph it asks only for your presence, your calendars' names and owners, and, for each event, show-as, start, end, all-day and cancelled.
- Passwords, tokens, sign-in device codes and calendar addresses are never written to the log. A calendar address is shown by its host name only.
- The settings page sends each request only what that request needs (for example, Connect sends the Apple ID and app-specific password and nothing else), and the unsaved changes it keeps in your browser never include a password or a calendar address.
- Data goes only to your calendar services, Microsoft's sign-in and Graph services, and your bulb, and, with Status from other apps on, the answers Busy Light gives to apps on your local network. There is no telemetry.
- From other apps Busy Light takes only a sender's name, a status, an app name and how long the status lasts; any other field is refused. The key is never written to the log or the state file, and requests from outside the local network are refused.
- Everything Busy Light stores is in the `busy-light` folder of your Homebridge storage directory: the Microsoft sign-in (`microsoft-<id>.json`), the bulb it found (`light.json`), its current state (`state.json`), and with Status from other apps on, the apps' reports (`inputs.json`) and this Busy Light's id (`instance.json`).

## Troubleshooting

**Start with the calendar cards and Right now.** Each card shows its state and, when something is wrong, the reason. From a terminal, `homebridge-busy-light check` shows the same, using the same code as the plugin.

**"Status unknown. None of your calendars could be read."** None of your calendars has answered for 15 minutes. The cards (and the log) say why for each one, for example `Family: could not be read (p01-caldav.icloud.com answered HTTP 503). Trying again in 1 minute.` Busy Light retries after 1, 2, 5 and then every 15 minutes.

**iCloud: "did not accept that Apple ID and app-specific password".** Check the Apple ID email, and create a new app-specific password. Your normal Apple ID password does not work here.

**A calendar "was not found".** A calendar you ticked was deleted, or is no longer shared with you. Open the card, click Connect (or Refresh list) and tick the calendars you want.

**Google or a calendar link: "answered with an error (404)".** The address is no longer valid. In Google Calendar you can reset the secret address; paste the new one into the card.

**Microsoft 365: "Microsoft did not allow the sign-in".** The reason tells your administrator which step to look at. Send them the text in [docs/microsoft-365-admin-request.md](docs/microsoft-365-admin-request.md), with the reason. Common reasons:

| The reason | What it means |
| --- | --- |
| the Directory (tenant) ID or Application (client) ID was not recognised | One of the IDs is wrong, or the app registration was deleted |
| the app registration does not allow public client flows | "Allow public client flows" is off in the app registration |
| your organization has not approved the permissions | Your organization needs an administrator to approve the permissions |
| your organization's sign-in policy blocked it | A Conditional Access policy blocks this kind of sign-in |
| that account does not belong to this organization | You signed in with an account from another organization |

**Microsoft 365: "The code expired."** Click Connect again for a new code. If the plugin's own sign-in wrote "the sign-in code was not used" to the log, Connect on the card (or `homebridge-busy-light login`) signs in without a restart.

**"No LIFX bulb found."** Check that the bulb is switched on and on the same network as Homebridge, then click Search again. If Homebridge runs in Docker without host networking, the search cannot reach the bulb: enter its IP address under Advanced.

**"No answer from the bulb."** The bulb may be switched off at the wall. The plugin keeps trying, and looks for the bulb again if it has a new IP address.

**"Status input could not start: port 8582 is already in use."** Another program uses that port. Choose another port under Advanced in Status from other apps, then Save and restart Homebridge, and give your apps the new setup code.

**Test says "Busy Light is not listening yet."** Status from other apps is ticked but not yet running: click Save and restart Homebridge. If it still says so, look for the line above in the log.

**An app gets `401`.** `unauthorized` means the app has an old key (after Replace key) or the plugin has not restarted since the key changed; `plain_key_off` means the app sent the key itself while Allow the plain key is off. The log names the address once an hour, for example `Status input: refused a request with a wrong key from 192.168.4.23.`

**An app cannot reach Busy Light.** Check that the app's computer is on the home network and that the address works from it (`curl http://homebridge.local:8582/v1/ping`). If the address by name does not work on your network, use the IP address and reserve it for Homebridge in your router.

**The Address shows only an IP address, with the "reserve this address" help.** Busy Light could not confirm its name on your network: it asks once with multicast DNS, as a Mac or iPhone would, then the computer's own resolver. Apps can use the IP address; reserve it for Homebridge in your router so it does not change.

**"Homebridge's address changed from 192.168.4.10 to 192.168.4.23."** With no name confirmed, the IP address apps were given changed (a router gave Homebridge a new one). Give your apps the new setup code from the page; the notice there stays until you save the page.

**More detail:** turn on Debug logging under Settings. Debug lines report counts and times, never event details.

When you open an issue, include the output of `homebridge-busy-light check` and the log lines, and remove anything private first.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Not affiliated with or endorsed by Apple, Google, Microsoft or LIFX. iCloud, Google Calendar, Microsoft 365, Outlook, Teams and LIFX are trademarks of their respective owners.
