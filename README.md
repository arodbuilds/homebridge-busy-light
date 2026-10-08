<p align="center">
  <img src="https://raw.githubusercontent.com/arodbuilds/homebridge-busy-light/latest/assets/busy-light-banner.png" alt="Busy Light for Homebridge" width="100%">
</p>

# Busy Light for Homebridge

Your calendar and Teams status on a light. Green when you are free, red when you are not.

Status: beta. Version 0.1.0-beta.1 is the first build. It has been tested against recorded responses, not yet against every calendar service and bulb. Please report what you find.

Busy Light reads your calendars and, if you use Microsoft 365, your Teams presence, and reduces them to one status. It shows that status two ways:

1. On a LIFX bulb, directly over your home network, in a color you choose for each status. No LIFX account or cloud is used.
2. As HomeKit occupancy sensors, so a Home automation can set any other HomeKit light or scene.

A typical use is a lamp outside a home office door: green when you are free, red in a meeting or on a call, purple when you are out of office, and off when Teams shows you offline.

It works with:

- iCloud calendars
- Google Calendar
- Microsoft 365 (Outlook calendar and Teams presence)
- Any calendar subscription link that starts with `https://` or `webcal://`

Add as many calendars as you like. Events from all of them are combined.

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

All-day events marked busy or tentative are ignored by default, so a reminder that fills the whole day does not keep the light red. All-day out of office events always count.

Calendars have no out of office setting of their own, so for iCloud, Google and calendar links an event counts as out of office when its title contains one of the out of office words (by default: Out of office, OOO, Vacation, PTO). Invitations you declined are ignored when Busy Light knows your address (your Apple ID, or the email you give for Google).

If none of your calendars can be read for 15 minutes, the status becomes unknown: every sensor turns off and the bulb is left as it is, so a meeting never sticks because a calendar became unreachable.

## Install

Install Busy Light from the Plugins tab of the Homebridge UI, or run:

```shell
npm install -g homebridge-busy-light@beta
```

Then open the plugin settings, add at least one calendar, and choose how the light is controlled. Restart Homebridge after saving.

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

Then restart Homebridge.

## Setting up each calendar

### iCloud

