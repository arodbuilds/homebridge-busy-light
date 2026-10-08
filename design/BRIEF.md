# homebridge-busy-light: design brief for Claude Design

Paste this whole file into a new Claude Design project bound to the **Homebridge Plugin Shell** design system. It asks for two things: the brand assets (Part 2) and the settings page screens (Part 3). Part 1 is the context for both.

Where a value is marked "decided" it is final. Everything else is yours to propose.

Global rules for everything you produce: no em dashes, no emoji, sentence case, US dates. This plugin is not affiliated with Apple, Google, Microsoft or LIFX. Never use their logos, product icons, wordmarks or brand colors (no Microsoft four-square, no Teams purple, no Google four-color, no Apple mark, no iCloud cloud, no LIFX mark).

---

## Part 1: What this plugin is

**Package:** `homebridge-busy-light` (decided). **Display name:** Busy Light (decided).

**One line:** Busy Light reads your calendars and your Microsoft Teams status and shows whether you are free on a light, so the people around you know before they knock.

**Who it is for:** someone who works from home or in an office with a door, already runs Homebridge, and wants a lamp outside the room (or on the desk) that turns red in a meeting and green when free, without touching anything.

**How it works, in three steps:**

1. It watches one or more sources: iCloud Calendar, Google Calendar, Microsoft 365 (Outlook calendar and Teams presence), and any calendar subscription URL.
2. It combines them into one status. Decided list, highest priority first:
   1. Out of office
   2. Do not disturb
   3. In a call
   4. In a meeting
   5. Busy
   6. Tentative
   7. Away
   8. Available
   9. Offline
3. It shows that status two ways:
   1. Directly on a LIFX bulb, in a color per status.
   2. As HomeKit sensors (one per status, plus three roll-ups: Available, Busy, Out of office) so a Home automation can set any other HomeKit light or scene.

**Default colors (decided, user editable):** Available green, In a meeting / In a call / Do not disturb red, Busy orange, Tentative and Away yellow, Out of office purple, Offline turns the light off.

**Family:** this is the fourth plugin in a set by the same author. The other three are Notify Switch, Peloton for Homebridge and Generac for Homebridge. All four share one settings page shell and one icon language, so learning one teaches the others. Busy Light must look like a sibling, not a new product line.

Reference repositories (branch `latest`):

1. https://github.com/arodbuilds/homebridge-notify-switch (the shell master: `design/HANDOFF.md`, `design/BUILD-CONTRACT.md`, `assets/`)
2. https://github.com/arodbuilds/homebridge-peloton (`assets/ICONS.md` is the model for the icon notes I need back)
3. https://github.com/arodbuilds/homebridge-generac (the most recent build: `design/prototype/`, `assets/`)

---

## Part 2: Brand assets

### 2.1 The mark

Draw it in the family's icon language:

1. 192 grid, artwork square (the Homebridge UI rounds the corners itself, so do not pre-round).
2. Line art at stroke 12, off-white mark `#F2F2F3` on a single flat field color. No gradients, no shadows, no glow effects.
3. Each sibling mark pairs outlined geometry with one small square element: Notify Switch is a wall switch with a solid square and three signal arcs, Peloton is a dumbbell whose bar is a switch track with a solid square, Generac is a generator panel with an outlined square. Carry that square through in some form.
4. Legible at 32 px.

Subject: a light that signals availability. Show me **three directions** before refining one. Starting ideas, none required: a door-side signal lamp, a bulb with a status square, a desk beacon, a calendar page with a lit square. Avoid a literal three-lamp traffic light and avoid the studio "ON AIR" sign.

