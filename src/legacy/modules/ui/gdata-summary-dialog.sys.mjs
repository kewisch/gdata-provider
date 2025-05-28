/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export function gdataInitUI(window, document, version) {
  const { getMessenger } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/gdataUtils.sys.mjs?version=${version}`
  );
  const { CONFERENCE_ROW_FRAGMENT, initConferenceRow } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/ui/gdata-dialog-utils.sys.mjs?version=${version}`
  );
  const messenger = getMessenger();
  const GDATA_CALENDAR_TYPE = "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}";

  const BIRTHDAY_ROW_FRAGMENT = `
    <html:tr provider="${GDATA_CALENDAR_TYPE}" id="gdata-birthday-row">
      <html:th>Birthday:</html:th>
      <html:td id="gdata-birthday-info-cell">
      </html:td>
    </html:tr>
  `;
  const { cal } = ChromeUtils.importESModule(
    "resource:///modules/calendar/calUtils.sys.mjs", /* global cal */
  );

  let confFragment = window.MozXULElement.parseXULToFragment(CONFERENCE_ROW_FRAGMENT);

  let link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `chrome://gdata-provider/content/conference.css?version=${version}`;
  document.head.appendChild(link);


  let table = document.querySelector(".calendar-summary-table");
  let item = window.arguments[0].calendarEvent;

  document.getElementById("gdata-conference-row")?.remove();
  table.insertBefore(confFragment, document.querySelector(".location-row").nextSibling);
  initConferenceRow(document, messenger, item);

  document.getElementById("gdata-birthday-row")?.remove();
  if (item.calendar.type == GDATA_CALENDAR_TYPE && item.calendar.uri.query.includes("eventTypes=birthday")) {
    let birthdayFragment = window.MozXULElement.parseXULToFragment(BIRTHDAY_ROW_FRAGMENT);
    table.insertBefore(birthdayFragment, document.querySelector(".repeat-row").nextSibling);

    let referenceDate = item.startDate;
    let birthdayDate = item.parentItem.startDate;

    let tense = referenceDate.compare(cal.dtz.now()) < 0 ? "Past" : "Future";
    let fmtStart = cal.dtz.formatter.formatDateLong(referenceDate);

    let age = referenceDate.year - birthdayDate.year;
    let birthdayInfo = messenger.i18n.getMessage("eventdialog.birthdayAge" + tense, [age, fmtStart]);

    document.getElementById("gdata-birthday-info-cell").textContent = birthdayInfo;
  }
}
