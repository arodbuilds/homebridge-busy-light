# Build contract

Exported from Plugin Settings Standard.dc.html, Build contract tab, September 13, 2026. This file is now the source; the tab is retired.

The rules below are the standard. Anything listed as an invariant is implemented once and reused unchanged by every plugin; anything listed as plugin content is filled in per plugin. Ids (S1, C3, …) are stable so a ticket or a code review can cite them. The Template tab is the reference implementation of every invariant; the Peloton tab is the same shell filled with different content.

Each rule carries its owner tag from the tab: invariant or plugin content.

## Shell. S: the page every plugin renders

**S1 Host owns the frame** (invariant)
The page renders inside the Homebridge settings modal in an iframe: 800px dialog, host header with title and close, scrolling body, host footer with CLOSE and SAVE. The plugin never draws that chrome and never sets a page background.

**S2 Container padding** (invariant)
One root element with padding 0 16px 16px and overflow-wrap: anywhere. No negative margins, nothing wider than 100%.

**S0 Banner** (plugin content)
The first element of the page is the plugin banner: a 4:1 image (2560 × 640) at full container width, carrying the mark, the plugin name and one line saying what the plugin does, on the same dark ground for every plugin. It replaces a page title, since the host header already names the plugin.

**S3 Order of the page** (invariant)
Banner, then draft banner, then two intro paragraphs, then the sections in order, then the sticky summary box, then the closing "after saving" paragraph, then the footer line. Nothing else at page level.

**S4 Intro** (plugin content)
Paragraph one: what the plugin adds to the Home app and what happens when it runs. Paragraph two: setup in N steps, then "Save, restart Homebridge, and add the switch to a HomeKit automation."

**S5 Footer line** (invariant)
Last element. The plugin's own 20px mark in currentColor (each plugin supplies its own; it is the same mark the banner carries), "{Plugin} v{version} · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue", secondary text, above a 1px rule, wrapping between items. The version comes from the installed package.json, never a literal.

## Rhythm. R: sections

**R1 Any number of kinds, then Settings** (invariant)
A plugin declares as many "kinds of thing" sections as it needs, in dependency order (what you connect to, then what groups, then what acts), followed by Settings, followed by the closing paragraph. A settings-only plugin declares none.

**R2 Section anatomy** (invariant)
h2 heading (20px, weight 300) with a 1px rule under it, one sentence of intro, the cards, then exactly one primary Add button. 24px above each section.

**R3 Gated sections** (invariant)
A section that depends on an earlier one shows its Add button outlined and disabled with the hint "Add a {dependency} first." beside it, never hidden.

**R4 Empty first section** (invariant)
With nothing configured, the first section shows a Get started card holding one sentence and the chooser tiles inline, in place of cards.

**R5 Settings is uncarded** (invariant)
Settings renders its fields directly on the page in the same 12-column grid, with its own Advanced disclosure holding backups, restore and reset.

## Card. C: one editor per thing the user cares about

**C1 Header** (invariant)
Left: bold name, live as typed, "New {noun}" while empty; then the type badge; then status badges; then a "Make default for {channel}" text button where the concept applies. Right: the Show help / Hide help toggle.

**C2 Body** (invariant)
Fields top to bottom in a 12-column grid with 8px gaps and 16px between fields. Two short related fields share a row; everything else is full width. Below 600px every cell is full width.

**C3 Advanced disclosure** (invariant)
Last thing in the body. Holds the read-only ID with its Edit link and rarely used fields. Collapsed by default, opened automatically when anything inside it is set.

**C4 Footer** (invariant)
Grey strip. Left: the red "Remove {noun}" text button, then "Duplicate {noun}" in link colour. Right: at most one outlined primary action. The primary side comes first in the markup and the row is reversed, so on a phone the primary action stays on the top line.

**C5 Destructive and long actions confirm in place** (invariant)
Remove, Test send and Reset replace their own button with the question, a confirm button and a text Cancel. Escape cancels. Never a dialog, except Reset to fresh install.

**C6 Results appear under the card** (invariant)
A test or connection result is a status box between the body and the footer with a Dismiss link. Results never replace the page or open a dialog.

## Field. F: fields and validation

**F1 Field anatomy** (invariant)
Bold 14.4px label with a red asterisk when required, control in a 38px box with 6px radius at 16px text, one sentence of help at 12.6px in the secondary colour, and an optional link at the end of the help named after the question it answers ("Where do I find this?").

**F2 Validate on blur, never on keystroke** (invariant)
A field validates when it loses focus and is marked only after the user has touched it. A newly added card holds its errors back until a field inside it is touched.

**F3 Both outcomes are shown** (invariant)
Invalid: red border, icon inside the control, and a message that says what a good value looks like and where to get it. Valid: a small green check inside the control.

**F4 Summary box gates Save** (invariant)
While anything blocks Save, a sticky warning box sits above the footer: "Fix these before saving:" and one entry per problem, each reading "{Card name}: {message}" and linking to the field. Past three entries it collapses to "N fields need attention" with Show all. SAVE is disabled while it is present.

**F5 Credentials** (invariant)
Every secret is a password field with a SHOW toggle attached on the right, autocomplete new-password, and is never echoed anywhere else on the page or in a log.

**F6 Locked and read-only** (invariant)
Read-only or preset-locked controls use the secondary background with inherited text, plus an Edit link on the label row when the user may unlock them.

