/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2020 */


/* IF YOU CHANGE ANYTHING IN THIS FILE YOU NEED TO INCREASE bump=2 in all other modules loading it */

var lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionSupport: "resource:///modules/ExtensionSupport.sys.mjs", /* global ExtensionSupport */
  ExtensionParent: "resource:///modules/ExtensionParent.sys.mjs" /* global ExtensionParent */
});

var unregisterIds = [];
var closeWindows = new Set();
var extensionVersion = 0;

export function recordWindow(window) {
  closeWindows.add(window);
  window.addEventListener("unload", () => closeWindows.delete(window));
}

export function setExtensionVersion(version) {
  extensionVersion = version;
  console.log("[gdataUI] Future modules will load with version " + extensionVersion); // eslint-disable-line no-console
}


export function defineGdataModuleGetters(obj, modules) {
  for (let [name, module] of Object.entries(modules)) {
    modules[name] = module + "?version=" + extensionVersion;
  }

  ChromeUtils.defineESModuleGetters(obj, modules);
}

export function loadGdataModule(module) {
  return ChromeUtils.importESModule(module + "?version=" + extensionVersion);
}

export function loadGdataUIModule(module, window, record = false) {
  let { gdataInitUI } = loadGdataModule(module);
  gdataInitUI(window, window.document, extensionVersion);

  if (record) {
    recordWindow(window);
  }
}

function registerWindowListener(id, version, chromeURLs, record = true) {
  lazy.ExtensionSupport.registerWindowListener(id, {
    chromeURLs: chromeURLs,
    onLoadWindow: window => {
      let { gdataInitUI } = ChromeUtils.importESModule(
        `resource://gdata-provider/legacy/modules/ui/${id}.sys.mjs?version=${version}`
      );
      gdataInitUI(window, window.document, version);
      if (record) {
        recordWindow(window);
      }
    },
  });
  unregisterIds.push(id);
}

export function register() {
  registerWindowListener("gdata-calendar-creation", extensionVersion, [
    "chrome://calendar/content/calendar-creation.xhtml",
  ]);
  registerWindowListener("gdata-calendar-properties", extensionVersion, [
    "chrome://calendar/content/calendar-properties-dialog.xhtml",
  ]);
  registerWindowListener("gdata-event-dialog-reminder", extensionVersion, [
    "chrome://calendar/content/calendar-event-dialog-reminder.xhtml",
  ]);
  registerWindowListener("gdata-summary-dialog", extensionVersion, [
    "chrome://calendar/content/calendar-summary-dialog.xhtml",
  ]);
  registerWindowListener(
    "gdata-event-dialog",
    extensionVersion,
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
        "resource://gdata-provider/legacy/modules/gdataMigration.sys.mjs?version=" + extensionVersion
      );
      checkMigrateCalendars(window);
    },
  });
  unregisterIds.push("gdata-messenger-window");
}

export function unregister() {
  for (let id of unregisterIds) {
    lazy.ExtensionSupport.unregisterWindowListener(id);
  }
  unregisterIds = [];

  for (let window of closeWindows) {
    window.close();
  }
  closeWindows.clear();
}
