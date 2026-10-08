# Build contract definitions

Exported from Plugin Settings Standard.dc.html, Template and Notify Switch tabs, September 13, 2026. Companion to BUILD-CONTRACT.md: one entry per item in its "Referenced but not defined in this tab" list, in the same order.

Neither tab carries prose rules. Each definition below is what the tab actually renders, copied from its markup and the data that drives it: copy strings verbatim, geometry as the inline style values, states as the tab implements them. Where the contract names something the tabs do not render at all, the entry says so under "Gap" rather than inventing a definition. Colours are given as the variable name the tab reads plus its light and dark fallback (see item 2).

## 1. S0, S5: banner artwork and the 20px plugin mark

From: Template tab (placeholder), Notify Switch tab (artwork).

Banner geometry (both tabs): display block, width 100%, aspect ratio 4 / 1, margin top 16px, border radius 6px, background image centred, cover, no repeat, `role="img"` with the alt text below.

Template tab renders a dashed placeholder instead of artwork: 1px dashed `--ns-border`, 6px radius, 12.6px secondary text, centred, reading "Plugin banner · 2560 × 640 (4:1) · mark, plugin name, one line saying what it does".

Notify Switch tab: background colour #16263a under `assets/notify-switch-banner.png`. Alt: "Notify Switch: Homebridge switches that send SMS, email, Telegram, or ntfy messages when turned on."

Footer line (both tabs): margin top 24px, padding top 12px, 1px top rule `--ns-border`, 12.6px weight 300 line height 1.5, `--ns-secondary`. The mark and the name sit in an inline flex span, gap 5px, `white-space: nowrap`; then " · Made by Alex Rodriguez · ", a link "alex-rodriguez.com", " · ", a link "Report an issue". Links in `--ns-link`.

