/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.importESModule("resource://gdata-provider/legacy/modules/gdataUI.sys.mjs").recordModule(
  "ui/gdata-summary-dialog.sys.mjs"
);

var lazy = {};

/* global getMessenger, CONFERENCE_ROW_FRAGMENT, initConferenceRow */
ChromeUtils.defineESModuleGetters(lazy, {
  getMessenger: "resource://gdata-provider/legacy/modules/gdataUtils.sys.mjs",
  CONFERENCE_ROW_FRAGMENT: "resource://gdata-provider/legacy/modules/ui/gdata-dialog-utils.sys.mjs",
  initConferenceRow: "resource://gdata-provider/legacy/modules/ui/gdata-dialog-utils.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "messenger", () => lazy.getMessenger());

export function gdataInitUI(window, document) {
  (function() {
    /* initXUL */
    let confFragment = window.MozXULElement.parseXULToFragment(lazy.CONFERENCE_ROW_FRAGMENT);
    document
      .querySelector(".calendar-summary-table")
      .insertBefore(confFragment, document.querySelector(".location-row").nextSibling);
    lazy.initConferenceRow(document, lazy.messenger, window.arguments[0].calendarEvent);
  })();
}
