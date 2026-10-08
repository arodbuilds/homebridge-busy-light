/**
 * Entry point the Homebridge UI starts for this plugin's settings page (SPEC section 10.3). The implementation is
 * compiled from src/ui/server.ts into dist/ui/server.js and reuses the plugin's own source, token store, discovery and
 * state modules, so nothing here duplicates them.
 */
import { startUiServer } from '../dist/ui/server.js';

startUiServer();
