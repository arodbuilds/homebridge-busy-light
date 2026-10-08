# Changelog

All notable changes to Busy Light are recorded here. Versions follow [semantic versioning](https://semver.org).

## Unreleased

### Fixed

- Settings form: choosing a calendar type no longer leaves the whole calendar entry stuck to the mouse pointer. No list in the form can be dragged to reorder.

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
