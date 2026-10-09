# Changelog

All notable changes to Busy Light are recorded here. Versions follow [semantic versioning](https://semver.org).

## 0.1.0-beta.5 (2026-10-09)

The fixes from a code review and a test pass after the first public beta, the day in "until" times, and the owner's requests: a Working switch, a warning before meetings, and copy buttons for the addresses. A configuration written by an earlier beta loads and behaves as before, with the Working switch and the meeting warning off.

### Added

- The Working switch: tick "Add a Working switch to the Home app" under Lights and the Home app gets "Busy Light Working". It starts on. Turned off (at the end of the day, for example in a "stop work" scene), the light stays off and every sensor is off whatever your calendars say, Right now says Not working, `homebridge-busy-light status` says `Status: Not working (the Working switch is off).` and the status API answers `notWorking`. Turned on, the status shows again at once. Its state survives restarts (`workingSwitch` in the configuration).
- Warn before meetings, under Colors (Off by default; 1, 2, 3 or 5 minutes, `meetingWarningSeconds`): before a meeting from your calendars, the bulb fades from the Available color to the In a meeting color, in one command timed to the meeting's start. Right now says "A meeting starts at {time}." meanwhile, and an optional Busy Light Meeting Soon sensor detects occupancy. It starts only when you are Available and the next change is a calendar meeting.
- A Copy button beside each Address line in Status from other apps.
- Cleared in Apps reporting now, for an app that withdrew its report with `clear`; Expired stays for a report that ran out.
- "To light up only during meetings, choose Off for Available." under Colors, and a README section on pairing it with the Working switch and the meeting warning.
- A warning in the log when a recurring event repeats too often to read in full, once per calendar.
- The settings page's help for Status from other apps names Jeronimo, and the README features it as the ready-made way to turn the light red when a call starts.

### Changed

- An "until" time that is not today carries its day, for example "Nothing on your calendars until tomorrow at 9:00 AM.", on the settings page, in the log and in `homebridge-busy-light status`. The state file keeps the time itself.
- Colors and the sensor list show Do not disturb, Busy, Away and Offline only with Teams status, or once an app has reported that status in the last 30 days. Turning on Status from other apps alone adds In a call only.
- The README opens like the owner's other plugins: the banner, badges, a status note and a table of contents.
- The release workflow publishes only through npm trusted publishing with provenance.

### Fixed

- Recurring events no longer hold up Homebridge. A calendar with many recurring series, or series that ended years ago, could take seconds to read on every check, during which HomeKit showed No Response. Each series is now read only near the current time: a test feed of 500 recurring series and 5,000 events that took over a minute now reads in under half a second. A series that repeats every hour since 2023 shows today's occurrences again.
- A recurring meeting moved to an earlier day (a Friday meeting moved to Thursday) now shows.
- The light changes on time when a meeting starts while a calendar is slow to answer, or while the bulb is not answering.
- The light never moves to a different bulb by itself: a chosen bulb that stops answering is looked for again, and a neighbor's bulb that happens to answer is never sent a color.
- An invitation declined by an attendee written with an `EMAIL=` parameter is ignored, as other declined invitations are.
- "Working elsewhere" in an Outlook published calendar counts as free, as it does through Microsoft 365 sign-in.
- A report or switch expiry set far in the future no longer fires at once.
- The sender name "Home app" is kept for the On a Call switch: an app that reports as "Home app", in any Unicode form, is refused.
- Clicking a button just below an empty required field (Add calendar under an empty Outlook Address) no longer loses the click.

## 0.1.0-beta.4 (2026-10-08)

What the first pass on a Raspberry Pi found. The configuration format does not change: every interval stays in seconds and every color stays saved, so an existing configuration loads and behaves exactly as before.

### Added

- Outlook or Microsoft 365 in Add calendar, with two options: Published calendar link (recommended: works with any Outlook or Microsoft 365 calendar with no IT approval, and shows busy, tentative and out of office) and Sign in with Microsoft 365 (for live Teams status, which needs IT approval). The published link adds a Calendar URL card named Outlook with the three steps to get the link from Outlook on the web.
- How to get this link, collapsed, on any Calendar URL card whose address is an Outlook link.
- A warning in the log, and a notice above the Address on the settings page until it is saved, when the IP address apps were given changes: "Homebridge's address changed from ... to .... Apps that use the old address need the new setup code."

### Changed

- Busy Light finds its name on the network the way a Mac or iPhone does, with one multicast DNS query, before trying the computer's own resolver. On the Homebridge Raspberry Pi image the name resolves to 127.0.0.1 on the Pi itself, so the settings page showed only the IP address; it now shows `http://homebridge.local:8582` first when the network confirms it. The settings page keeps the result for 10 minutes; `homebridge-busy-light input` checks for itself.
- The setup code is masked like the key, and the key's Show and Hide reveal and mask both. Copy setup code copies the whole code either way.
- Intervals are chosen as durations: Check for changes every on each calendar (1 to 10 minutes, or Same as Settings), Check status every (15 seconds to 4 minutes) and Reload calendars every (1 to 10 minutes). A value saved earlier that is not in a list, such as 90 seconds, is shown as "1 minute 30 seconds" and kept.
- Colors shows the statuses your setup can produce: with calendars alone, Out of office, In a meeting, Tentative and Available. The other five wait behind "5 more statuses come from Teams or from other apps." and Show all statuses, and appear as you turn on the status input, the On a Call switch or Teams status. The per-status sensors list those statuses last, marked "Nothing in your setup reports this yet."
- The README leads with the Outlook published calendar link for work calendars, with sign-in as the advanced option.

### Removed

- The "Teams only" badges on the Colors list.

## 0.1.0-beta.3 (2026-10-08)

Status from other apps. Other apps on your home network can now tell Busy Light you are on a call or busy, and the Home app gets an optional On a Call switch. Each calendar can have its own check interval, and colors are chosen from presets. A configuration written by an earlier beta keeps working unchanged, with the new features off.

### Added

- Status from other apps: a small HTTP API on the local network (port 8582 by default), off until you turn it on. Apps report a status (Out of office, Do not disturb, In a call, In a meeting, Busy, Away, Available or Offline) with their name and, optionally, the app it comes from, and withdraw it with `clear`. Reports count like Teams presence in the order of the status table, last 3 minutes unless repeated, and survive a Homebridge restart. The full description for app builders is in `docs/status-input.md`.
- Signed requests, so an app never sends the key over the network, with a replay rule that refuses a captured report sent again, even after the call ends or across a restart. The key itself is accepted from Apple Shortcuts and curl while "Allow the plain key" is on. Requests from outside the local network are refused, and each address is limited to 60 requests a minute.
- The settings page's Status from other apps section: the addresses (by name when the network supports it), the key with Copy and Replace, a setup code to paste into an app, Test, the port under Advanced, and Apps reporting now, which shows each app's last status, whether it is still active, and whether it signs its requests.
- The On a Call switch: an optional Home app switch that reports In a call while it is on, for shortcuts, Siri, Home tiles and automations, and turns itself off after 3 hours (1 to 12).
- Command line: `homebridge-busy-light input` shows the status input, its addresses and the apps reporting now; `input --setup-code` prints the setup code; `input test` sends a test call.
- A check interval for each calendar, under Advanced on its card (`calendars[].calendarSeconds`, 60 to 600 seconds), so a calendar that changes rarely can be read less often.
- Right now names the app a status came from, for example "From CallWatch on Alex’s iMac (Microsoft Teams)."

### Changed

- Colors are chosen from presets (Red, Orange, Yellow, Green, Blue, Purple, White, Off) or Custom, which shows the color picker and the hex field. The configuration format is unchanged; a color that is not a preset shows as Custom.
- The Lights card says which bulb the running plugin uses as soon as the page opens, without searching the network.
- "Teams only" marks a status only while no Microsoft 365 calendar uses Teams status and Status from other apps is off, since another app can report those statuses.
- The status is unknown only when no calendar can be read and no app is reporting.

### Fixed

- The Microsoft 365 sign-in file is noticed when it is replaced within the same clock tick, so a sign-in from the command line is never missed by the running plugin.

## 0.1.0-beta.2 (2026-10-08)

The settings page. Busy Light now has its own page in the Homebridge UI in place of the standard form, and calendars are picked from a list instead of typed by name. A configuration written by the first beta keeps working unchanged.

### Added

- The settings page, in five parts: Right now (the status, color and reason the running plugin shows, refreshed every 15 seconds), Calendars, Colors, Lights and Settings. Each field is checked when you leave it, the problems are listed above Save, and changes you leave unsaved are offered back the next time the page opens, never with a password or calendar address.
- Calendars picked from a list. Connect on an iCloud card lists your iCloud calendars with how many events each has today, marking calendars shared with you and calendars you have not chosen before. Choices are saved by the calendar's identifier and name, so renaming a calendar no longer matters.
- "Counts for": each calendar counts for busy and out of office, or for out of office only (`use`: `all` or `outOfOffice`), for example a family calendar whose holidays count but whose appointments do not.
- Microsoft 365 sign-in from the page: Connect shows the code and a link to Microsoft's sign-in page, notices when you have finished, and then lists your Outlook calendars to tick. More than one Outlook calendar can count. Disconnect signs out.
- Test on Google Calendar and Calendar URL cards: says how many events the calendar has today, or what went wrong.
- A bulb finder: ticking "Use a LIFX bulb" searches the network, uses the bulb when there is one and lets you choose when there are several. Test light shows red, then green, on the bulb.
- Reset plugin to fresh install, which signs out of Microsoft 365, removes every Busy Light accessory from the Home app at the next restart and clears the settings.
- Log lines naming iCloud calendars that are not in use yet, and a ticked calendar that is no longer there.

### Changed

- `calendars[].calendars` entries can be `{ "id", "name", "use" }` objects. A plain name, as the first beta wrote it, still works for iCloud.
- The standard settings form (still used where the settings page is not available): the App-specific password help links to account.apple.com and to Apple's instructions for creating one, and it shows "Counts for".
- A new runtime dependency, `@homebridge/plugin-ui-utils`, for the settings page.

### Fixed

- Standard settings form: choosing a calendar type no longer leaves the whole calendar entry stuck to the mouse pointer. No list in the form can be dragged to reorder.

## 0.1.0-beta.1 (2026-10-08)

The first beta: the plugin, the command line tool and the standard Homebridge settings form. The custom settings page follows in a later beta.

### Added

- Calendars: iCloud (CalDAV with an app-specific password), Google Calendar (secret iCal address), Microsoft 365 (Outlook calendar and Teams presence through Microsoft Graph), and any `https://` or `webcal://` calendar link. Any number, combined.
- Nine statuses with a fixed precedence: Out of office, Do not disturb, In a call, In a meeting, Busy, Tentative, Away, Available and Offline. Recurring events, time zones and moved occurrences are read with ical.js. Declined invitations are ignored, out of office is recognised from title words, and all-day busy events can be ignored.
- Microsoft 365 sign-in with a device code shown in the log, refresh in the background, and plain-language reasons when Microsoft refuses the sign-in, with instructions to send an administrator in `docs/microsoft-365-admin-request.md`.
- LIFX bulb control over the local network with acknowledgements, a color per status, a brightness setting and a periodic resend. The bulb is found automatically and found again if its IP address changes; an IP address is only needed when broadcasts cannot reach it.
- HomeKit occupancy sensors: Available, Busy and Out of Office by default, and one for each individual status on request, with names that can change without breaking automations.
- An optional override switch that forces Do not disturb.
- The light changes at the minute a meeting starts or ends. Failing calendars are retried after 1, 2, 5 and then every 15 minutes; after 15 minutes without data the status is unknown and the bulb is left alone.
- A state file, `busy-light/state.json`, for the command line tool and the coming settings page.
- The `homebridge-busy-light` command: `status`, `check`, `login`, `lights`, `light` and `help`.
- The standard Homebridge settings form.

### Privacy

- Passwords, tokens, device codes and calendar addresses are never logged. Event titles are read in memory only, to match the out of office words, and are never logged or stored.
