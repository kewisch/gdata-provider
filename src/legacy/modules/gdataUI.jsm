/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

var EXPORTED_SYMBOLS = ["register", "unregister", "recordModule", "recordWindow"];

var { ExtensionSupport } = ChromeUtils.import("resource:///modules/ExtensionSupport.jsm");

var unregisterIds = [];
var unregisterModules = new Set();
var closeWindows = new Set();

function recordModule(path) {
  unregisterModules.add(path);
}

function recordWindow(window) {
  closeWindows.add(window);
  window.addEventListener("unload", () => closeWindows.delete(window));
}

function registerWindowListener(id, chromeURLs, record = true) {
  ExtensionSupport.registerWindowListener(id, {
    chromeURLs: chromeURLs,
    onLoadWindow: window => {
      let { gdataInitUI } = ChromeUtils.import(
        `resource://gdata-provider/legacy/modules/ui/${id}.jsm`
      );
      gdataInitUI(window, window.document);
      if (record) {
        recordWindow(window);
      }
    },
  });
  unregisterIds.push(id);
}

function register() {
  registerWindowListener("gdata-calendar-creation", [
    "chrome://calendar/content/calendar-creation.xhtml",
  ]);
  registerWindowListener("gdata-calendar-properties", [
    "chrome://calendar/content/calendar-properties-dialog.xhtml",
  ]);
  registerWindowListener("gdata-event-dialog-reminder", [
    "chrome://calendar/content/calendar-event-dialog-reminder.xhtml",
  ]);
  registerWindowListener(
    "gdata-event-dialog",
    [
      "chrome://calendar/content/calendar-event-dialog.xhtml",
      "chrome://messenger/content/messenger.xhtml",
    ],
    false
  );
}

function unregister() {
  for (let id of unregisterIds) {
    ExtensionSupport.unregisterWindowListener(id);
    Cu.unload(`resource://gdata-provider/legacy/modules/ui/${id}.jsm`);
  }
  unregisterIds = [];

  for (let path of unregisterModules) {
    Cu.unload("resource://gdata-provider/legacy/modules/" + path);
  }

  for (let window of closeWindows) {
    window.close();
  }
  closeWindows.clear();
}
