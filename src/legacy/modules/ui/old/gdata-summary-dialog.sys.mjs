/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export function gdataInitUI(window, document, version) {
  const { getMessenger } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/old/gdataUtils.sys.mjs?version=${version}`
  );
  const { CONFERENCE_ROW_FRAGMENT, initConferenceRow } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/ui/old/gdata-dialog-utils.sys.mjs?version=${version}`
  );
  const messenger = getMessenger();

  let confFragment = window.MozXULElement.parseXULToFragment(CONFERENCE_ROW_FRAGMENT);

  let link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `chrome://gdata-provider/content/old/conference.css?version=${version}`;
  document.head.appendChild(link);

  document
    .querySelector(".calendar-summary-table")
    .insertBefore(confFragment, document.querySelector(".location-row").nextSibling);
  initConferenceRow(document, messenger, window.arguments[0].calendarEvent);
}
