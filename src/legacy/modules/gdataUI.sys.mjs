/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2020 */

var lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionSupport: "resource:///modules/ExtensionSupport.sys.mjs" /* global ExtensionSupport */
});

var unregisterIds = [];
var unregisterModules = new Set();
var closeWindows = new Set();

export function recordModule(path) {
  unregisterModules.add(path);
}

export function recordWindow(window) {
  closeWindows.add(window);
  window.addEventListener("unload", () => closeWindows.delete(window));
}

function registerWindowListener(id, chromeURLs, record = true) {
  lazy.ExtensionSupport.registerWindowListener(id, {
    chromeURLs: chromeURLs,
    onLoadWindow: window => {
      let { gdataInitUI } = ChromeUtils.importESModule(
        `resource://gdata-provider/legacy/modules/ui/${id}.sys.mjs`
      );
      gdataInitUI(window, window.document);
      if (record) {
        recordWindow(window);
      }
    },
  });
  unregisterIds.push(id);
}

export function register() {
  registerWindowListener("gdata-calendar-creation", [
    "chrome://calendar/content/calendar-creation.xhtml",
  ]);
  registerWindowListener("gdata-calendar-properties", [
    "chrome://calendar/content/calendar-properties-dialog.xhtml",
  ]);
  registerWindowListener("gdata-event-dialog-reminder", [
    "chrome://calendar/content/calendar-event-dialog-reminder.xhtml",
  ]);
  registerWindowListener("gdata-summary-dialog", [
    "chrome://calendar/content/calendar-summary-dialog.xhtml",
  ]);
  registerWindowListener(
    "gdata-event-dialog",
    [
      "chrome://calendar/content/calendar-event-dialog.xhtml",
      "chrome://messenger/content/messenger.xhtml",
    ],
    false
  );

  lazy.ExtensionSupport.registerWindowListener("gdata-messenger-window", {
    chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
    onLoadWindow: window => {
      let { checkMigrateCalendars } = ChromeUtils.importESModule(
        "resource://gdata-provider/legacy/modules/gdataMigration.sys.mjs"
      );
      checkMigrateCalendars(window);
    },
  });
}

export function unregister() {
  for (let id of unregisterIds) {
    lazy.ExtensionSupport.unregisterWindowListener(id);
    Cu.unload(`resource://gdata-provider/legacy/modules/ui/${id}.sys.mjs`);
  }
  unregisterIds = [];

  lazy.ExtensionSupport.unregisterWindowListener("gdata-messenger-window");

  for (let path of unregisterModules) {
    Cu.unload("resource://gdata-provider/legacy/modules/" + path);
  }

  for (let window of closeWindows) {
    window.close();
  }
  closeWindows.clear();
}
