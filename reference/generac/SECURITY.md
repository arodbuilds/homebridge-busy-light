# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |
| 0.1.0-beta.x | No |

Only the newest release receives security fixes. Older versions do not.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the Security tab of this repository and choose Report a vulnerability. Do not open a public issue for security problems.

You will get an acknowledgement within a few days, a fix or mitigation as soon as one is ready, and credit in the release notes if you want it.

## Scope

In scope: anything that could expose the Mobile Link refresh token, the DPoP key or a password, or weaken the sign-in flow.

Out of scope: Generac changing its undocumented API or login page. Those break the plugin but are not vulnerabilities; report them as ordinary issues.
