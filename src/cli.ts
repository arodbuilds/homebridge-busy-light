#!/usr/bin/env node
/**
 * homebridge-busy-light <status | check | login [name] | lights | light [name|ip] [#RRGGBB|off] | help> [-U <storage path>]
 *
 * Run it as the same user Homebridge runs as, so a Microsoft sign-in lands where the plugin looks for it.
 */
import { main } from './commands.js';

main(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}).then((code) => {
  process.exitCode = code;
}, (err: unknown) => {
  console.error(`Failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
