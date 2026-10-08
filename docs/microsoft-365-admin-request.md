# What to ask your Microsoft 365 administrator for

I would like an app registration in our Microsoft 365 tenant so a small tool on my home network can read my own Teams presence and my own calendar free/busy, and show it on a desk light. It is read-only, signs in as me only, and stores no client secret.

## What to create

1. **Microsoft Entra admin center > App registrations > New registration**
   - Name: `Busy Light for Homebridge`
   - Supported account types: Accounts in this organizational directory only (single tenant)
   - Redirect URI: leave blank
2. **Authentication > Advanced settings**
   - Allow public client flows: **Yes** (the tool signs in with the device code flow)
3. **API permissions > Add a permission > Microsoft Graph > Delegated permissions**
   - `Presence.Read` (read my own presence)
   - `Calendars.Read` (read my own calendars)
   - `offline_access` (stay signed in)
4. If user consent is restricted in our tenant, select **Grant admin consent**. Otherwise I will consent for myself at first sign-in.

No client secret, certificate, or application (app-only) permission is needed.

## What I need back

1. Application (client) ID
2. Directory (tenant) ID

## Notes for review

- All permissions are delegated, so the tool can only see what my own account can see, and only mine.
- It requests data from `graph.microsoft.com` (`/me/presence` and `/me/calendarView`) and reads only each event's show-as value, start, end, and all-day/cancelled flags. It does not read subjects, bodies, or attendees.
- If a Conditional Access policy blocks the device code flow, I will need an exception for this app or my account.
- Access can be revoked at any time by deleting the app registration or revoking my sign-in sessions.
