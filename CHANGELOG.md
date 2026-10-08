# Changelog

All notable changes to Busy Light are recorded here. Versions follow [semantic versioning](https://semver.org).

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
