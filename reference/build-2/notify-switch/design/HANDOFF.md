# Handoff: homebridge-notify-switch settings page

## Status (September 14, 2026)

This file is the shell contract for the Notify Switch settings page, and the file the Claude Design system syncs from. It is built around `BUILD-CONTRACT.md` (the 40 rules of the shared shell, exported from Plugin Settings Standard, Build contract tab, September 13, 2026): the plugin content below (page order, sections, fields, copy) is kept from the handoff of September 12, 2026, and the shell is stated as the numbered rules with their ids, so a ticket or a code review can cite them. The page runs on the same shell as the Peloton plugin (see `design_handoff_peloton/`); anything marked invariant is shared across all plugins and is implemented once, identically. Anything marked plugin content is filled in per plugin.

Every rule carries its status against the shipped settings UI, taken from `CONTRACT-AUDIT.md` (audited for 1.3.1): **implemented**, **implemented differently** (with how), or **not implemented**. A rule that nothing implements, in the design or in the plugin, is kept and marked **not yet designed or built**, never dropped; at 1.3.1 no rule of the contract is in that state (the one item in it is the saved status box of the page order, item 7, which is not a contract rule).

Decisions applied to the rule text in this revision, each settling a difference the audit recorded:

- S3 and F4: the summary box is in the page flow after Settings, not sticky.
- M1: the draft is cleared when the saved configuration matches the draft.
- M3: the button label is "Reset plugin to fresh install".
- M4: the blocking notice is in the warning tone, not red.
- W1: no emoji anywhere, including the country lists.
- C6: the result bar is toneless and holds a toned status box.
- C1 (header strip): "Make default for {channel}" appears only on providers that can be the default and are not currently the default.
- S1, T5 and W4 (1.3.2): the iframe document is never a scroll container (`html` and `body` use `overflow: hidden` with no fixed height; the host owns all scrolling); a summary-box entry focuses the named control itself without rebuilding the page; every "is required." message carries the field's own label.

## Overview

The Homebridge config UI (custom UI under `homebridge-ui/`) for **homebridge-notify-switch**, display name **Notify Switch**. The plugin adds switches to the Home app; turning one on (usually from an automation) sends a message through SMS, email, Telegram or ntfy, then the switch turns itself off. The page sets up **Providers** (services that send), **Recipient Groups** (who receives), **Switches** (what to send) and plugin-wide **Settings**.

## About the design file

`notify-switch-settings.html` is a **design reference built in HTML**: a single self-contained interactive prototype. It is not production code. Recreate it inside the plugin's custom UI (`homebridge-ui/public/index.html` + the `homebridge-plugin-ui-utils` API) using the host's Bootstrap variables, not by shipping this file. The review chrome above the modal (theme / width / fresh install toggles) is design tooling only.

Open the prototype in a browser and use the toolbar:
- **Dark theme**: host dark theme.
- **iPad width / Phone width / Modal width**: cycles 800 → 768 → 400 px.
- **Fresh install**: empty first run (Get started panel, gated sections, no draft bar).

## Fidelity

**High-fidelity for structure, copy, states and behaviour. Host-themed for colour and type.** Every colour is a Homebridge/Bootstrap variable (T1) so the page follows the host; the plugin owns no palette. Recreate spacing, type sizes, control heights, copy and states exactly. Hard-coded hex fallbacks in the prototype are the host's light-theme values.

## Page order (top to bottom)

The order is rule S3. Items 1, 3, 4, 5, 8 and 9 are plugin content (S0, S4, R1, S5); the rest is shell.

