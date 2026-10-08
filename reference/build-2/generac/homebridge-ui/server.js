/**
 * Entry point the Homebridge UI starts for this plugin's settings page (SPEC section 10). The implementation
 * is compiled from src/ui/server.ts into dist/ui/server.js and shares the auth, credentials and state modules
 * with the platform, so nothing here duplicates them.
 */
import { startUiServer } from '../dist/ui/server.js';

startUiServer();
