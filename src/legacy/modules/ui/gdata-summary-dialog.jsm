/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
  "ui/gdata-summary-dialog.jsm"
);

var EXPORTED_SYMBOLS = ["gdataInitUI"];

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetters(this, {
  getMessenger: "resource://gdata-provider/legacy/modules/gdataUtils.jsm",
  CONFERENCE_ROW_FRAGMENT: "resource://gdata-provider/legacy/modules/ui/gdata-dialog-utils.jsm",
  initConferenceRow: "resource://gdata-provider/legacy/modules/ui/gdata-dialog-utils.jsm",
});

ChromeUtils.defineLazyGetter(this, "messenger", () => getMessenger());

function gdataInitUI(window, document) {
  (function() {
    /* initXUL */
    let confFragment = window.MozXULElement.parseXULToFragment(CONFERENCE_ROW_FRAGMENT);
    document
      .querySelector(".calendar-summary-table")
      .insertBefore(confFragment, document.querySelector(".location-row").nextSibling);
    initConferenceRow(document, messenger, window.arguments[0].calendarEvent);
  })();
}
