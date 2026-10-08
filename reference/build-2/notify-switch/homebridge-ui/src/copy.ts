import type { Channel, DateFormat, NtfyAuth, NtfyPriority, ProviderType, TimeFormat } from '../../src/types.js';

/**
 * In-app copy, verbatim from SPEC section 11.3. Field help is one sentence; anything longer is a
 * "Where do I find this?" link to the matching README section.
 */

/**
 * Links into the README on GitHub are written out in full (not built from a base) so the harness can
 * read every anchor from the built bundle and check that the README section exists.
 */
export const README_URL = 'https://github.com/arodbuilds/homebridge-notify-switch';

export const WHERE_LINK = 'Where do I find this?';

export interface HelpLink {
  text: string;
  href: string;
}

/** The page banner (SPEC section 11.2, item 28): served from the plugin's own public folder, never an external host. */
export const BANNER = {
  file: 'notify-switch-banner.png',
  alt: 'Notify Switch: Homebridge switches that send SMS, email, Telegram, or ntfy messages when turned on.',
};

export const GETTING_STARTED = 'Notify Switch adds switches to the Home app. Turn one on, usually from an automation, and it sends a message, '
  + 'then turns itself off.';

export const GETTING_STARTED_STEPS = 'Set up in three steps: add a Provider (the service that sends), create a Recipient Group (who receives), '
  + 'then create a Switch (what to send). You only need one provider. Save, restart Homebridge, and add the switch to a HomeKit automation.';

export const PROVIDERS_SECTION = 'A provider is the service that delivers your messages. Add only the ones you will use.';

/** Provider chooser (SPEC section 11.2, item 13): one tile per type, the display name each creates, and the id base. */
export const PROVIDER_CHOOSER: Record<ProviderType, { title: string; help: string; name: string }> = {
  twilio: { title: 'Twilio', help: 'SMS text messages, and email if you have a Twilio-authenticated domain.', name: 'Twilio' },
  smtp: { title: 'Email (SMTP)', help: 'Send from a mailbox you already have, such as Fastmail, Gmail, iCloud, or Outlook.', name: 'Email' },
  telegram: { title: 'Telegram', help: 'Free messages through a bot you create. Best for family group chats.', name: 'Telegram' },
  ntfy: { title: 'ntfy', help: 'Free push notifications to the ntfy app. No account needed for public topics.', name: 'ntfy' },
};

export const CHOOSER = {
  add: 'Add provider',
  prompt: 'Which service should send your messages?',
  cancel: 'Cancel',
};

/** Provider type badge text in card headers and dropdowns (SPEC section 11.2, item 13). */
export const PROVIDER_TYPE_LABEL: Record<ProviderType, string> = { twilio: 'Twilio', smtp: 'SMTP', telegram: 'Telegram', ntfy: 'ntfy' };

/** Provider Name field help, with examples (SPEC section 11.3). */
export const PROVIDER_NAME_HELP = 'How this provider is listed when you set up a switch. For example: Twilio, Home Gmail, Family bot.';

/**
 * The labels of the fields that must not be left empty (SPEC section 11.3). Each section renders its field with the
 * label here and the validator builds the field's "{Label} is required." message from the same entry, so the message
 * always carries the field's own label verbatim ("Master switch name is required.", "Account SID is required."; a
 * field labelled Name reads "Name is required."), and so does the summary box entry, which repeats the message after
 * the card's name. The per-channel messages under a switch's Advanced take their labels from `SWITCH_EDITOR`.
 */
export const FIELD_LABELS = {
  name: 'Name',
  masterSwitchName: 'Master switch name',
  id: 'ID',
  accountSid: 'Account SID',
  apiKeySid: 'API Key SID',
  apiKeySecret: 'API Key Secret',
  host: 'Host',
  username: 'Username',
  password: 'Password',
  fromAddress: 'From address',
  botToken: 'Bot Token',
  server: 'Server',
  accessToken: 'Access token',
  message: 'Message',
} as const;

/** Guided empty state (SPEC section 11.2, item 19): the Get started card and the disabled Add buttons. */
export const GET_STARTED = {
  title: 'Get started',
  intro: 'Choose how you want to send messages. You can add more providers later.',
  addProviderFirst: 'Add a provider first.',
};

