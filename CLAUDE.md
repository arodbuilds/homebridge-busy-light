# CLAUDE.md

Rules for working in this repository. They apply to every build, every commit and every pull request.

## Source of truth

- `SPEC.md` is the source of truth for behaviour, naming, configuration, log lines and UI copy. Where any other document, prompt, comment or reference file disagrees with `SPEC.md`, `SPEC.md` wins.
- Every build updates `SPEC.md`, `README.md` and `CHANGELOG.md`.
- If the SPEC is silent or cannot be followed as written, make the smallest reasonable choice, record it in SPEC section 17 with the date, and list it under "Deviations" in the pull request description.

## Branches and pull requests

- The default branch is `latest`. Work on a branch and open one pull request against `latest`. Never push to `latest` directly.
- One commit per scope item of the build prompt, in order.
- Before opening the pull request, `npm test` (lint, build, unit tests) is clean on Node 20, 22 and 24 where available, and the pull request description says so.

## Attribution

- Never add Claude Code attribution footers to commits, pull requests, issues or comments.
- Never add `Co-Authored-By` trailers to commit messages.

## Writing style

- No em dashes and no double hyphens used as dashes anywhere: not in code comments, docs, UI copy, log lines or commit messages. Use a comma, a colon, parentheses or a new sentence instead.
- Dates in prose are written US style, for example October 7, 2026. ISO dates are fine in `CHANGELOG.md` headings and in SPEC section 17.
- No emoji.

## Dependencies

- Runtime dependencies are limited to `ical.js` (recurring calendar events) and, from build 2, `@homebridge/plugin-ui-utils`. Everything else (HTTP, CalDAV, XML, OAuth, UDP) uses Node built-ins only.
- Remove the template's `homebridge-lib` dependency and its type stub.

## Secrets, privacy and logging

- Never log, at any log level: passwords, app-specific passwords, access tokens, refresh tokens, device codes (the short user code shown for sign-in is the one exception), or a calendar address. A calendar address is a secret; log its host name only.
- Never log, store or write to the state file an event's title, description, location or attendees. Event titles are read in memory only, to match the out of office words (SPEC 6.4). Debug logging reports counts and times, never content.
- Microsoft Graph requests select only the fields listed in SPEC 5.3.

## UI copy

- All UI copy comes from SPEC sections 9.2 and 11.3 verbatim, and all log lines from SPEC section 12 verbatim. Do not paraphrase, reflow or invent strings.

## Tests

- Tests never touch the network or send UDP. Mock `fetch` and the socket, and use the fixtures under `test/fixtures/`.
- Fixtures are synthetic. Never commit a real email address, calendar address, tenant ID, token or event title.
