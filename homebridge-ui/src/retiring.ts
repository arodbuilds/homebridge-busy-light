/**
 * Strings build 3.1 takes off the page (SPEC 11.3). They stay here only until the scope item that removes their last
 * use, so the page keeps working at every commit while the copy check (SPEC 15 item 14) reads only `copy.ts`. Build
 * 3.1 deletes this module with the last of them.
 */
export const RETIRING = {
  microsoftTileTitle: 'Microsoft 365',
  microsoftTileHelp: 'Outlook calendars and Teams status. Needs an app registration from your administrator.',
  teamsOnly: 'Teams only',
};
