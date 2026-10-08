# CLAUDE.md

Rules for working in this repository. They apply to every build, every commit and every pull request.

## Source of truth

- `SPEC.md` is the source of truth for behaviour, naming, configuration and UI copy. Where any other document, prompt or comment disagrees with `SPEC.md`, `SPEC.md` wins.
- Every build updates `SPEC.md`, `README.md` and `CHANGELOG.md`.

## Attribution

- Never add Claude Code attribution footers to commits, pull requests, issues or comments.
- Never add `Co-Authored-By` trailers to commit messages.

## Writing style

- No em dashes anywhere: not in code comments, docs, UI copy, log lines or commit messages. Use a comma, a colon, parentheses or a new sentence instead.
- Dates in prose are written US style, for example September 15, 2026.

## Dependencies

- Runtime dependencies are limited to `@homebridge/plugin-ui-utils`. Auth and HTTP use Node built-ins only.

## Secrets and logging

- Never log passwords, refresh tokens, access tokens, DPoP keys or MFA codes, at any log level.
- The Mobile Link API is called with `Authorization: Bearer` and never `DPoP`. The resource server does not implement DPoP and answers the `DPoP` scheme with 401. See the note in `src/api.ts` and SPEC section 5.3. Do not "fix" this.

## UI copy

- All UI copy comes from SPEC section 11.3 verbatim. Do not paraphrase, reflow or invent strings.

## Tests

- Tests never touch the network. Mock `fetch` and use the fixtures under `test/fixtures/`.
