# reference/

Read-only material for build 1. Nothing here ships, and build 1 deletes this folder in its last commit.

## reference/poc/

A proof of concept written October 7, 2026, before the repository existed. It compiled and its five unit tests passed, but it was never run against a live iCloud, Google or Microsoft account or a real bulb. Port the logic, not the shape: it is CommonJS, has a flat config and no backoff, and `SPEC.md` wins wherever the two differ.

Things it already gets right, worth keeping:

1. `status.ts`: the precedence function and its tests.
2. `ics.ts`: recurrence expansion with ical.js, including passing each series its own exceptions explicitly. Left alone, `new ICAL.Event(master)` attaches every changed occurrence in the file to every series, whatever its UID. The test in `test/all.test.ts` ("ics expansion and classification") catches this.
3. `caldav.ts`: iCloud discovery (principal, calendar home, calendar list) and the time-range REPORT, with namespace-agnostic XML helpers.
4. `graph.ts`: the device code flow, refresh, and the two Graph reads. All-day events are parsed as local dates.
5. `lifx.ts`: SetColor (type 102) and SetPower (type 117) packet layout, checked byte by byte in the tests. It does not ask for acknowledgements; the SPEC requires them.

## reference/generac/

Tooling and structure from `arodbuilds/homebridge-generac` 1.0.1, the most recent sibling plugin: `package.json` (scripts, files, engines, bin), both tsconfig files, `eslint.config.js`, `.gitignore`, `SECURITY.md`, `NOTICE`, `CLAUDE.md`, `src/cli.ts`, `src/index.ts` and `test/helpers.ts`. Match these unless the SPEC says otherwise. The two workflow files under `.github/workflows/` are already copied from it unchanged.