1. Plugin banner (S0): `assets/notify-switch-banner.png`, 2560 × 640, 4:1, full container width, 6 px radius, 16 px top margin, on the dark ground shared by every plugin's banner (#1d2d3d in the artwork; the prototype paints #16263a under the image, the shipped page paints nothing), carrying the mark, the name and one line saying what the plugin does. Alt: "Notify Switch: Homebridge switches that send SMS, email, Telegram, or ntfy messages when turned on." (Redrawn in 1.3.1 to name ntfy; the alt text used an em dash before, replaced under W1.)
2. Unsaved-changes bar (M1): "You have unsaved changes from earlier. Restore them?" RESTORE (primary, 31 px) / DISCARD. Never shown on a fresh install.
3. Intro paragraph one (S4): "Notify Switch adds switches to the Home app. Turn one on, usually from an automation, and it sends a message, then turns itself off."
4. Intro paragraph two (S4): "Set up in three steps: add a Provider (the service that sends), create a Recipient Group (who receives), then create a Switch (what to send). You only need one provider. Save, restart Homebridge, and add the switch to a HomeKit automation."
5. Sections (R1): **Providers**, **Recipient Groups**, **Switches**, **Settings**
6. "Fix these before saving:" summary box (F4), in the page flow after Settings while anything blocks Save. Not sticky.
7. Saved status box after Save: "Saved. Restart Homebridge to apply." **Not yet designed or built in the plugin, by decision**: the Homebridge UI gives a custom page no event when it saves (`@homebridge/plugin-ui-utils` 2.2.6 dispatches only `ready` and the plugin server's own events), so the page cannot know a Save happened; the host's own Save flow and restart prompt stand (SPEC section 11.2, item 28). Kept here so the shell's order is complete.
8. Closing paragraph: "After saving, restart Homebridge. Your switches appear in the Home app. Open Automations, choose a trigger such as a sensor detecting water, and add the switch with Turn On as the action. You can also test by tapping the switch directly."
9. Footer line (S5): 12.6 px muted, 1 px top rule: 20 px footer glyph (`assets/notify-switch-mark.svg`, currentColor, inlined) · "Notify Switch v{version}" · "Made by Alex Rodriguez" · alex-rodriguez.com · Report an issue.

Also at page level, only while it applies: the blocking notice of M4, directly under the banner, before the draft bar. The host draws the modal, title bar ("Notify Switch", ✕) and the CLOSE / SAVE footer (S1).

## Shell rules

The rule ids and owner tags are those of `BUILD-CONTRACT.md`. Rule text is the contract's, with the decisions above applied and the geometry the earlier handoff carried folded in where the rule needs it (`BUILD-CONTRACT-DEFINITIONS.md` holds the rest). The status line under each rule is the audit's; where a decision above resolves the difference the audit recorded, the line says so.

### S: the page every plugin renders

**S1 Host owns the frame** (invariant)
The page renders inside the Homebridge settings modal in an iframe: 800px dialog, host header with title and close, scrolling body, host footer with CLOSE and SAVE. The plugin never draws that chrome and never sets a page background. The host sizes the iframe to the page's own height and scrolls its modal body around it, so the page owns no scroll container. Host constraints: the iframe document is never a scroll container. `html` and `body` use `overflow: hidden` with no fixed height; the host owns all scrolling. (The host links its own stylesheet into the iframe, and that stylesheet sets `html, body { height: 100% }`; the page's rule is written on `:root` so it wins. The host sizes the iframe to `document.body.scrollHeight` plus 10px on every resize of the body, so a body that took its height from the iframe would make the host grow the iframe without end.)
Status: implemented (the host constraint from 1.3.2; `homebridge-ui/public/index.css`, the `:root` rule at the top).

**S2 Container padding** (invariant)
One root element with padding 0 16px 16px and overflow-wrap: anywhere. No negative margins, nothing wider than 100%.
Status: implemented.

**S0 Banner** (plugin content)
The first element of the page is the plugin banner: a 4:1 image (2560 × 640) at full container width, 6px radius, 16px top margin, carrying the mark, the plugin name and one line saying what the plugin does, on the same dark ground for every plugin. It replaces a page title, since the host header already names the plugin. It is served from the plugin's own folder by a relative path, never from another host. Notify Switch: page order, item 1.
Status: implemented. The first-half audit recorded it as implemented differently because the artwork still read "SMS, email, or Telegram"; the artwork was redrawn in the second half of 1.3.1 and names ntfy.

**S3 Order of the page** (invariant)
Banner, then the blocking notice while it applies (M4), then draft banner, then two intro paragraphs, then the sections in order, then the summary box in the page flow (F4, not sticky), then the closing "after saving" paragraph, then the footer line. Nothing else at page level.
Status: implemented. The audit's difference (the sticky box of 1.3.0) is settled by the decision on S3 and F4.

**S4 Intro** (plugin content)
Paragraph one: what the plugin adds to the Home app and what happens when it runs. Paragraph two: setup in N steps, then "Save, restart Homebridge, and add the switch to a HomeKit automation." Notify Switch: page order, items 3 and 4.
Status: implemented.

**S5 Footer line** (invariant)
Last element. The plugin's own 20px mark in currentColor (each plugin supplies its own; it is the same mark the banner carries), "{Plugin} v{version} · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue", secondary text at 12.6px, above a 1px rule, 24px above and 12px of padding, wrapping between items; the mark and the name stay together on one line. The version comes from the installed package.json, never a literal.
Status: implemented.

### R: sections

