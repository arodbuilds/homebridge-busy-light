# What to ask your Microsoft 365 administrator for

Busy Light needs an app registration in your organization's Microsoft 365 tenant before it can read your Teams status and Outlook calendar. If sign-in is refused, or you do not have the two IDs yet, copy everything below the line and send it to your IT department or Microsoft 365 administrator.

If the plugin's log named a reason, add it to your message. It tells them which step to look at:

| The log said | Step to check |
| --- | --- |
| the Directory (tenant) ID or Application (client) ID was not recognised | The two IDs under "What I need back" |
| the app registration does not allow public client flows | Step 2 |
| your organization has not approved the permissions | Steps 3 and 4 |
| your organization's sign-in policy blocked it | The Conditional Access note under "Notes for review" |
| that account does not belong to this organization | Step 1, supported account types |

---

**Subject: App registration request for a personal status light**

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