**F7 Lists** (invariant)
Repeating values (addresses, topics, numbers) are rows of control plus REMOVE, with an outlined "Add {thing}" under them, an empty line reading "None yet." and per-row validation below the row, never beside the input.

## Theme. T: colour, type and touch

**T1 The plugin owns no palette** (invariant)
Every colour is a host Bootstrap variable with a fallback that follows currentColor. The plugin re-declares only the variables it reads under the host dark-mode marker. No fixed greys, no plugin accent.

**T2 Type comes from the host** (invariant)
System stack; body 14.4px weight 300 line-height 1.5, labels 14.4px weight 600, help 12.6px weight 300, h2 20px weight 300, controls 16px. The plugin sets no font family and no type scale of its own.

**T3 Semantic colour only** (invariant)
Link colour for links, text buttons and checked boxes; danger for Remove, Reset, required asterisks and errors; success for stored-as lines and valid checks; the host primary for the one Add button per section. Nothing else is coloured.

**T4 Phone width** (invariant)
Below 600px every grid cell is full width, segmented controls become a dropdown, card footers wrap with the primary action on top, QR codes give way to Open / Copy / Share, and every button is at least 44px tall on touch.

**T5 Focus is visible** (invariant)
Keyboard focus is never removed. Summary-box entries move focus to the field they name, and a newly added card focuses its Name field.

## Copy. W: words

**W1 Voice** (invariant)
Second person, plain, present tense. One sentence of help per field. No marketing, no exclamation marks, no emoji outside a country flag in a country list.

**W2 Examples** (invariant)
Help sentences introduce examples with "For example:"; placeholders use "e.g.". A select option carries its example in parentheses: "12-hour (5:15 PM)".

**W3 Links are named after the question** (invariant)
"Where do I find this?", "How do I register?", "Why not the Auth Token?", never "click here" or "docs".

**W4 Errors** (invariant)
Say what a good value looks like and where to get it. "Name is required." is acceptable only where the value is self-evident.

**W5 Button labels** (invariant)
Sentence case in the source; the host renders them uppercase. Verb plus noun: Add provider, Test connection, Download backup.

## Machinery. M: shared behaviour every plugin gets for free

**M1 Draft recovery** (invariant)
Closing with unsaved changes stores a draft. Reopening shows the banner "You have unsaved changes from earlier. Restore them?" with RESTORE and DISCARD directly under the plugin banner, above the intro.

**M2 Backups** (invariant)
Settings > Advanced holds Download backup, Download backup without credentials, and Restore from backup, with the note that the full backup contains credentials.

**M3 Reset to fresh install** (invariant)
A red text button in Settings > Advanced opening a dialog with three consequences, Download backup first, a "Type RESET to confirm." field and a red Confirm.

**M4 Blocking notice** (invariant)
A stored configuration the editor cannot represent shows a red notice at the top of the page and disables everything except the backups and Reset. Nothing is written back.

**M5 Help toggle** (invariant)
One Show help / Hide help toggle per card, collapsing field help only. Counters, status lines and validation messages stay.

**M6 Setup stays on this page** (invariant)
No trip to config.json and no separate app. Anything the user needs (tokens, ids, links to the service) is reachable from the field that needs it.

## Format edits made in this export

Rule text is verbatim except for the em dash rule you set. Four em dashes were replaced; nothing else changed:

- Group titles: "S — The page…" and the six others became "S: the page…" in the headings above.
- S0: "It replaces a page title — the host header already names the plugin." became "It replaces a page title, since the host header already names the plugin."
- W3: "…"Why not the Auth Token?" — never "click here"…" became "…"Why not the Auth Token?", never "click here"…".
- M6: "Anything the user needs — tokens, ids, links to the service — is reachable…" became "Anything the user needs (tokens, ids, links to the service) is reachable…".

The tab also lists S0 after S1 and S2. That order is kept.

## Referenced but not defined in this tab

Pull these from the tab named before archiving.

- S0, S5: the banner artwork and the 20px plugin mark. Geometry and files are per plugin (Notify Switch tab, Peloton tab, their handoff assets folders).
- S1, T1: the host Bootstrap variable names and the host dark-mode marker. Named only in the Template, Notify Switch and Peloton prototypes.
- R4: the Get started card and the chooser tiles. Layout and copy live in the Template tab only.
- C1: the type badge and status badges (geometry, colours, which statuses exist), and the "Make default for {channel}" concept. Channel and default are Notify Switch tab concepts.
- C3: the read-only ID format and how Edit unlocks it. Template and Notify Switch tabs.
- C4: "Grey strip" names no token. The strip colour is defined in the Template tab (subtle host fill), and T1 forbids fixed greys, so the two need reconciling.
- C5: Test send. Notify Switch tab only.
- C6: the status box (geometry, tones, Dismiss placement). Template and Notify Switch tabs.
- F3: the invalid icon inside the control is not named or drawn here. Template tab.
- F4: "above the footer" means the host footer (S1), and the sticky behaviour depends on a host viewport the iframe does not have. See the Peloton handoff conflict list.
- F6: presets and preset locking. Notify Switch tab.
- T3: stored-as lines. Notify Switch tab.
- T4: segmented controls, QR codes and the Open / Copy / Share fallback. Notify Switch tab.
- M2: the exact wording of the credentials note. Template tab.
- M3: the three consequences and the dialog copy. Template tab.
- M4: the blocking notice copy. Template tab.