**R1 Any number of kinds, then Settings** (invariant)
A plugin declares as many "kinds of thing" sections as it needs, in dependency order (what you connect to, then what groups, then what acts), followed by Settings, followed by the closing paragraph. A settings-only plugin declares none. Notify Switch: Providers, Recipient Groups, Switches, Settings.
Status: implemented.

**R2 Section anatomy** (invariant)
h2 heading (20px, weight 300) with a 1px rule under it (4px padding below the text, 8px below the rule), one sentence of intro at 14.4px, the cards, then exactly one primary Add button (38px, the host primary fill, white uppercase 16px text, 4px radius). 24px above each section.
Status: implemented.

**R3 Gated sections** (invariant)
A section that depends on an earlier one shows its Add button outlined and disabled (cursor not-allowed, secondary text colour, transparent fill, full opacity) with the hint "Add a {dependency} first." beside it, never hidden. Notify Switch: Recipient Groups and Switches are gated on at least one provider, hint "Add a provider first."
Status: implemented.

**R4 Empty first section** (invariant)
With nothing configured, the first section shows a Get started card holding one sentence and the chooser tiles inline, in place of cards, with no Cancel; the section's Add button is hidden while it shows.
Status: implemented differently. The definitions' prompt is one line, "Get started. Choose how you want to begin, you can add more later."; the shipped card has the header "Get started" and the body line "Choose how you want to send messages. You can add more providers later."

**R5 Settings is uncarded** (invariant)
Settings renders its fields directly on the page in the same 12-column grid, with its own Advanced disclosure holding backups, restore and reset.
Status: implemented.

### C: one editor per thing the user cares about

**C1 Header** (invariant)
The header strip: the subtle fill, 8px 16px padding, 1px bottom rule. Left cluster: bold name (weight 700), live as typed, "New {noun}" while empty; then the type badge (badge fill, white 11.5px weight 600, 3px 7px padding, 4px radius; provider cards only); then status badges (same geometry on the success fill: "Default for {channel}"). Right cluster (12.6px links, 12px gap): the "Make default for {channel}" text button in the link colour, shown only on a provider that can be the default for that channel and is not currently the default; then the Show help / Hide help toggle in the secondary colour. The clusters align on their first baseline, so below 600px the badges wrap under the title while the right cluster stays on the first row.
Status: implemented differently. The contract text places "Make default" in the left cluster after the badges; the definitions (item 4), the prototype and the shipped page put it in the right cluster before the help toggle, and this rule states the right cluster. When it appears is settled by the decision above.

**C2 Body** (invariant)
Body padding 16px 16px 0. Fields top to bottom in a 12-column grid with 8px gaps and 16px between fields. Two short related fields share a row; everything else is full width. Below 600px every cell is full width.
Status: implemented.

**C3 Advanced disclosure** (invariant)
Last thing in the body: a disclosure link "▸ Advanced" closed and "▾ Advanced" open (12.6px, secondary colour) under the grid, opening a second 12-column grid. Holds the read-only ID with its Edit link and rarely used fields. Collapsed by default, opened automatically when anything inside it is set.
Status: implemented.

**C4 Footer** (invariant)
The footer strip: the subtle fill, 8px 16px, 1px top rule. Left: the red "Remove {noun}" text button, then "Duplicate {noun}" in link colour where allowed (groups, switches). Right: at most one outlined primary action, a 31px button in the link colour ("Test connection" on providers, "Test send" on switches; none on group cards). The primary side comes first in the markup and the row is reversed, so on a phone the primary action stays on the top line.
Status: implemented.

**C5 Destructive and long actions confirm in place** (invariant)
Remove, Test send and Reset replace their own button with the question, a confirm button and a text Cancel: "Remove {title}?" (or "Remove this {noun}?" while unnamed) with a red 31px REMOVE and a Cancel link. Escape cancels. Never a dialog, except Reset to fresh install (M3).
Status: implemented.

**C6 Results appear under the card** (invariant)
A test or connection result is a status box between the body and the footer with a Dismiss link. The result bar that holds it is toneless: a 12px 16px row with a 1px top rule that takes no space while empty; inside it the status box carries the tone of the result (success or failure) and the message or the per-recipient table, then the "Dismiss" link. One result per card; a new result replaces the old. Results never replace the page or open a dialog.
Status: implemented. The tones the definitions (item 8) left undefined are settled by the decision above.

### F: fields and validation

