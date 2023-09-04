/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["gdataInitUI"];

function gdataInitUI(window, document) {
  ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
    "ui/gdata-summary-dialog.jsm"
  );

  const { CONFERENCE_ROW_FRAGMENT, initConferenceRow } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/ui/gdata-dialog-utils.jsm"
  );

  const { getMessenger } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );
  let messenger = getMessenger();

  (function() {
    /* initXUL */
    let confFragment = window.MozXULElement.parseXULToFragment(CONFERENCE_ROW_FRAGMENT);
    document
      .querySelector(".calendar-summary-table")
      .insertBefore(confFragment, document.querySelector(".location-row").nextSibling);
    initConferenceRow(document, messenger, window.arguments[0].calendarEvent);
  })();
}