1. Sign in at [account.apple.com](https://account.apple.com), open Sign-In and Security, then App-Specific Passwords, and create one named Busy Light.
2. In the plugin settings, add a calendar of type iCloud with your Apple ID email and that app-specific password. This is not your Apple ID password, and Busy Light never sees your Apple ID password or two-factor codes.
3. Leave "Calendars to include" empty to use every calendar, or list the names you want. After a restart the log lists the calendar names found, for example:

   ```
   Family: calendars found: Home, Work, Kids. In use: Home, Work.
   ```

Reminders lists are skipped automatically. If iCloud does not accept the password, Busy Light tries again only once an hour so a wrong password cannot lock your Apple ID.

### Google Calendar

1. Open Google Calendar on a computer, open Settings, pick the calendar on the left, then Integrate calendar.
2. Copy the "Secret address in iCal format". Treat it like a password: anyone with it can read the calendar. Busy Light never writes it to the log, only its host name.
3. In the plugin settings, add a calendar of type Google Calendar and paste the address.
4. Optionally enter your Google email, so invitations you declined are ignored.

Google refreshes the secret address on its own schedule, so a change you make in Google Calendar can take a while to reach the light.

### Microsoft 365

Microsoft 365 needs an app registration in your organization's tenant, which only your administrator can create. You need two IDs from them: the Directory (tenant) ID and the Application (client) ID.

**What to ask for:** send your administrator the text in [docs/microsoft-365-admin-request.md](docs/microsoft-365-admin-request.md). It is written to be copied and pasted as is: what Busy Light does, the exact registration steps, the two IDs to send back, and notes for a security review.

Once you have the two IDs:

1. In the plugin settings, add a calendar of type Microsoft 365 and enter both IDs. Choose whether to use your Teams status, your Outlook calendar, or both.
2. Restart Homebridge. The log shows a sign-in code:

   ```
   Work: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code ABCD1234.
   ```

3. Open that address on any device, enter the code and sign in with your work account. The log confirms it:

   ```
   Work: signed in to Microsoft 365.
   ```

That is all. Busy Light stays signed in from then on. If a code goes unused it issues another, up to three, then stops until Homebridge restarts. You can also sign in from a terminal at any time with `homebridge-busy-light login` (see [Command line](#command-line)); the running plugin picks up the sign-in without a restart.

If Microsoft refuses the sign-in, the log says why in plain words and points to the instructions for your administrator, for example:

```
Work: Microsoft did not allow the sign-in: the app registration does not allow public client flows. This needs your Microsoft 365 administrator. Instructions to send them: https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/microsoft-365-admin-request.md
```

Only one Microsoft 365 calendar can use Teams status.

### Calendar link

Any calendar subscription link that starts with `https://` or `webcal://` works, for example a team rota or a shared holiday calendar. Add a calendar of type Calendar URL and paste the link. Like a Google secret address, the link is never written to the log.

## The LIFX bulb

Tick "Set a LIFX bulb directly". With one LIFX bulb on your network, that is all: Busy Light finds it automatically and remembers it, and finds it again if its IP address changes, so you do not need a reserved address in your router.

- **Several bulbs:** enter the bulb's name as shown in the LIFX app (or its serial number) in "Bulb name". The log lists the bulbs found:

  ```
  LIFX bulbs found: Office Door (192.168.4.50), Desk (192.168.4.51). Using Office Door.
  ```

- **Bulb IP address:** only needed when the bulb cannot be found automatically, for example when Homebridge runs in Docker without host networking.
- **Brightness:** scales every color.
- **Send the color again every (seconds):** recovers a bulb that was switched off at the wall. Set it to 0 to send only when the status changes.

Colors are set per status under Colors, as `#RRGGBB`, or `off` to turn the light off for that status.

## HomeKit sensors

Busy Light cannot control other HomeKit lights itself. It adds occupancy sensors to the Home app, and an automation there sets the light. Each sensor is its own accessory, so you can put it in any room.

By default there are three:

| Sensor | Detects occupancy while |
| --- | --- |
| Busy Light Available | Available |
| Busy Light Busy | In a meeting, in a call, do not disturb, or busy |
| Busy Light Out of Office | Out of office |

You can also add one for each individual status: In a Meeting, In a Call, Do Not Disturb, Busy in Teams, Tentative, Away and Offline. The names start with the Name you set in the plugin settings, and renaming keeps your rooms and automations.

**Example: a Hue lamp that turns red when you are busy**

1. In the Home app, add an automation: A Sensor Detects Something.
2. Choose Busy Light Busy, Detects Occupancy.
3. Set your lamp to red.

Add a second automation on Busy Light Available to set it back to green.

The optional **override switch** adds "Busy Light Override" to the Home app. While it is on, the status is Do not disturb whatever your calendars say. It keeps its state across restarts.

## Configuration

The settings form in the Homebridge UI writes this block to `config.json`. Every field except `platform` is optional.

```json
{
  "platform": "BusyLight",
  "name": "Busy Light",
  "calendars": [
    { "type": "icloud", "name": "Family", "appleId": "you@example.com", "appPassword": "abcd-efgh-ijkl-mnop", "calendars": [] },
    { "type": "google", "name": "Personal", "url": "https://calendar.google.com/calendar/ical/.../basic.ics", "email": "you@example.com" },
    { "type": "microsoft", "name": "Work", "tenantId": "00000000-0000-0000-0000-000000000000", "clientId": "00000000-0000-0000-0000-000000000000", "useTeamsStatus": true, "useCalendar": true },
    { "type": "url", "name": "Team rota", "url": "webcal://example.com/rota.ics" }
  ],
  "colors": { "available": "#00FF00", "offline": "off" },
  "lifx": { "enabled": true, "bulb": "", "host": "", "brightness": 100, "refreshSeconds": 300 },
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
| `calendars` | none | The calendars that count. Names must be unique |
| `colors` | as in the status table | `#RRGGBB` or `off` for each status: `outOfOffice`, `doNotDisturb`, `inCall`, `inMeeting`, `busy`, `tentative`, `away`, `available`, `offline` |
| `lifx` | off | The bulb, as described above |
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

The plugin installs a `homebridge-busy-light` command. Run it as the same user Homebridge runs as (on a Raspberry Pi image, `sudo -u homebridge`), so a Microsoft sign-in is saved where the plugin looks for it.

| Command | Does |
| --- | --- |
| `homebridge-busy-light status` | Shows what the plugin is doing: the status, why, and one line per calendar |
| `homebridge-busy-light check` | Reads every calendar once and shows its state, how many events it has around now, the events on now (as times and busy, free, tentative or out of office only), and the status they give. It does not touch HomeKit or the bulb |
| `homebridge-busy-light login [name]` | Signs in to the named Microsoft 365 calendar (or the only one) |
| `homebridge-busy-light lights` | Searches the network for LIFX bulbs and lists each one's name, serial number and IP address |
| `homebridge-busy-light light [name or IP] [#RRGGBB or off]` | Sends a color (the Available color by default) to a bulb and says whether it answered |
| `homebridge-busy-light help` | Lists the commands |

Add `-U <path>` to use a Homebridge storage directory other than `/var/lib/homebridge` (or `~/.homebridge` when that does not exist).

## Privacy

- Busy Light reads each event's start, end, free or busy setting, all-day and cancelled flags, and nothing else is kept. For iCloud, Google and calendar links the title is read in memory only, to match the out of office words, and is never logged or stored.
- From Microsoft Graph it asks only for your presence and, for each event, show-as, start, end, all-day and cancelled.
- Passwords, tokens, sign-in device codes and calendar addresses are never written to the log. A calendar address is shown by its host name only.
- Data goes only to your calendar services, Microsoft's sign-in and Graph services, and your bulb. There is no telemetry.
- Everything Busy Light stores is in the `busy-light` folder of your Homebridge storage directory: the Microsoft sign-in (`microsoft-<id>.json`), the bulb it found (`light.json`) and its current state (`state.json`).

## Troubleshooting

**Start with `homebridge-busy-light check`.** It shows each calendar's state and the status they give, using the same code as the plugin.

**"Status unknown: none of your calendars could be read."** None of your calendars has answered for 15 minutes. The lines before it say why for each calendar, for example `Family: could not be read (p01-caldav.icloud.com answered HTTP 503). Trying again in 1 minute.` Busy Light retries after 1, 2, 5 and then every 15 minutes.

**iCloud: "did not accept the Apple ID and app-specific password".** Check the Apple ID email, and create a new app-specific password. Your normal Apple ID password does not work here.

**Google or a calendar link: "answered HTTP 404".** The address is no longer valid. In Google Calendar you can reset the secret address; paste the new one into the plugin settings.

**Microsoft 365: "Microsoft did not allow the sign-in".** The reason in the log tells your administrator which step to look at. Send them the text in [docs/microsoft-365-admin-request.md](docs/microsoft-365-admin-request.md), with the reason from the log. Common reasons:

| The log said | What it means |
| --- | --- |
| the Directory (tenant) ID or Application (client) ID was not recognised | One of the IDs is wrong, or the app registration was deleted |
| the app registration does not allow public client flows | "Allow public client flows" is off in the app registration |
| your organization has not approved the permissions | Your organization needs an administrator to approve the permissions |
| your organization's sign-in policy blocked it | A Conditional Access policy blocks this kind of sign-in |
| that account does not belong to this organization | You signed in with an account from another organization |

**Microsoft 365: "the sign-in code was not used".** Three codes went unused. Restart Homebridge, or run `homebridge-busy-light login`.

**"No LIFX bulb was found on the network."** Check that the bulb is switched on and on the same network as Homebridge. Run `homebridge-busy-light lights` to search. If Homebridge runs in Docker without host networking, broadcasts do not reach the bulb: enter its IP address in the plugin settings.

**"More than one LIFX bulb was found".** Enter the name of the bulb to use, exactly as the LIFX app shows it.

**"The LIFX bulb at ... did not answer."** The bulb may be switched off at the wall. Busy Light keeps trying, and looks for the bulb again if it has a new IP address. Run `homebridge-busy-light light` to test it.

**More detail:** turn on Debug logging in the plugin settings. Debug lines report counts and times, never event details.

When you open an issue, include the output of `homebridge-busy-light check` and the log lines, and remove anything private first.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Not affiliated with or endorsed by Apple, Google, Microsoft or LIFX. iCloud, Google Calendar, Microsoft 365, Outlook, Teams and LIFX are trademarks of their respective owners.