**F1 Field anatomy** (invariant)
Bold 14.4px label (weight 600) with a red asterisk when required, control in a 38px box with 6px radius and 11px side padding at 16px text, one sentence of help at 12.6px in the secondary colour, and an optional link at the end of the help named after the question it answers ("Where do I find this?").
Status: implemented.

Field types the sections below use, all on this anatomy:
- **text / number / time / password**: as above. Password gets an attached SHOW / HIDE button on the right (F5). Readonly fields show an "Edit" link at the label's right and a locked look (F6).
- **select**: same control; options listed per field below.
- **textarea**: 3 rows.
- **check**: 16px checkbox, label 14.4px, caption under the label.
- **list**: rule F7. Rows flagged `storedAs` show a green 12.6px "Stored as +15550101234" line under the input.
- **note**: caption-only row (12.6px secondary) with optional link.
- **block**: bold 14.4px sub-heading with a caption; groups the checks that follow.
- **step**: numbered panel (1px border, 6px radius, 12px padding): 24px numbered disc on the locked fill, bold label, caption, then child fields / actions.
- **action**: 31px outlined uppercase button with optional caption. **danger** action: red text button.
- **preview**: 14.4px text with a 3px left rule in the border colour.
- Optional trailing help link (`linkText`) renders in the link colour at the end of the caption.

**F2 Validate on blur, never on keystroke** (invariant)
A field validates when it loses focus (or when a select, checkbox or radio changes) and is marked only after the user has touched it. A newly added card holds its errors back until a field inside it is touched.
Status: implemented.

**F3 Both outcomes are shown** (invariant)
Invalid: red border, icon inside the control, and a 12.6px red message under the control that says what a good value looks like and where to get it. Valid: a small green check inside the control at the right, for required text fields.
Status: implemented.

**F4 Summary box gates Save** (invariant)
While anything blocks Save, a warning box sits in the page flow after the Settings section and before the closing paragraph, with no shadow: "Fix these before saving:" and one entry per problem, each reading "{Card name}: {message}" (uncarded Settings uses the section heading) and moving focus to the field. Past three entries it collapses to "N fields need attention" with Show all. SAVE is disabled (outlined, secondary text, not-allowed) while it is present. It takes the warning colours of the theme with the shell's #ffecb5 border.
Status: implemented differently, by decision. The contract's sticky box assumed a scroll container the iframe does not have (S1); the decision above makes the in-flow box the rule.

**F5 Credentials** (invariant)
Every secret is a password field with a SHOW toggle attached on the right, autocomplete new-password, and is never echoed anywhere else on the page or in a log. The draft of M1 holds no credential.
Status: implemented.

**F6 Locked and read-only** (invariant)
Read-only or preset-locked controls use the secondary background with inherited text, plus an Edit link on the label row when the user may unlock them.
Status: implemented.

**F7 Lists** (invariant)
Repeating values (addresses, topics, numbers) are rows of control plus a 31px REMOVE, with an outlined 31px "Add {thing}" under them, an empty line reading "None yet." and per-row validation below the row, never beside the input.
Status: implemented differently. The empty line reads "None yet." on the switch's extra recipient lists but "No phone numbers yet." (and so on per list) on the group card lists.

### T: colour, type and touch

**T1 The plugin owns no palette** (invariant)
Every colour is a host Bootstrap variable with a fallback that follows currentColor. The plugin re-declares only the variables it reads under the host dark-mode marker. No fixed greys, no plugin accent. The banner artwork is the one place the plugin carries colour: ground #1d2d3d, mark and name #f2f2f3, tagline #b5d9fd (measured in the PNG).
Status: implemented differently. Every colour the shell reads is a Bootstrap variable with a fallback, re-declared under the host's dark marker (the host never sets `data-bs-theme` inside the iframe). Fixed values remain for the hover and press washes on outlined buttons, the checked mail-provider segment, the modal backdrop, the white ground behind QR codes (needed for scanning), the dashed danger border of the SMS preview, white badge text, and the #ffecb5 warning border the definitions hard-code.

Token set (definitions, item 2; light → dark fallbacks):
- Page background `--ns-bg` #ffffff → #1c1c1c; text `--ns-text` #212529 → #ffffff
- Secondary text `--ns-secondary` rgba(33,37,41,.75) → rgba(222,226,230,.75)
- Rules `--ns-border` #dee2e6 → #495057; card border `--ns-cardborder` rgba(0,0,0,.176) → rgba(255,255,255,.15)
- Subtle strip `--ns-subtle` rgba(33,37,41,.03) → #262626; locked/disc `--ns-locked` #e9ecef → #343a40
- Link `--ns-link` #0d6efd → #6ea8fe; primary button `--ns-primary` #607d8b; danger #dc3545; success #198754; badge #6c757d
- Warning `--ns-warnbg` #fff3cd → #3a3524, `--ns-warntext` #664d03 → #ffe69c; warning border #ffecb5 in both themes

