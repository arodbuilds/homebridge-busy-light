# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.0-beta.x | Yes |

Only the newest release receives security fixes. Older versions do not.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the Security tab of this repository and choose Report a vulnerability. Do not open a public issue for security problems.

You will get an acknowledgement within a few days, a fix or mitigation as soon as one is ready, and credit in the release notes if you want it.

## Scope

In scope: anything that could expose an app-specific password, a Microsoft refresh or access token, or a calendar's secret address; anything that writes an event's title, description, location or attendees to the log, the state file or anywhere else; anything that weakens the Microsoft sign-in or sends data anywhere other than the configured calendar services, Microsoft's sign-in and Graph services, and the bulb.

Out of scope: Apple, Google, Microsoft or LIFX changing their services. Those break the plugin but are not vulnerabilities; report them as ordinary issues.