Footer mark, Template tab: a 20 × 20 SVG on a 20 grid, a 17 × 17 square at (1.5, 1.5), no fill, `stroke="currentColor"`, stroke width 1.2, dash array 3 2 (a placeholder for the plugin's mark).

Footer mark, Notify Switch tab: a 20 × 20 SVG on a 192 grid, all `currentColor`: a 76 × 112 rectangle outline at (18, 40) with stroke width 12; a filled 36 × 36 square at (38, 60); three arcs to the right (radii 44, 62, 80, centred on the rectangle's midline) with stroke width 13, round caps. Also shipped as `design_handoff_notify_switch/assets/notify-switch-mark.svg`.

Footer name text: Template "{Plugin} v{version}" (or the pluginName tweak plus " v{version}"); Notify Switch "Notify Switch v1.2.0".

## 2. S1, T1: host Bootstrap variable names and the dark-mode marker

From: Template tab (the same set drives every tab).

The tab does not read Bootstrap's own variable names. It reads a plugin-side set of `--ns-*` variables with a fallback on every use, and a review toggle swaps the whole set. The two sets, verbatim:

Light: `--ns-bg:#ffffff; --ns-text:#212529; --ns-secondary:rgba(33,37,41,0.75); --ns-border:#dee2e6; --ns-cardborder:rgba(0,0,0,0.176); --ns-subtle:rgba(33,37,41,0.03); --ns-link:#0d6efd; --ns-inputbg:#ffffff; --ns-inputtext:#212529; --ns-inputborder:#dee2e6; --ns-locked:#e9ecef; --ns-primary:#607d8b; --ns-danger:#dc3545; --ns-success:#198754; --ns-badge:#6c757d; --ns-warnbg:#fff3cd; --ns-warntext:#664d03`

Dark: `--ns-bg:#1c1c1c; --ns-text:#ffffff; --ns-secondary:rgba(222,226,230,0.75); --ns-border:#495057; --ns-cardborder:rgba(255,255,255,0.15); --ns-subtle:#262626; --ns-link:#6ea8fe; --ns-inputbg:#ffffff; --ns-inputtext:#212529; --ns-inputborder:#495057; --ns-locked:#343a40; --ns-primary:#607d8b; --ns-danger:#dc3545; --ns-success:#198754; --ns-badge:#6c757d; --ns-warnbg:#3a3524; --ns-warntext:#ffe69c`

Two values are hard coded outside the set: the warning border #ffecb5 (summary box, reconnect banner, warning badge) and the host stand-in CLOSE button #212529.

Gap: the tab names no host dark-mode marker and no mapping from `--ns-*` to the host's Bootstrap variables. T1's "host Bootstrap variable" and "host dark-mode marker" are not defined anywhere in the file.

## 3. R4: Get started card and chooser tiles

From: Template tab (Notify Switch tab uses the same rendering with its own tiles).

Get started: shown when the first section has tiles and no cards. The chooser renders inside a frame: margin top 12px, padding 16px, 1px `--ns-cardborder`, 6px radius. Prompt (weight 600, 8px below): "Get started. Choose how you want to begin, you can add more later." No Cancel button. The section's Add button is hidden while it shows.

Chooser (opened by Add in a populated section): margin top 12px, no frame. Prompt is the section's own: Template "Which {kind one} should this use?"; Notify Switch "Which service should send your messages?". A "Cancel" button below the tiles: margin top 12px, 31px tall, 0 10px padding, 1px `--ns-border`, 4px radius, transparent, 13.5px uppercase, letter spacing 0.02em.

Tiles: grid `repeat(auto-fit, minmax(150px, 1fr))`, gap 12px, width 100%; below 600px `minmax(100%, 1fr)`. Each tile is a button: text left, padding 12px, 1px `--ns-border`, 6px radius, transparent, inherited colour, `min-width: 0`. Inside: the name at 14.4px weight 600 with 4px below, then the description at 12.6px weight 300 line height 1.4 `--ns-secondary`. Picking a tile adds a card of that kind (with its badge) and closes the chooser.

Template tiles: "{Type A}", "{Type B}", "{Type C}", each described "One sentence on when to pick this one."

Notify Switch tiles:
- "Twilio": "SMS text messages, and email if you have a Twilio-authenticated domain."
- "Email (SMTP)": "Send from a mailbox you already have, such as Fastmail, Gmail, iCloud, or Outlook."
- "Telegram": "Free messages through a bot you create. Best for family group chats."
- "ntfy": "Free push notifications to the ntfy app. No account needed for public topics."

Sections without tiles (Template kind two and kind three, Notify Switch groups and switches) add a card directly.

## 4. C1: type badge, status badges and "Make default for {channel}"

From: Template tab (geometry), Notify Switch tab (values).

Type badge: padding 3px 7px, 4px radius, `--ns-badge` fill, white text, 11.5px weight 600, `text-transform: none`. Text is the tile name chosen in the chooser. Template: "{Type}". Notify Switch providers: "Twilio", "ntfy", "SMTP", "Telegram". Group and switch cards have no type badge.

Status badge: same geometry, `--ns-success` fill, white text. Values in the tab: "Default for ntfy" (ntfy card), "Default for email" (SMTP card). One status string per card; no other statuses are rendered on Template or Notify Switch cards. (Outlined and warning badges exist only on the Peloton tab.)

Make default: a text button in the header's right cluster, before the help toggle: no border, transparent, 12.6px, `--ns-link`, `white-space: nowrap`. Label is the literal string "Make default for {channel}" on both tabs. Shown on cards flagged `canDefault`: the Template example card and the Notify Switch Twilio card. Clicking it does nothing in the tab.

Gap: neither tab defines "channel" or how the default moves. The only channel vocabulary in the file is on the Notify Switch card: the "Send by" block, "Untick a channel to skip it for this switch.", with checks "SMS (4 numbers)", "Email (4 addresses)", "ntfy (1 topic)"; and Settings "Default email provider" with help "Switches send email through this provider unless a switch says otherwise under Advanced."

## 5. C3: read-only ID format and Edit unlock

From: Template tab, Notify Switch tab.

Rendering: first row of the Advanced grid. Label row is a flex with `justify-content: space-between`, baseline aligned, gap 8px: the label "ID" (14.4px weight 600) and an "Edit" text button (12.6px, `--ns-link`, no border, transparent). Control: a text input with `readOnly`, 38px, 6px radius, 0 11px padding, 16px, `--ns-locked` background, `--ns-inputtext` text, 1px `--ns-inputborder`. Help at 12.6px `--ns-secondary` under it.

Values and help, verbatim:
- Template kind one: "example-item", span 6. "How config.json refers to this item."
- Template kind two: "new-group", span 6. "How config.json refers to this group."
- Template kind three: "generated", span 6. "HomeKit tracks the switch by this id, so you can rename it freely."
- Notify Switch providers: "twilio", "ntfy", "fastmail", "telegram", span 6. "How switches refer to this provider in config.json."
- Notify Switch group: "family", span 6. "How switches refer to this group in config.json."
- Notify Switch switch: "4dcfbd87-0a5f-4999-9bb1-0d60d1010bae", span 12. "Generated. HomeKit tracks the switch by this id, so you can rename it freely."

Gap: Edit is not wired; the tab defines no unlock behaviour, no validation for edited IDs and no message.

## 6. C4: the grey strip

From: Template tab.

Header strip: flex, `align-items: flex-start`, gap 8px 12px, padding 8px 16px, background `--ns-subtle`, border bottom 1px `--ns-cardborder`. Footer strip: flex, `flex-direction: row-reverse`, wrap, centred, gap 8px, padding 8px 16px, background `--ns-subtle`, border top 1px `--ns-cardborder`. `--ns-subtle` is rgba(33,37,41,0.03) light and #262626 dark. "Grey" in C4 is this variable; the tab hard codes no grey.

## 7. C5: Test send

From: Template tab (kind three card), Notify Switch tab (switch card).

The footer's outlined primary action: 31px tall, 0 10px padding, 1px `--ns-link`, 4px radius, transparent, `--ns-link` text, 13.5px uppercase, letter spacing 0.02em. Label "Test send" on Template kind three and Notify Switch switches; "Test connection" on Template kind one and every Notify Switch provider.

Click writes a result into the status box (item 8): "Test connection" gives "Connected and signed in."; anything else gives "Sent. The switch turned on, then off again."

In-place confirmation as the tab implements it exists for Remove only: the left cluster swaps to the question "Remove {card title}?" at 12.6px, a red "Remove" button (31px, `--ns-danger` fill and border, white, uppercase) and a "Cancel" text button in `--ns-link`.

Gap: Test send does not confirm in place in either tab, and nothing is wired to Escape. C5's "Test send and Reset replace their own button with the question" is not rendered.

## 8. C6: the status box

From: Template tab.

Sits between the card body and the footer strip, inside the card frame: padding 12px 16px, border top 1px `--ns-cardborder`, 14.4px, flex with gap 12px and baseline alignment. The message on the left (`margin-right: auto`), then a "Dismiss" text button at 12.6px in `--ns-link`. Dismiss clears the result. One result per card; a new result replaces the old.

Gap: the tab gives the box no tone (no success or failure colour, no border colour change) and no behaviour on collapse.

## 9. F3: the invalid icon

From: Template tab.

Invalid rendering: the control's border switches to `--ns-danger`; a message at 12.6px line height 1.4 in `--ns-danger` sits 4px under the control (or under the help). Valid rendering: a "✓" text glyph, absolute at right 11px top 8px inside the control's wrapper, `--ns-success`, 15px; shown only for required non-check fields that have been touched, have no error and are not empty.

Gap: no icon is rendered inside the control for the invalid state. F3's "icon inside the control" for invalid is not defined.

## 10. F4: "above the footer" and sticky

From: Template tab.

Style, verbatim: `position: sticky; bottom: 8px; z-index: 5; margin-top: 16px; padding: 10px 12px; border: 1px solid #ffecb5; border-radius: 6px; background: --ns-warnbg; color: --ns-warntext; box-shadow: 0 4px 12px rgba(0,0,0,0.15)`. Title "Fix these before saving:" at weight 600 with 4px below; then a list (`padding-left: 20px`) of one entry per problem, each a text button with inherited font and colour, underlined: the card title in bold followed by ":" then the message. Clicking an entry focuses the field by id. The Save button in the host footer is disabled while the box shows (outlined `--ns-border`, `--ns-secondary` text, `cursor: not-allowed`).

"Above the footer": the box sticks to the bottom of the host body, which the tab renders as a scroll area (`max-height: 640px; overflow-y: auto`) sitting above the host footer row.

Entry names: framed cards use the card title; uncarded Settings and Polling use the section heading.

Gap: the collapse past three entries to "N fields need attention" with Show all is not rendered.

## 11. F6: presets and preset locking

From: Notify Switch tab (SMTP card).

- "Mail provider" (select, span 12, default "Fastmail", options Fastmail, Gmail, iCloud, Outlook.com, Yahoo, Zoho, Other). Help: "Pick your mail service to fill in the server settings. Choose Other for any other mail server."
- "Host" (text, readonly, span 7, "smtp.fastmail.com")
- "Port" (text, readonly, span 2, "465")
- "Security" (select, readonly, span 3, "SSL", options SSL, STARTTLS, None). Help: "Filled in from the mail provider above. Click Edit to change them."

Locked rendering is the item 5 control: `--ns-locked` background, `--ns-inputtext` text, `readOnly`, with the "Edit" text button on the label row.

Gap: changing Mail provider does not refill the fields and Edit does not unlock them in the tab. No preset table for the other six providers is in the file.

## 12. T3: stored-as lines

From: Notify Switch tab (Twilio card, "SMS Senders" list).

A list field flagged `storedAs` shows, under any row whose value has ten or more digits, a line at 12.6px weight 300, margin -4px 0 8px, `--ns-success`, reading "Stored as +1" followed by the last ten digits. Sample row "(555) 010-1234" renders "Stored as +15550101234". The line appears whether help is shown or hidden.

## 13. T4: segmented controls, QR codes and Open / Copy / Share

From: Notify Switch tab.

What the tab renders below 600px: every grid cell spans 12 columns; chooser tiles go to one column; the card footer is `row-reverse` with wrap, so the primary action stays on the top line.

QR codes are mentioned in copy only, on the Telegram card: step 1 help "On your phone, scan this code with the camera to open BotFather in Telegram. On a computer with Telegram installed, click Open BotFather instead. Then, in the BotFather chat: send /newbot, choose a display name such as Home Alerts, choose a username ending in bot, and BotFather replies with a token." and step 3 help "Connect your bot in step 1 to get the links and QR codes."

Gap: no segmented control, no QR image and no Open / Copy / Share buttons are rendered in any tab. T4's fallbacks are undefined in the file.

## 14. M2: credentials note

From: Notify Switch tab (Settings > Advanced). The Template tab's Advanced holds only Restore.

In order, all in the Advanced grid:
- Note (span 12, 12.6px `--ns-secondary`): "The full backup contains your provider credentials; store it like a password. The version without credentials is safe to share when asking for help."
- "Download backup" (action, span 6): 31px, 0 10px, 1px `--ns-border`, 4px radius, transparent, 13.5px uppercase.
- "Download backup without credentials" (action, span 6): same.
- "Restore from backup" (text, span 12, placeholder "Choose a file"). Help: "Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled."
- "Reset plugin to fresh install" (item 15).

Template tab Advanced: "Restore from backup" only (text, placeholder "Choose a file"). Help: "Replaces everything on this page with the contents of the backup."

Gap: M2 calls these shell invariants, but the Template tab (the stated reference implementation) omits the two Download actions and the note.

## 15. M3: Reset dialog

From: Notify Switch tab (Settings > Advanced, last row).

Rendered as a text button: no border, transparent, 14.4px, `--ns-danger`, label "Reset plugin to fresh install". Clicking it does nothing in the tab.

Gap: no dialog, no three consequences, no "Download backup first", no "Type RESET to confirm." field and no Confirm button exist in the file. M3's dialog is undefined. The label also differs from M3's "Reset to fresh install".

## 16. M4: blocking notice

From: none.

Gap: neither the Template nor the Notify Switch tab renders a blocking notice, disables the page, or carries copy for it. M4 is undefined in the file. The nearest rendered element is the Peloton tab's non-blocking reconnect banner: margin 12px 0 0, padding 8px 12px, 1px #ffecb5, 6px radius, `--ns-warnbg`, `--ns-warntext`, "1 account needs to be reconnected. Everything else is saved."

## Format edits

Substitutions made for the rules you set; nothing else in a quoted string changed.

- Get started prompt: "Get started. Choose how you want to begin — you can add more later." became "Get started. Choose how you want to begin, you can add more later." (em dash).
- Notify Switch banner alt: "Notify Switch — Homebridge switches that send SMS, email, Telegram, or ntfy messages when turned on." became "Notify Switch: Homebridge switches ..." (em dash).
- CSS values are quoted as the tab writes them but with the `var(--ns-x, fallback)` wrapper removed; the fallbacks are listed once in item 2.
- The switch ID sample in item 5 is a hex UUID in the tab and is copied verbatim; it breaks the letters-not-hex rule from the Peloton export and should be replaced at the source.
- Middle dots (·) and the multiplication sign (×) in the Template banner placeholder are the tab's own characters, kept.

## Followed one level

- Item 4 (Make default) points at "channel"; the only channel copy in the file is quoted in item 4.
- Item 7 (Test send) writes into the status box; item 8.
- Item 11 (preset locking) uses the locked control and Edit link; item 5.
- Item 13 (QR codes) is mentioned only in the Telegram step copy; quoted in item 13.
- Item 14 (backups) ends with the Reset button; item 15.
- Item 16 (blocking notice) references the backups and Reset it would leave enabled; items 14 and 15.

## Summary of gaps

Contract rules that the tabs do not render, so the contract is the only definition: T1 host variable mapping and dark marker (2), C1 channel and default behaviour (4), C3 Edit unlock (5), C5 Test send confirm and Escape (7), C6 tones (8), F3 invalid icon (9), F4 collapse past three (10), F6 preset refill and unlock (11), T4 segmented control, QR and Open / Copy / Share (13), M2 backups on the Template tab (14), M3 dialog (15), M4 entirely (16).