**T2 Type comes from the host** (invariant)
System stack; body 14.4px weight 300 line-height 1.5, labels 14.4px weight 600, help 12.6px weight 300 line-height 1.4, h2 20px weight 300, controls 16px, badges 11.5px weight 600, small buttons 13.5px uppercase. The plugin sets no font family and no type scale of its own. Controls 38px tall, 6px radius, 11px side padding; small buttons 31px, 4px radius; 16px card padding, 24px between sections, 12px inside panels, 8px grid gap, 16px under each field.
Status: implemented.

**T3 Semantic colour only** (invariant)
Link colour for links, text buttons and checked boxes; danger for Remove, Reset, required asterisks and errors; success for stored-as lines and valid checks; the host primary for the one Add button per section. Nothing else is coloured.
Status: implemented differently. The primary colour also fills the draft bar's Restore, the Test send "Send" confirm and "Use the selected provider", and rings the hovered chooser tile and the selected Telegram mode card.

**T4 Phone width** (invariant)
Below 600px every grid cell is full width, chooser tiles stack, segmented controls become a dropdown, card header badges wrap under the title while the link cluster stays on the first row, card footers wrap with the primary action on top, QR codes give way to Open / Copy / Share, and every button is at least 44px tall on touch.
Status: implemented.

**T5 Focus is visible** (invariant)
Keyboard focus is never removed. Summary-box entries move focus to the control of the field they name (the input, select, textarea or checkbox itself), opening a collapsed Advanced first when the field sits inside one, and rebuild nothing on the page in doing so, so the control that takes focus stays in the document and Tab moves on from it. A newly added card focuses its Name field.
Status: implemented differently. Focus is never removed; summary entries focus the named control itself without rebuilding the page, and the entry list is updated in place rather than rebuilt on a validation pass (from 1.3.2; before, the pass that runs when a field loses focus rebuilt the list under the pointer before the click landed, so the click went nowhere and focus was lost); a newly added card (Add group, Add switch, a chooser tile) does not focus its Name field, only Duplicate does.

### W: words

**W1 Voice** (invariant)
Second person, plain, present tense, sentence case. One sentence of help per field. No marketing, no exclamation marks, no em dashes, no emoji anywhere, including the country lists (a country is named with its calling code, "United States (+1)", never a flag). Notify Switch vocabulary: "switch" for the HomeKit accessory, "provider" for a sending service, "group" for a recipient list.
Status: implemented differently. No emoji, no exclamation marks; help is one sentence for most fields and two for some (SPEC section 11.3 allows two at most).

**W2 Examples** (invariant)
Help sentences introduce examples with "For example:"; placeholders use "e.g.". A select option carries its example in parentheses: "12-hour (5:15 PM)".
Status: implemented.

**W3 Links are named after the question** (invariant)
"Where do I find this?", "How do I register?", "Why not the Auth Token?", never "click here" or "docs".
Status: implemented.

**W4 Errors** (invariant)
Say what a good value looks like and where to get it. An empty required field reads "{Label} is required." with the field's own label verbatim ("Master switch name is required.", "Account SID is required."); a field labelled Name reads "Name is required.". The summary box entry carries the same text after the card's name. Duplicate name within a section (case-insensitive): "Another {noun} already uses this name."
Status: implemented (from 1.3.2). Format messages say what a good value looks like and where to get it, for a value that is filled in; every empty required field names itself from the one label table the sections render from (`FIELD_LABELS` in `homebridge-ui/src/copy.ts`).

**W5 Button labels** (invariant)
Sentence case in the source; the host renders them uppercase. Verb plus noun: Add provider, Test connection, Download backup.
Status: implemented.

### M: shared behaviour every plugin gets for free

**M1 Draft recovery** (invariant)
A change on the page stores a draft of the configuration's structure, without credentials. Reopening with a draft that differs from the saved configuration shows the banner "You have unsaved changes from earlier. Restore them?" with RESTORE and DISCARD directly under the plugin banner, above the intro. Restore loads the draft and takes each provider's credentials back from the saved configuration; Discard deletes it. The draft is cleared when the saved configuration matches the draft, and never on a fresh install.
Status: implemented differently, within what the host allows, and the difference is settled by the decision above: the host sends the page nothing at Close or Save, so the draft is written as the user works rather than at the moment of closing, and "cleared on Save" is met at the next open, when the saved configuration equals the draft.