/** The Save status line at the bottom of the page while there is nothing to save (SPEC section 11.2, item 19). */
export const SAVE_STATUS = {
  nothing: 'Nothing to save yet',
  reset: 'Configuration reset. Click Save, then restart Homebridge.',
};

/** Version and credit footer (SPEC section 11.2, item 20). */
export const FOOTER = {
  name: 'Notify Switch',
  madeBy: 'Made by Alex Rodriguez',
  site: 'alex-rodriguez.com',
  siteUrl: 'https://alex-rodriguez.com/?ref=notify-switch#building',
  issues: 'Report an issue',
  issuesUrl: 'https://github.com/arodbuilds/homebridge-notify-switch/issues',
};

/** The ID under a card's Advanced disclosure (SPEC section 11.2, item 14). */
export const ID_FIELD = {
  label: 'ID',
  edit: 'Edit',
  providerHelp: 'How switches refer to this provider in config.json.',
  groupHelp: 'How switches refer to this group in config.json.',
};

export const CREDENTIALS_FILE_HELP = 'Optional. A JSON file, relative to the Homebridge storage directory, that holds this provider\'s secrets '
  + 'so they stay out of config.json.';
export const CREDENTIALS_FILE_LINK: HelpLink = {
  text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#keeping-secrets-out-of-configjson-with-credentialsfile',
};

export const TWILIO_HELP = {
  accountSid: 'Copy from the Twilio Console home page. It starts with AC and is not a secret.',
  accountSidLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#twilio-sms-and-email' } as HelpLink,
  apiKey: 'Create a Standard key in the Twilio Console and paste its SID and secret. The secret is shown once.',
  apiKeyLink: { text: 'Why not the Auth Token?', href: 'https://github.com/arodbuilds/homebridge-notify-switch#api-keys' } as HelpLink,
  smsSenders: 'Numbers you own in Twilio. Use Look up numbers to pick from your account.',
  smsSendersNote: 'US numbers must be registered for A2P 10DLC or carriers will block messages.',
  smsSendersNoteLink: {
    text: 'How do I register?', href: 'https://github.com/arodbuilds/homebridge-notify-switch#a2p-10dlc-registration-for-us-numbers',
  } as HelpLink,
  messagingServiceSid: 'Optional. Use a Messaging Service instead of a specific number. Found at Console > Messaging > Services. Starts with MG.',
  emailFrom: 'Send email from this address through Twilio. Its domain must be verified in the Twilio Console under Email > Domains.',
  emailFromLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#email-through-twilio' } as HelpLink,
};

export const SMTP_HELP = {
  presetLabel: 'Mail provider',
  preset: 'Pick your mail service to fill in the server settings. Choose Other for any other mail server.',
  server: 'Your mail provider\'s outgoing server settings. For example: smtp.fastmail.com, 465, SSL.',
  serverLocked: 'Filled in from the mail provider above. Click Edit to change them.',
  edit: 'Edit',
  username: 'Usually your full email address. For example: you@example.com.',
  password: 'Use an app password, not your login password. Most providers require it.',
  passwordLink: { text: 'Where do I create one?', href: 'https://github.com/arodbuilds/homebridge-notify-switch#app-passwords' } as HelpLink,
  fromAddress: 'The address messages come from. Your provider must allow sending from it. For example: alerts@example.com.',
  fromName: 'Optional. Some providers replace this with your account\'s display name.',
};

export const TELEGRAM_HELP = {
  botToken: 'BotFather sends the token. It looks like 123456789:AAF… Treat it like a password.',
  botTokenLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#telegram' } as HelpLink,
  chatIds: 'Use Find people and groups on your Telegram provider. IDs are numbers, not usernames.',
  parseMode: 'How Telegram reads the message. Plain text is the safest choice.',
};