One thing to solve: the product is about changing color, but the family mark is one color on one field. I would like to see at least one direction where the square element alone carries an accent color (as Generac's mark is orange on charcoal) and one that stays strictly two-tone.

### 2.2 The field color

Existing fields: Notify Switch steel navy `#16263A`, Peloton oxide red `#6E2220`, Generac charcoal `#26272A` with an orange `#E8862B` mark. Propose a fourth that is clearly distinct from all three and from the excluded brand colors. It should not be green or red, since those are the two colors the light itself shows most.

### 2.3 Files to hand back

Same set and naming as the siblings (decided):

| File | Use |
| --- | --- |
| `busy-light-dark.svg` | 192 x 192 tile as it ships (mark on field) |
| `busy-light-light.svg` | 192 x 192 light-ground variant |
| `busy-light-mark.svg` | Mark alone, `currentColor`, no field |
| `busy-light-footer.svg` | 24-grid line glyph at stroke 1.5, `currentColor`, for the settings page footer |
| `busy-light-512.png` | 512 x 512, npm and plugin listing |
| `busy-light-192.png` | 192 x 192, plugins list |
| `busy-light-banner.png` | 1280 x 320, settings page and README banner |
| `busy-light-social.png` | 1280 x 640, GitHub social preview |
| `ICONS.md` | Direction name, colors, geometry on the 192 grid, minimum size, in the format of Peloton's `assets/ICONS.md` |

Banner text (decided): title "Busy Light for Homebridge", tagline "Your calendar and Teams status on a light. Green when you are free, red when you are not."

---

## Part 3: Settings page screens

Use the Homebridge Plugin Shell as is: its tokens, card anatomy, section headings, fields, status boxes, disclosure, issues summary, draft bar and credit footer. No palette of its own; every color is a host variable. The one exception on this page is the status color swatches in section 3.4, which are user data, not chrome.

Shell invariants that matter most here: the iframe never scrolls, nothing is `position: fixed` or sticky, dialogs and confirmations are inline, validation runs on blur with "{Label} is required.", buttons are uppercase by `text-transform` only.

Show every screen in both host themes, at desktop width (800 px modal) and phone width (390 px).

### 3.1 Page anatomy, top to bottom (decided order)

1. Banner.
2. Intro: "Busy Light shows whether you are free on a light. It reads your calendars and, if you use Microsoft 365, your Teams status, then sets a color for each." Second line: "Add at least one calendar, then choose how the light is controlled."
3. Affiliation line, muted, directly under the intro: "Not affiliated with or endorsed by Apple, Google, Microsoft or LIFX."
4. **Right now** (3.2)
5. **Calendars** (3.3)
6. **Colors** (3.4)
7. **Lights** (3.5)
8. **Settings**, a single collapsed Advanced disclosure (3.6)
9. Closing line, then the credit footer: "Busy Light v{version} · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue".

### 3.2 Right now

A single read-only status row, not a card with actions. It answers "is this working?" at a glance.

Content: a color swatch, the status name, and one muted line saying why. Examples:

1. "In a meeting" with "Until 2:30 PM, from Work calendar"
2. "Available" with "Nothing on your calendars until 3:00 PM"
3. "Out of office" with "All day, from Family calendar"
4. "Do not disturb" with "From Teams"
5. Empty state: "Add a calendar to see your status here."
6. Problem state: "Status unknown. None of your calendars could be read." in the warning tone.

### 3.3 Calendars

Heading, one line of help ("Add every calendar that should count. Events from all of them are combined."), then one card per source, then an ADD CALENDAR button that opens the shell's chooser tiles with four choices (decided): iCloud, Google Calendar, Microsoft 365, Calendar URL.

Card header: name, a type badge, a status pill. Pills (decided copy): "Connected", "Sign-in needed", "Not reachable", "Checking". Muted subline: "Last checked 2 min ago".

Fields per type:

1. **iCloud**: Name; Apple ID email; App-specific password (password field, help link "Where do I find this?"); Calendars to include (checkbox list filled in after connecting, default all). Footer button: TEST CONNECTION.
2. **Google Calendar**: Name; Secret address in iCal format (password-style field with Show, help link "Where do I find this?"); Your Google email (optional, help: "Lets Busy Light ignore invitations you declined."). Footer button: TEST CONNECTION.
3. **Microsoft 365**: Name; Directory (tenant) ID; Application (client) ID; two checkboxes, "Use Teams status" and "Use Outlook calendar". Footer button: CONNECT. Connect replaces the card in place with a two-step code flow, modeled on Generac's connect flow: step 1 shows a short code in large monospace with COPY CODE and OPEN MICROSOFT SIGN-IN; step 2 reads "Waiting for you to finish signing in" and then flips the pill to Connected. Include a muted note above the fields: "Needs an app registration from your Microsoft 365 administrator." with a help link "What do I ask for?".
4. **Calendar URL**: Name; Address (help: "Any calendar link that starts with https:// or webcal://."). Footer button: TEST CONNECTION.

Show: all four card types collapsed with one of each pill, one of each type expanded, the chooser, the Microsoft code flow (both steps), and the first-run empty state.

### 3.4 Colors

Heading, one line of help ("The color the light shows for each status. Choose Off to turn the light off instead."), then one compact row per status in the priority order of Part 1. Not nine cards: one card or table holding nine rows.

Each row: status name, a color swatch that opens a color control, the hex value, and an Off toggle. A muted line under the list: "When more than one applies, the one highest in this list wins."

Rows for statuses that only Microsoft 365 can produce (Do not disturb, In a call, Busy, Away, Offline) carry a small muted badge "Teams only" when no Microsoft 365 source is connected.

A RESET COLORS text button under the list.

### 3.5 Lights

Two parts under one heading.

1. **LIFX bulb** card: checkbox "Set a LIFX bulb directly"; Bulb IP address; Brightness (percent); footer button TEST LIGHT, which cycles the bulb through the colors. Result box: "The bulb answered." or "No answer from that address. Check that the bulb is on the same network as Homebridge."
2. **Other HomeKit lights**: no card. A short explainer and a checklist. Text: "Busy Light cannot control other HomeKit lights itself. It adds sensors to the Home app, and an automation there sets the light." Then a checkbox list of sensors to create, with the three roll-ups first and ticked by default (Available, Busy, Out of office) and the nine individual statuses under a "Show all statuses" disclosure. Then a three-step example using the shell's Step component: "1. In the Home app, add an automation: A sensor detects something. 2. Choose Busy Light Busy, Detects occupancy. 3. Set your light to red."

### 3.6 Settings (collapsed Advanced)

In this order (decided): Name; Check status every (seconds); Reload calendars every (seconds); Ignore all-day events marked busy (checkbox); Out of office words (list field, default: Out of office, OOO, Vacation, PTO; help: "iCloud, Google and URL calendar events with one of these words in the title count as out of office."); Override switch (checkbox, help: "Adds a Do not disturb switch to the Home app that overrides your calendars while it is on."); Debug logging; Reset plugin to fresh install.

### 3.7 States to cover across the page

1. Fresh install (no calendars, Right now in its empty state, Colors at defaults).
2. Steady state: two calendars connected, LIFX on, three roll-up sensors.
3. One source in "Sign-in needed" with Right now still working from the others.
4. Validation: an empty required field and the issues summary.

---

## Part 4: What I need back

1. Three mark directions with a field color each, then the chosen one refined into the file set in 2.3 with `ICONS.md`.
2. The settings page prototype as a single self-contained HTML file with toggles for fresh install, host dark theme, phone width and validation states, the way the Peloton and Generac prototypes were exported.
3. A short handoff note listing any component you had to add that the shell does not already have (I expect the color row and the Right now status row), so it can be folded back into the shell.
