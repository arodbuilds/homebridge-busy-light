# reference/

Read-only material for build 2. Nothing here ships, and build 2 deletes this folder (and its `reference/**` entry in `eslint.config.js`) in its last commit.

## reference/build-2/generac/

From `arodbuilds/homebridge-generac` 1.0.1 (September 26, 2026), the most recent sibling plugin with a custom settings page. Match its structure:

1. `homebridge-ui/` (`src/` with `api.ts`, `app.ts`, `card.ts`, `copy.ts`, `dom.ts`, `footer.ts`, `format.ts`, `main.ts`, `mark.ts`, `model.ts`, `validate.ts` and `sections/`; `public/index.html` and `index.css`; `server.js`; its own `tsconfig.json`), built by `scripts/build-ui.mjs`.
2. `src/ui/server.ts`: the UI server, compiled with the plugin and started from `homebridge-ui/server.js`, so it reuses the plugin's modules.
3. The page tests: `test/fake-dom.ts`, `test/ui-page.test.ts`, `test/ui-model.test.ts`, `test/ui-server.test.ts`.
4. `package.json` (`build:ui` script, `files` including `homebridge-ui/public` and `homebridge-ui/server.js`), `tsconfig.json`, `tsconfig.test.json`, `eslint.config.js`.
5. `SPEC.md` sections 10 and 11: how Generac specified its UI server, page anatomy, shell additions and copy. Busy Light's SPEC sections 10.3 and 11 follow the same shape.
6. `design/prototype/_ds/.../`: the shared shell's design system readme and tokens.

`copy.ts` and `sections/` hold Generac's own content. Take the structure and the shell pieces, not the strings: every Busy Light string comes from Busy Light's SPEC 11.3.

## reference/build-2/notify-switch/

From `arodbuilds/homebridge-notify-switch` (the shell master): `design/HANDOFF.md`, `design/BUILD-CONTRACT.md`, `design/BUILD-CONTRACT-DEFINITIONS.md` and `design/CONTRACT-AUDIT.md` (the shell rules, with rule ids S, R, C, F, T, W, M), `SPEC.md` (section 11.2, including item 18 on theme contrast and item 28 on the shell), and the shell code it describes: `homebridge-ui/public/index.css` and `homebridge-ui/src/card.ts`, `dom.ts`, `draft.ts`, `copy.ts`.

Where the two siblings differ, Generac is newer and wins, except that the shell rules in `BUILD-CONTRACT.md` are binding for both.