/** ntfy provider card (SPEC section 11.2, item 24, and section 11.3). */
export const NTFY_HELP = {
  intro: 'ntfy delivers to the ntfy app on your phone. Install the app, subscribe to a topic name of your choosing, and add that topic to a group. '
    + 'Anyone who knows the topic name can read it, so pick something unguessable or use an access token.',
  introLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#ntfy' } as HelpLink,
  server: 'Leave as ntfy.sh unless you run your own server.',
  authLabel: 'Authentication',
  auth: {
    none: 'No credentials. Works for public topics on ntfy.sh; anyone who guesses the topic name can publish to it too.',
    token: 'Recommended. Create an access token in the ntfy app or web app under Account, then reserve your topic so only you can publish to it.',
    basic: 'Sign in with your ntfy username and password. An access token is safer because it can be revoked on its own.',
  } as Record<NtfyAuth, string>,
  authOptions: [
    { value: 'none', label: 'None' },
    { value: 'token', label: 'Access token (recommended)' },
    { value: 'basic', label: 'Username and password' },
  ] as Array<{ value: NtfyAuth; label: string }>,
  authLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#ntfy' } as HelpLink,
  token: 'Paste the access token. It starts with tk_ and is shown once.',
  username: 'Your ntfy username.',
  password: 'Your ntfy password.',
  topics: 'Topic names as subscribed in the ntfy app. Letters, numbers, dashes and underscores.',
  priorityLabel: 'Priority',
  priority: 'How the app announces it. Urgent and high can break through Do Not Disturb; min shows no notification.',
  priorityOptions: [
    { value: 'min', label: 'Min' },
    { value: 'low', label: 'Low' },
    { value: 'default', label: 'Default' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ] as Array<{ value: NtfyPriority; label: string }>,
  tagsLabel: 'Tags',
  tags: 'Optional. Up to 8, separated by commas. Emoji short codes such as warning or house show as icons in the app.',
  tagsPlaceholder: 'e.g. warning, house',
  title: 'Optional. Defaults to the switch name.',
};

export const GROUPS_SECTION = 'A group is a list of people. Switches send to groups, so you enter each person once.';

/** Group Name field help, with examples (SPEC section 11.3). */
export const GROUP_NAME_HELP = 'Who is in this list. For example: Family, Neighbors, On-call.';

/** Group phone list caption (SPEC section 11.2, item 24, from 1.3.0). */
export const GROUP_SMS_HELP = 'Stored with the country code from Settings.';

export const SWITCHES_SECTION = 'Each switch appears in the Home app. Turning it on sends your message to everyone in the groups you pick, '
  + 'on every channel they have, then the switch turns itself off.';

/** Channel names as they read inside a sentence ("3 ways to send email") and at the start of a label ("Email (1 address)"). */
export const CHANNEL_WORD: Record<Channel, string> = { sms: 'SMS', email: 'email', telegram: 'Telegram', ntfy: 'ntfy' };
export const CHANNEL_TITLE: Record<Channel, string> = { sms: 'SMS', email: 'Email', telegram: 'Telegram', ntfy: 'ntfy' };

/** What a channel's recipients are called, singular and plural: "3 numbers", "1 address". */
export const RECIPIENT_NOUN: Record<Channel, [string, string]> = {
  sms: ['number', 'numbers'], email: ['address', 'addresses'], telegram: ['chat', 'chats'], ntfy: ['topic', 'topics'],
};

/** "3 numbers", "1 address". */
export function countRecipients(channel: Channel, count: number): string {
  return `${count} ${RECIPIENT_NOUN[channel][count === 1 ? 0 : 1]}`;
}

/** The switch editor (SPEC section 11.2, item 8, and section 11.3). */
export const SWITCH_EDITOR = {
  recipientsLabel: 'Recipients',
  recipientsHelp: 'Everyone in the groups you tick gets the message on every channel they have an address for.',
  noGroups: 'No groups yet. Add one under Recipient Groups, or add extra recipients below.',
  /** "Family: 3 SMS, 1 email, 2 ntfy", or "Family: no addresses yet". */
  groupCounts: (name: string, counts: Array<[Channel, number]>): string => {
    const parts = counts.filter(([, count]) => count > 0).map(([channel, count]) => `${count} ${CHANNEL_WORD[channel]}`);
    return `${name}: ${parts.length > 0 ? parts.join(', ') : 'no addresses yet'}`;
  },
  missingGroup: (id: string): string => `${id} (missing group)`,
  extraLabel: 'Extra recipients',
  extraHelp: 'People outside the groups above, entered under their channel.',
  extraChannelLabel: { sms: 'Phone numbers (SMS)', email: 'Email addresses', telegram: 'Telegram chat IDs', ntfy: 'ntfy topics' } as Record<Channel, string>,
  extraEmpty: 'None yet.',
  sendByLabel: 'Send by',
  sendByHelp: 'Untick a channel to skip it for this switch.',
  sendByEmpty: 'Pick a group or add an extra recipient to choose how to send.',
  /** "SMS (3 numbers)". */
  channelOption: (channel: Channel, count: number): string => `${CHANNEL_TITLE[channel]} (${countRecipients(channel, count)})`,
  messageLabel: FIELD_LABELS.message,
  subjectLabel: 'Subject',
  subjectHelp: 'Used as the email subject and the ntfy title. Defaults to the switch name.',
  customizedNote: 'Each channel has its own message under Advanced.',
  /** "Will send SMS via Twilio to 3 numbers, email via Fastmail to 1 address, ntfy via ntfy to 2 topics." */
  preview: (parts: Array<{ channel: Channel; provider: string; count: number }>): string => `Will send ${parts
    .map((part) => `${CHANNEL_WORD[part.channel]} via ${part.provider} to ${countRecipients(part.channel, part.count)}`).join(', ')}.`,
  previewNone: 'Nothing will be sent yet.',
  advanced: 'Advanced',
  /** The read-only switch id under Advanced (SPEC section 11.2, item 8, from 1.3.0). */
  idHelp: 'Generated. HomeKit tracks the switch by this id, so you can rename it freely.',
  customize: 'Customize message per channel',
  customizeHelp: 'Write a different message for each channel. Each starts as a copy of the shared message.',
  channelBody: { sms: 'SMS message', email: 'Email message', telegram: 'Telegram message', ntfy: 'ntfy message' } as Record<Channel, string>,
  channelSubject: { email: 'Email subject', ntfy: 'ntfy title' } as Partial<Record<Channel, string>>,
  providerLabel: (channel: Channel): string => `${CHANNEL_TITLE[channel]} provider`,
  platformDefault: (name: string): string => `Platform default (${name})`,
  providerHelp: 'For this switch only. The default for every switch is under Settings.',
  missingProvider: (id: string): string => `${id} (missing)`,
  /** Under a ticked channel that no provider serves any more; the action stays as stored until the box is unticked. */
  noProviderNote: (channel: Channel): string => `No provider configured for ${CHANNEL_WORD[channel]}; add one or untick to remove.`,
};

/**
 * A configuration the editor cannot represent: a switch with more than one action on the same channel
 * (SPEC section 11.2, item 26). The notice sits at the top of the page and every section is disabled except
 * the two backups and Reset.
 */
export const LEGACY = {
  notice: 'Warning: upgrading to 1.1 requires reconfiguring this plugin. Download a backup for reference, then use Reset plugin to fresh install '
    + 'under Advanced and set up your switches again.',
  /** In place of the switch cards. */
  switches: (names: string[]): string => `Not shown: ${names.join(', ')}. ${names.length === 1 ? 'This switch has' : 'These switches have'} `
    + 'more than one action on the same channel, which this version cannot edit.',
};

/** Platform defaults per channel (SPEC section 5.7 and section 11.2, item 25). */
export const DEFAULTS = {
  /** {defaultName} is the display name (else id) of the provider currently written as the default. */
  prompt: (n: number, channel: Channel, defaultName: string): string =>
    `You now have ${n} ways to send ${CHANNEL_WORD[channel]}. Switches use ${defaultName} unless told otherwise. Which should they use?`,
  confirm: 'Use the selected provider',
  keep: (defaultName: string): string => `Keep ${defaultName}`,
  /** Card header, on the channel's default while more than one provider serves it. */
  badge: (channel: Channel): string => `Default for ${CHANNEL_WORD[channel]}`,
  /** Card header, on a provider that serves such a channel but is not its default. */
  makeDefault: (channel: Channel): string => `Make default for ${CHANNEL_WORD[channel]}`,
  settingsLabel: (channel: Channel): string => `Default ${CHANNEL_WORD[channel]} provider`,
  settingsHelp: (channel: Channel): string => `Switches send ${CHANNEL_WORD[channel]} through this provider unless a switch says otherwise under Advanced.`,
  settingsPlaceholder: 'Choose a provider…',
};

/** Time and date format settings (SPEC section 5.1 and section 11.3), under Default Country in the Settings section. */
export const FORMAT_SETTINGS = {
  timeLabel: 'Time format',
  timeOptions: [
    { value: '12h', label: '12-hour (5:15 PM)' },
    { value: '24h', label: '24-hour (17:15)' },
  ] as Array<{ value: TimeFormat; label: string }>,
  dateLabel: 'Date format',
  dateOptions: [
    { value: 'mdy', label: 'Month/Day/Year (9/8/2026)' },
    { value: 'dmy', label: 'Day/Month/Year (8/9/2026)' },
    { value: 'ymd', label: 'Year-Month-Day (2026-09-08)' },
  ] as Array<{ value: DateFormat; label: string }>,
  help: 'Used by {{time}}, {{date}} and {{datetime}} in messages.',
};

export const SWITCH_HELP = {
  name: 'Shown in the Home app. Letters, numbers, spaces, and apostrophes. For example: Water Leak Alert, Smoke Alarm.',
  enabled: 'A disabled switch still appears in the Home app but does nothing when turned on.',
  cooldownSeconds: 'Minimum seconds between sends for this switch. 0 disables the cooldown.',
  failureMode: 'Any: the sensor trips if any recipient fails. All: only if every recipient fails. Off: never trips; failures are still logged.',
  failureSensor: 'Adds a sensor to this switch that HomeKit automations can watch. It opens when a message fails to send.',
  failureSensorReset: 'Seconds after a failure before the sensor closes again on its own. 0 keeps it open until the next successful send.',
  subject: 'Optional. Defaults to the switch name.',
  bodySms: 'Up to 160 plain characters. Emoji and special symbols are not allowed for SMS.',
  bodyOther: 'Plain text.',
  bodySmsPlaceholder: 'e.g. Water detected under the kitchen sink at {{time}}.',
  bodyOtherPlaceholder: 'e.g. Water detected at {{time}} on {{date}}.',
  sender: 'Automatic uses the only sender, or the Messaging Service when one is set.',
  bcc: 'Hide recipients from each other (BCC)',
  bccHelp: 'Recipients go in Bcc and your from address in To, so nobody sees the other addresses. A message to one recipient always uses To.',
};

/** The "Show variables" toggle next to every body and subject field (SPEC section 11.2, item 17). */
export const VARIABLES = {
  show: 'Show variables',
  hide: 'Hide variables',
  intro: 'Type these anywhere in the message or subject:',
  /** Shown as the {{switchName}} value while the switch has no name yet. */
  switchNamePlaceholder: 'Switch name',
  insertHelp: 'Click a variable to insert it at the cursor.',
  /** Accessible name of each insert button; the visible text is the token itself. */
  insertLabel: (token: string): string => `Insert ${token}`,
  link: { text: 'More about variables', href: 'https://github.com/arodbuilds/homebridge-notify-switch#template-variables' } as HelpLink,
};

export const HOMEKIT_USAGE = 'After saving, restart Homebridge. Your switches appear in the Home app. Open Automations, choose a trigger such as a sensor '
  + 'detecting water, and add the switch with Turn On as the action. You can also test by tapping the switch directly.';

/** Per-card help toggle (SPEC section 11.2, item 16). */
export const HELP_TOGGLE = {
  show: 'Show help',
  hide: 'Hide help',
};

/** Validation messages (SPEC section 11.3): what the value looks like and where to get it. */
export const VALIDATION = {
  /** An empty required field: "{Label} is required." with the field's own label verbatim (`FIELD_LABELS`). */
  required: (label: string): string => `${label} is required.`,
  accountSid: 'That does not look like an Account SID. It starts with AC and is 34 characters; copy it from the Twilio Console.',
  apiKeySid: 'That does not look like an API Key SID. It starts with SK and is 34 characters; copy it from the Twilio Console.',
  messagingServiceSid: 'That does not look like a Messaging Service SID. It starts with MG and is 34 characters; copy it from the Twilio Console.',
  botToken: 'That does not look like a bot token. BotFather sends it as numbers, a colon, then letters. Paste the whole thing.',
  port: 'Port is usually 465 or 587.',
  /** A filled-in SMTP from address that is not one; an empty one reads "From address is required." */
  fromAddress: 'From address is not a valid email address.',
  switchName: 'Use letters, numbers, spaces, and apostrophes, starting and ending with a letter or number.',
  /** Provider, group and platform names (SPEC section 5). */
  name: 'Use letters, numbers, spaces, and punctuation, up to 64 characters.',
  /** A name another card of the same kind already uses (only switch names must be unique; SPEC section 11.3). */
  duplicateName: (noun: 'switch' | 'provider' | 'group'): string => `Another ${noun} already uses this name.`,
  ntfyServer: 'That does not look like a server address. It starts with https:// or http://, for example https://ntfy.sh.',
  ntfyTopic: (topic: string): string => `Topic "${topic}" is not a topic name. Use letters, numbers, dashes and underscores, up to 64 characters.`,
  ntfyTag: (tag: string): string => `Tag "${tag}" is not a tag. Use letters, numbers, dashes, underscores and plus signs, up to 32 characters.`,
  ntfyTags: 'Use at most 8 tags.',
  /** Shown instead of the issue list while every remaining issue is on a card nobody has touched yet (SPEC section 11.2, item 15). */
  finishNew: (what: string): string => `Fill in the new ${what} to enable Save.`,
  /** The switch editor (SPEC section 11.2, item 8). */
  noRecipients: 'Pick at least one group, or add an extra recipient.',
  noChannels: 'Turn on at least one channel.',
  tooMany: (channel: Channel, count: number, limit: number): string =>
    `This switch reaches ${countRecipients(channel, count)} on ${CHANNEL_WORD[channel]}; the limit is ${limit} per channel.`,
  missingGroup: (id: string): string => `Group "${id}" does not exist.`,
  missingProvider: (id: string): string => `Provider "${id}" does not exist.`,
  noProvider: (channel: Channel): string => `No provider can send ${CHANNEL_WORD[channel]}. Add one under Providers.`,
  /** On the Send by checkbox of a stored channel no provider serves; the same text as the note under it. */
  noProviderForChannel: (channel: Channel): string => SWITCH_EDITOR.noProviderNote(channel),
  wrongProvider: (name: string, type: string, channel: Channel): string => `Provider "${name}" is ${type}, which cannot send ${CHANNEL_WORD[channel]}.`,
  twilioEmailFrom: (name: string): string => `Provider "${name}" needs an Email From address before it can send email.`,
};

/** The "Fix these before saving" box (SPEC section 11.2, item 15): a link per field, collapsed to a count past three entries. */
export const ISSUES = {
  heading: 'Fix these before saving:',
  count: (n: number): string => `${n} field${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`,
  showAll: 'Show all',
  hide: 'Hide',
  collapseAfter: 3,
};

/** The Duplicate text buttons beside Remove on switch and group card footers (SPEC section 11.2, item 11). */
export const DUPLICATE = {
  switch: 'Duplicate switch',
  group: 'Duplicate group',
};

/**
 * In-place Remove confirmation on card footers (SPEC section 11.2, items 11 and 28): "Remove {title}?" with the card's
 * current name, or "Remove this {noun}?" while it has none. The title is inserted as text, never as markup.
 */
export const REMOVE = {
  question: (what: 'provider' | 'group' | 'switch', title = ''): string => (title ? `Remove ${title}?` : `Remove this ${what}?`),
  confirm: 'Remove',
  cancel: 'Cancel',
};

/** The result bar between a card's body and its footer strip (SPEC section 11.2, item 28). */
export const RESULT_BAR = {
  dismiss: 'Dismiss',
};

/** Unsaved draft recovery banner (SPEC section 11.2, item 23). */
export const DRAFT = {
  message: 'You have unsaved changes from earlier. Restore them?',
  restore: 'Restore',
  discard: 'Discard',
};

/** Telegram onboarding flow (SPEC section 11.2, item 10). */
export const TELEGRAM_ONBOARDING = {
  botFatherUrl: 'https://t.me/BotFather',
  step1Title: 'Create your bot',
  step1Intro: 'On your phone, scan this code with the camera to open BotFather in Telegram. On a computer with Telegram installed, '
    + 'click Open BotFather instead. Then, in the BotFather chat:',
  openBotFather: 'Open BotFather',
  botFatherCaption: 'Scan to open BotFather',
  step1Instructions: [
    'Send /newbot.',
    'Choose a display name such as Home Alerts.',
    'Choose a username ending in bot, for example homealerts_bot.',
    'BotFather replies with a token. Copy it and paste it below.',
  ],
  step2Title: 'Choose how people receive messages',
  groupTitle: 'Family group chat (recommended)',
  groupText: 'Everyone in the group gets every message. Nobody has to opt in individually.',
  individualTitle: 'Individual chats',
  individualText: 'Each person opens the bot and taps Start once.',
  step3GroupTitle: 'Add the bot to your group',
  addToGroup: 'Add bot to a group',
  groupCaption: 'Scan to add the bot to a group',
  groupSentence: 'Open Telegram on your phone and scan, or click the button, then pick your family group or create one. '
    + 'Everyone in the group will get alerts.',
  step3Title: 'Invite people',
  inviteCaption: 'Scan to start receiving alerts',
  enlarge: 'Enlarge',
  copyLink: 'Copy link',
  copyInvite: 'Copy invite message',
  openInTelegram: 'Open in Telegram',
  share: 'Share',
  inviteMessage: (username: string): string => `Tap this link and press Start to get alerts from our home: https://t.me/${username}?start=join`,
  connectFirst: 'Connect your bot in step 1 to get the links and QR codes.',
  findTitle: 'Find people and groups',
  findHelp: 'Lists everyone who has opened the bot and every group it has been added to. Choose a recipient group, then add people to it.',
  chooseGroup: 'Choose a recipient group first.',
  noGroups: 'Add a recipient group under Recipient Groups first.',
  afterFind: 'Added people appear in the group\'s Telegram chat IDs list. Save when you\'re done.',
};

/** Twilio "Look up numbers" (SPEC section 11.2, item 9). */
export const TWILIO_LOOKUP = {
  button: 'Look up numbers',
  help: 'Lists the phone numbers and Messaging Services on your Twilio account so you can pick instead of typing. Manual entry always works.',
  numbersLabel: 'Add a phone number from your account',
  servicesLabel: 'Use a Messaging Service from your account',
  numbersPlaceholder: 'Choose a phone number…',
  servicesPlaceholder: 'Choose a Messaging Service…',
};

/** Switch card Test send confirmation and its disabled-state hints (SPEC section 11.3). */
export const TEST_SEND = {
  confirm: (count: number): string => `Send to ${count} recipient${count === 1 ? '' : 's'} now?`,
  send: 'Send',
  cancel: 'Cancel',
  dismiss: 'Dismiss',
  fixErrors: 'Fix the errors above first',
  noRecipients: 'No recipients yet',
};

/** Settings > Advanced: backup, restore and reset (SPEC section 11.2, item 12). */
export const BACKUP = {
  summary: 'Advanced',
  backupNote: 'The full backup contains your provider credentials; store it like a password. '
    + 'The version without credentials is safe to share when asking for help.',
  download: 'Download backup',
  downloadWithoutCredentials: 'Download backup without credentials',
  restore: 'Restore from backup',
  restoreHelp: 'Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled.',
  restoreFailed: 'The backup could not be loaded:',
  restoreTooLarge: 'The file is larger than 1 MB, which a Notify Switch backup never is.',
  restoreForbiddenKey: (path: string): string => `The file contains a key named "${path}", which is not allowed.`,
  /** A backup with more than one action on the same channel (SPEC section 11.2, item 26) cannot be shown, so it is not loaded. */
  restoreLegacy: (names: string[]): string => `The file has more than one action on the same channel on ${names.map((name) => `"${name}"`).join(', ')}, `
    + 'which this version cannot edit. Set the switch up again instead.',
  restored: 'Backup loaded. Review the form, then click Save.',
  restoredWithoutCredentials: 'Backup loaded. Enter the credentials it left out, then click Save.',
  reset: 'Reset plugin to fresh install',
  resetTitle: 'Reset plugin to fresh install?',
  resetList: [
    'All providers, groups, switches, and settings are removed.',
    'Switches disappear from the Home app after the next restart.',
    'Credentials files on disk are not touched.',
  ],
  resetDownloadFirst: 'Download backup first',
  resetPrompt: 'Type RESET to confirm.',
  resetConfirm: 'Confirm',
  resetDone: 'The configuration has been reset. Click Save, then restart Homebridge.',
};
