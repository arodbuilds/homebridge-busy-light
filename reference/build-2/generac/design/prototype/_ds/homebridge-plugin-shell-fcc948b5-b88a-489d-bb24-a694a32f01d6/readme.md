# Homebridge Plugin Shell

The shared settings-page shell used by Alex Rodriguez's Homebridge plugins (Notify Switch, Peloton). A plugin's custom config UI runs in an iframe inside the Homebridge UI settings modal; the host supplies Bootstrap 5, its theme and the modal chrome (title bar, CLOSE / SAVE). The plugin owns structure, copy, states and behaviour, but **no palette**: every colour is a host variable with the host's light/dark values as fallbacks. The one place the plugin carries colour is its banner artwork.

**Product represented:** Notify Switch (`homebridge-notify-switch`, display name "Notify Switch", v1.3.2). Switches in the Home app that send SMS, email, Telegram or ntfy messages when turned on, then turn themselves off. The settings page sets up Providers, Recipient Groups, Switches and Settings.

## Getting started
1. Keep **Published** ticked so your team can pick this system for new projects.
2. **Set as org default** once the shell is stable; new projects then attach it automatically.
3. **New design** opens a project bound to this system. Ask for a screen; the Plugin settings page template is a starting point.
4. Edit tokens, components and rules here; consuming projects pick them up.

## Sources
- GitHub: https://github.com/arodbuilds/homebridge-notify-switch (branch `latest`). Key files: `design/HANDOFF.md` (the shell spec: page order, card anatomy, field types, tokens), `homebridge-ui/public/index.css` (shell CSS), `homebridge-ui/src/copy.ts` (all in-app copy), `homebridge-ui/src/dom.ts` and `card.ts` (field/card builders), `assets/`.
- Related: https://github.com/arodbuilds/homebridge-peloton (shares the shell; not read).
- The design master lives in a Claude Design project as `Plugin Settings Standard.dc.html`; `design/notify-switch-settings.html` in the repo is its exported prototype.

Explore the repository to build better against this product; `SPEC.md` section 11.2 item 28 defines the shell invariants.

## Content fundamentals
- Sentence case everywhere except uppercase button labels (ADD PROVIDER, SHOW, REMOVE) which come from the shell's `text-transform`, never from the source string.
- No em dashes. Plain declarative sentences, one or two per help line. Examples introduced with "For example:" ("For example: Twilio, Home Gmail, Family bot.").
- Vocabulary is fixed: "switch" (HomeKit accessory), "provider" (sending service), "group" (recipient list), "channel" (SMS, email, Telegram, ntfy). Channel words: SMS, email, Telegram, ntfy (lowercase ntfy always).
- Second person, direct: "Add only the ones you will use." "Turn one on, usually from an automation, and it sends a message, then turns itself off."
- Help explains what a value looks like and where to get it: "It starts with AC and is not a secret." Longer help becomes a link titled "Where do I find this?".
- Validation states the shape and the fix: "That does not look like an Account SID. It starts with AC and is 34 characters; copy it from the Twilio Console." Required: "{Label} is required." with the field's own label verbatim ("Master switch name is required.", "Account SID is required."); a field labelled Name reads "Name is required.". An empty required field says so; the format message is reserved for a filled-in value that does not look right.
- Live counts in labels: "Family: 4 SMS, 4 email, 1 ntfy", "SMS (4 numbers)", "Will send SMS via Twilio to 4 numbers…".
- Default provider rule (verified against the live UI): "Make default for {channel}" appears only on providers that can be the default for that channel and are not currently the default. A provider carrying the "Default for {channel}" badge never shows the link.
- Confirmation is in place and specific: "Remove Door Open Notification?" then REMOVE / Cancel.
- No emoji anywhere. Unicode is limited to the disclosure glyphs ▸ ▾, the middle dot · in the footer, and the ellipsis … in placeholders ("e.g. SK…").
- Placeholders are italic examples beginning "e.g.".

## Host constraints
- The Homebridge UI links its own stylesheet into the plugin iframe **after** the plugin's, so any plain `html, body` rule the plugin writes can be overridden. Rules that must win are written on `:root` for specificity, never relied on by order.
- The iframe document is never a scroll container. The scroll rule is exactly `:root, :root > body { overflow: hidden; height: auto }` (tokens/base.css), and there is no fixed or percentage height anywhere in the page. The host owns all scrolling.
- The host auto-sizes the iframe to `body.scrollHeight` + 10px. Content must never exceed that box: nothing `position: sticky`, nothing that assumes a window height (`vh`, `min-height: 100%`, inner scroll containers). The only `position: fixed` elements are the two page-drawn modals (QR enlarge, Reset).
- Validation runs on blur, never on keystroke: the invalid icon sits inside the control and the message under the help reads "{Label} is required.". The summary box sits in the page flow after Settings and above the closing paragraph (never sticky); past three entries it collapses to "N fields need attention" with Show all. Entries focus the named control itself (opening any Advanced above it) without rebuilding the page. Advanced opens by itself when a field inside it turns invalid.
- The unsaved-changes bar shows only when a stored draft exists; a draft is written only after the user changes something, never on load or after Reset.
- Dialogs: only the QR enlarge and the Reset confirmation ("Type RESET to confirm.", Confirm disabled until typed). Every other confirmation is inline and closes on Escape.
- SMTP presets are a segmented control above 600px and a dropdown below; the Telegram QR block becomes Open in Telegram / Copy link / Share on phones.
- Known shell backlog item: a card whose Name is cleared shows its id in the header (`name || id || 'New provider'`). Reproduced, not fixed.
- The host draws the modal, its title bar and the CLOSE / SAVE buttons. The plugin page starts at the banner and ends at the footer.
- No credentials in browser storage. Drafts hold structure only; secrets stay in config.json or the credentials file.
- Theme comes from the host (`body.dark-mode` or `body[class*="config-ui-x-dark-mode"]`); the plugin never sets its own. Every token reads the host variable with a fallback, `var(--bs-x, fallback)`, exactly as index.css does; the two dark-only selectors this system used to carry are gone.