**M2 Backups** (invariant)
Settings > Advanced holds Download backup, Download backup without credentials, and Restore from backup, with the note that the full backup contains credentials.
Status: implemented.

**M3 Reset to fresh install** (invariant)
A red text button in Settings > Advanced labelled "Reset plugin to fresh install", opening a dialog with three consequences, Download backup first, a "Type RESET to confirm." field and a red Confirm disabled until then.
Status: implemented differently in the audit; the difference (the label, which the contract wrote as "Reset to fresh install") is settled by the decision above, so the rule now matches the build.

**M4 Blocking notice** (invariant)
A stored configuration the editor cannot represent shows a notice in the warning tone (the colours of F4, `role="alert"`) at the top of the page, directly under the banner, and disables everything except the backups and Reset. Nothing is written back.
Status: implemented differently in the audit; the difference (the contract's red notice) is settled by the decision above, so the rule now matches the build.

**M5 Help toggle** (invariant)
One Show help / Hide help toggle per card, collapsing field help only; default is help shown. Counters, status lines and validation messages stay. The toggle and the Advanced disclosure persist while the page is open.
Status: implemented.

**M6 Setup stays on this page** (invariant)
No trip to config.json and no separate app. Anything the user needs (tokens, ids, links to the service) is reachable from the field that needs it.
Status: implemented.

## Providers

Intro: "A provider is the service that delivers your messages. Add only the ones you will use."
**Add provider** opens the chooser "Which service should send your messages?" with four tiles (auto-fit grid, min 150 px; single column on phone):
- Twilio: "SMS text messages, and email if you have a Twilio-authenticated domain."
- Email (SMTP): "Send from a mailbox you already have, such as Fastmail, Gmail, iCloud, or Outlook."
- Telegram: "Free messages through a bot you create. Best for family group chats."
- ntfy: "Free push notifications to the ntfy app. No account needed for public topics."
Cancel closes it. A new card starts empty and focuses Name.

Shared Name caption for every provider: "How this provider is listed when you set up a switch. For example: Twilio, Home Gmail, Family bot."
Shared Credentials File caption: "Optional. A JSON file, relative to the Homebridge storage directory, that holds this provider's secrets so they stay out of config.json." + link "Where do I find this?"

### Twilio (badge "Twilio", can be made default)
- Name (required, default "Twilio")
- Account SID (required). Caption "Copy from the Twilio Console home page. It starts with AC and is not a secret." + "Where do I find this?"
- API Key SID (required, placeholder "e.g. SK…"). Caption "Create a Standard key in the Twilio Console and paste its SID and secret. The secret is shown once." + link "Why not the Auth Token?"
- API Key Secret (password, required)
- SMS Senders (list, add label "Add sender number", placeholder "e.g. (555) 010-1234", stored-as line). Caption "Numbers you own in Twilio. Use Look up numbers to pick from your account."
- Note: "US numbers must be registered for A2P 10DLC or carriers will block messages." + link "How do I register?"
- Action "Look up numbers". Caption "Lists the phone numbers and Messaging Services on your Twilio account so you can pick instead of typing. Manual entry always works."
- Email From address (7 cols, placeholder "e.g. alerts@example.com"). Caption "Send email from this address through Twilio. Its domain must be verified in the Twilio Console under Email > Domains." + "Where do I find this?"
- Email From name (5 cols, placeholder "e.g. Home")
- Advanced: ID (readonly, 6 cols, "twilio"; caption "How switches refer to this provider in config.json."), Messaging Service SID (6 cols, placeholder "MG…"; caption "Optional. Use a Messaging Service instead of a specific number. Found at Console > Messaging > Services. Starts with MG."), Credentials File (12 cols, placeholder "e.g. notify-switch-twilio.json").
- Primary action: Test connection → result "Connected and signed in."

### ntfy (badge "ntfy", status "Default for ntfy")
- Name (required, default "ntfy")
- Note: "ntfy delivers to the ntfy app on your phone. Install the app, subscribe to a topic name of your choosing, and add that topic to a group. Anyone who knows the topic name can read it, so pick something unguessable or use an access token." + "Where do I find this?"
- Server (required, default "https://ntfy.sh"). Caption "Leave as ntfy.sh unless you run your own server."
- Authentication (select: None / Access token (recommended) / Username and password; default None). Caption for None: "No credentials. Works for public topics on ntfy.sh; anyone who guesses the topic name can publish to it too." + "Where do I find this?" (Token and username/password reveal their own fields in the real UI.)
- Advanced: ID (readonly, "ntfy"), Credentials File (placeholder "e.g. notify-switch-ntfy.json"), 6 cols each.
- Primary: Test connection.

### Email (SMTP) (badge "SMTP", status "Default for email")
- Name (required, default "Fastmail")
- Mail provider (select: Fastmail / Gmail / iCloud / Outlook.com / Yahoo / Zoho / Other). Caption "Pick your mail service to fill in the server settings. Choose Other for any other mail server."
- Host (readonly, 7 cols, "smtp.fastmail.com"), Port (readonly, 2 cols, "465"), Security (readonly select, 3 cols, SSL / STARTTLS / None). Caption "Filled in from the mail provider above. Click Edit to change them." Choosing Other unlocks them.
- Username (required, default "you@example.com"). Caption "Usually your full email address. For example: you@example.com."
- Password (password, required). Caption "Use an app password, not your login password. Most providers require it." + link "Where do I create one?"
- From address (required, 7 cols). Caption "The address messages come from. Your provider must allow sending from it. For example: alerts@example.com."
- From name (5 cols, default "Home"). Caption "Optional. Some providers replace this with your account's display name."
- Advanced: ID (readonly, "fastmail"), Credentials File (placeholder "e.g. notify-switch-fastmail.json").
- Primary: Test connection.

### Telegram (badge "Telegram")
- Name (required, default "Telegram")
- Step 1 "Create your bot". Caption "On your phone, scan this code with the camera to open BotFather in Telegram. On a computer with Telegram installed, click Open BotFather instead. Then, in the BotFather chat: send /newbot, choose a display name such as Home Alerts, choose a username ending in bot, and BotFather replies with a token." Children: action "Open BotFather"; Bot Token (password, required; caption "BotFather sends the token. It looks like 123456789:AAF… Treat it like a password." + "Where do I find this?"). The real UI shows a QR code beside the button.
- Step 2 "Choose how people receive messages". Delivery (select: Family group chat (recommended) / Individual chats). Caption "Everyone in the group gets every message. Nobody has to opt in individually."
- Step 3 "Add the bot to your group". Caption "Connect your bot in step 1 to get the links and QR codes." Empty until the token is verified.
- Step 4 "Find people and groups". Caption "Lists everyone who has opened the bot and every group it has been added to. Choose a recipient group, then add people to it." Children: Recipient group (select of existing groups), action "Find people and groups".
- Advanced: ID (readonly, "telegram"), Parse mode (select: Plain text / Markdown / HTML; caption "How Telegram reads the message. Plain text is the safest choice."), 6 cols each.
- Primary: Test connection.

## Recipient Groups (gated on a provider)

Intro: "A group is a list of people. Switches send to groups, so you enter each person once."
Card, no type badge. Fields:
- Name (required, default "Family - Garage"). Caption "Who is in this list. For example: Family, Neighbors, On-call."
- Phone numbers (SMS) (list, "Add phone number", placeholder "e.g. (555) 010-2345"). Caption "Stored with the country code from Settings."
- Email addresses (list, "Add email address", placeholder "e.g. sam@example.com")
- Telegram chat IDs (list, "Add chat ID"). Caption "Use Find people and groups on your Telegram provider. IDs are numbers, not usernames."
- ntfy topics (list, "Add topic"). Caption "Topic names as subscribed in the ntfy app. Letters, numbers, dashes and underscores."
- Advanced: ID (readonly, 6 cols, "family"; caption "How switches refer to this group in config.json.")
- Footer: Remove group, Duplicate group. No primary action. **Add group** adds a card directly (no chooser).

## Switches (gated on a provider)

Intro: "Each switch appears in the Home app. Turning it on sends your message to everyone in the groups you pick, on every channel they have, then the switch turns itself off."
Card, no type badge. Fields:
- Name (required, default "Door Open Notification", placeholder "e.g. Water Leak Alert"). Caption "Shown in the Home app. Letters, numbers, spaces, and apostrophes. For example: Water Leak Alert, Smoke Alarm."
- Enabled (check, on)
- Cooldown (seconds) (number, 6 cols, default 0). Caption "Minimum seconds between sends for this switch. 0 disables the cooldown."
- Failure Mode (select, 6 cols: Any / All / Off; default Any). Caption "Any: the sensor trips if any recipient fails. All: only if every recipient fails. Off: never trips; failures are still logged."
- Failure Sensor (check, off). Caption "Adds a sensor to this switch that HomeKit automations can watch. It opens when a message fails to send."
- Block "Recipients": "Everyone in the groups you tick gets the message on every channel they have an address for." One check per group, labelled "{Group}: 4 SMS, 4 email, 1 ntfy" (live counts).
- Block "Extra recipients": "People outside the groups above, entered under their channel." Lists (6 cols each): Phone numbers (SMS), Email addresses, ntfy topics.
- Block "Send by": "Untick a channel to skip it for this switch." Checks (4 cols each): "SMS (4 numbers)", "Email (4 addresses)", "ntfy (1 topic)" (live counts; a channel with no provider is omitted).
- Message (textarea, required, default "Did you forget something? As of {{time}} the garage door has remained open for more than 15 minutes."). Caption "Up to 160 plain characters. Emoji and special symbols are not allowed for SMS." + link "More about variables"
- Subject (default "Did you forget something?"). Caption "Used as the email subject and the ntfy title. Defaults to the switch name."
- Preview line: "Will send SMS via Twilio to 4 numbers, email via Fastmail to 4 addresses, ntfy via ntfy to 1 topic." (live)
- Advanced: ID (readonly, 12 cols, UUID; caption "Generated. HomeKit tracks the switch by this id, so you can rename it freely."); Customize message per channel (check; caption "Write a different message for each channel. Each starts as a copy of the shared message."); Email provider (select, 6 cols: Platform default (Fastmail) / Fastmail (SMTP) / Twilio; caption "For this switch only. The default for every switch is under Settings."); Priority (select, 6 cols: Min / Low / Default / High / Urgent; caption "How the app announces it. Urgent and high can break through Do Not Disturb; min shows no notification."); Hide recipients from each other (BCC) (check; caption "Recipients go in Bcc and your from address in To, so nobody sees the other addresses. A message to one recipient always uses To."); Tags (6 cols, placeholder "e.g. warning, house"; caption "Optional. Up to 8, separated by commas. Emoji short codes such as warning or house show as icons in the app.").
- Footer: Test send (→ "Sent. The switch turned on, then off again."), Remove switch, Duplicate switch.

## Settings

Intro: "Platform-wide options. The default country is used when a phone number is entered without a country code." Fields render uncarded on the page grid (R5).
- Name (required, 6 cols, default "Notify Switch"). Caption "Platform display name shown in the Homebridge logs."
- Default Country (select, 6 cols: United States (+1) / Canada (+1) / United Kingdom (+44) … full list in the real UI; names and calling codes only, no flags, W1). Caption "Phone numbers entered without a country code are treated as numbers from this country."
- Time format (select, 6 cols: 12-hour (5:15 PM) / 24-hour (17:15))
- Date format (select, 6 cols: Month/Day/Year (9/8/2026) / Day/Month/Year (8/9/2026) / Year-Month-Day (2026-09-08)). Caption "Used by {{time}}, {{date}} and {{datetime}} in messages."
- Show master switch (check, 6 cols, on). Caption "A single switch in the Home app that turns all notifications on or off. When it is off, no switch sends anything."
- Master switch name (6 cols, default "Notifications Enabled"). Caption "Letters, numbers, spaces, and apostrophes only. Must start and end with a letter or number."
- Default email provider (select, 6 cols: Fastmail (SMTP) / Twilio). Caption "Switches send email through this provider unless a switch says otherwise under Advanced."
- Debug logging (check, off). Caption "Verbose logging, including message bodies and full recipient addresses. Credentials are never logged, even with this on."

Advanced (collapsed; M2, M3):
- Note: "The full backup contains your provider credentials; store it like a password. The version without credentials is safe to share when asking for help."
- Actions (6 cols each): "Download backup", "Download backup without credentials"
- Restore from backup (file, placeholder "Choose a file"). Caption "Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled."
- Danger text button: "Reset plugin to fresh install"

## Assets (`assets/`)

- `notify-switch-banner.png` 4:1 page banner, 2560 × 640 (S0).
- `notify-switch-mark.svg` footer glyph, currentColor, render at 20 px; inline it so it follows the host theme (S5).

## Files

- `notify-switch-settings.html` self-contained interactive prototype (open directly in a browser).
- `BUILD-CONTRACT.md` the shell's 40 rules as exported; `BUILD-CONTRACT-DEFINITIONS.md` what the Template and Notify Switch tabs render for each item the contract references; `CONTRACT-AUDIT.md` the rule-by-rule comparison with the shipped page.
- Source of truth in the design project: `Plugin Settings Standard.dc.html` (Notify Switch tab). The Build contract tab is retired; this file is what the design system syncs from.
