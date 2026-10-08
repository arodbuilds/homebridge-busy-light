/**
 * Wrappers over the `homebridge` object the Homebridge UI injects into the settings iframe. A request the server
 * could not answer resolves to `undefined`; callers show the network copy.
 */

import { TOAST_TITLE } from './copy.js';

function hb(): Window['homebridge'] {
  return window.homebridge;
}

export async function callServer<T>(path: string, payload: unknown = {}): Promise<T | undefined> {
  try {
    const result = (await hb().request(path, payload)) as T;
    return result && typeof result === 'object' ? result : undefined;
  } catch {
    return undefined;
  }
}

export function toastError(message: string): void {
  hb().toast.error(message, TOAST_TITLE);
}

export function toastSuccess(message: string): void {
  hb().toast.success(message, TOAST_TITLE);
}

export function setSaveEnabled(enabled: boolean): void {
  if (enabled) {
    hb().enableSaveButton();
  } else {
    hb().disableSaveButton();
  }
}