## Visual foundations
- **Colour**: host Bootstrap 5. Light: page #fff, text #212529, secondary rgba(33,37,41,.75), rules #dee2e6, card border rgba(0,0,0,.176), subtle strip rgba(33,37,41,.03), locked #e9ecef, link #0d6efd. Dark: #1c1c1c / #fff / rgba(222,226,230,.75) / #495057 / rgba(255,255,255,.15) / #262626 / #343a40 / #6ea8fe. Primary button #607d8b (blue-grey, from the Homebridge UI): the only filled button per section. Danger #dc3545, success #198754, badge #6c757d, warning #fff3cd/#664d03. Banner field #16263a, mark #f2f2f3.
- **Type**: host system stack; no webfonts. Body 14.4px/300/1.5. Labels 14.4px/600. Help 12.6px/300/1.4. h2 20px/300. Controls 16px. Badges 11.5px/600. Small buttons 13.5px uppercase. Card titles bold. IDs and secrets monospace.
- **Spacing**: 16px page side padding, 24px between sections, 16px card padding and card gap, 16px under each field, 12px inside panels, 8px grid column gap, 12px tile gap. 12-column grid; every cell full width below 600px.
- **Radii**: controls and cards 6px, buttons and badges 4px, modal 8px, step disc fully round.
- **Cards**: 1px translucent border, 6px radius, overflow hidden, no shadow. Header and footer are strips on the subtle fill with 1px rules. Backgrounds are flat; no images, gradients, patterns or textures anywhere except the 4:1 banner.
- **Borders and rules**: 1px `--ns-border` under h2, above footers and result bars. A 3px left rule marks the preview line. Dashed red border marks bad SMS characters.
- **Shadows**: none inside the plugin page. The host modal carries its own shadow. Focus rings are Bootstrap's 4px translucent ring.
- **Hover**: outlined buttons get a `rgba(128,128,128,.08)` wash and keep their outline (never fill); press is `.2`. Text buttons underline. Chooser tiles turn their border to the link colour with a 1px ring. Filled primary darkens slightly.
- **Disabled**: full opacity, transparent fill, border-colour border, secondary text, `cursor: not-allowed`, never a dimmed copy.
- **Animation**: none except 150ms ease colour transitions on buttons and the variables chevron rotate.
- **Transparency/blur**: none; secondary text uses alpha colour, the modal backdrop is rgba(0,0,0,.55). No blur.
- **Layout**: single column page in a modal (400–800px wide). The "Fix these before saving" box renders in the page flow after Settings and above the closing paragraph, not sticky. Touch targets 44px on coarse pointers.
- **Imagery**: none beyond the banner (dark navy field, white line mark, light-blue tagline). Screenshots in docs are plain light-theme captures.

## Iconography
- No icon font or icon set. The only glyphs are: the brand mark (`assets/notify-switch-mark.svg`, currentColor, inlined at 20px in the footer), the green validation check, the red invalid mark and the select chevron (Bootstrap data-URI SVGs baked into the controls), CSS-drawn chevron on "Show variables", and unicode ▸ ▾ on disclosures.
- QR codes are generated at runtime (qrcode-generator) for Telegram onboarding.
- No emoji. ntfy "tags" are typed as words (warning, house) and rendered by the ntfy app, not here.

## Assets
- `assets/notify-switch-banner.png` 4:1 page banner
- `assets/notify-switch-mark.svg` currentColor mark; `notify-switch-light.svg` / `notify-switch-dark.svg` themed marks
- `assets/notify-switch-192.png`, `notify-switch-512.png` icons; `notify-switch-social.png` social card; `switch-config.png` reference screenshot of the switch editor

## Components (the shell inventory from HANDOFF.md)
Actions: Button, InlineConfirm.
Shell: Banner, SectionHeading, Card, Badge, Grid (+ GridCell), Disclosure, StatusBox, IssuesSummary (+ focusField), DraftBar, ChooserTiles, CreditFooter, Modal, ResetDialog, QrBlock.
Fields: Field (+ useFieldState), HelpText, TextField (+ controlStyle, controlIcons), PasswordField, SelectField, SegmentedField (+ useNarrow), TextareaField, CheckField, ListField, Note, Block, Step, Preview.

Intentional additions: Field and HelpText (wrappers the source builds inline in `dom.ts`), Grid/GridCell (the `.ns-grid` / `.ns-span-*` classes as components), Modal (the `.ns-modal` markup `main.ts` builds inline).

## Index
- `styles.css` → `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`, `tokens/base.css`
- `components/actions/`, `components/shell/`, `components/fields/` (each with a `*.card.html`)
- `assets/`
- `guidelines/` 15 foundation cards (Colors, Type, Spacing, Brand)
- `ui_kits/notify-switch/` interactive settings page recreation (`index.html`, `Providers.jsx`, `GroupsSwitchesSettings.jsx`, `App.jsx`)
- `templates/plugin-settings/PluginSettings.dc.html` reusable settings-page template (banner, intro, sections, gated add buttons, issues box, outro, footer)
- `thumbnail.html`, `github.md`, `SKILL.md`

## Missing on purpose
No logo beyond the mark the repo ships. No webfonts (host system stack). No slides (none provided). The Peloton plugin shares this shell but its repo was not read.
