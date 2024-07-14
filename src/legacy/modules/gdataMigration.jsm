/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
  "gdataMigration.jsm"
);

var EXPORTED_SYMBOLS = ["migrateCalendars", "getMigratableCalendars", "checkMigrateCalendars"];

ChromeUtils.defineLazyGetter(this, "messenger", () => {
  let { getMessenger } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );

  return getMessenger();
});

ChromeUtils.defineModuleGetter(
  this,
  "cal",
  "resource:///modules/calendar/calUtils.jsm"
); /* global cal */

async function checkMigrateCalendars(window) {
  let prefs = await messenger.storage.local.get({ "settings.migrate": true });
  let calendars = getMigratableCalendars();

  if (calendars.length && prefs["settings.migrate"]) {
    // Slightly delay showing the wizard to make sure it doesn't appear before the main window.
    window.setTimeout(() => {
      window.openDialog(
        "chrome://gdata-provider/content/gdata-migration-wizard.xhtml",
        "GdataMigrationWizard",
        "chrome,titlebar,modal,alwaysRaised"
      );
    }, 1000);
  }
}

function migrateCalendars(calendars) {
  let calmgr = cal.manager;
  for (let calendar of calendars) {
    let newCalendar = calmgr.createCalendar("gdata", calendar.uri);
    newCalendar.name = calendar.name;

    newCalendar.setProperty("color", calendar.getProperty("color"));
    newCalendar.setProperty("disabled", calendar.getProperty("disabled"));
    newCalendar.setProperty("suppressAlarms", calendar.getProperty("suppressAlarms"));
    newCalendar.setProperty(
      "calendar-main-in-composite",
      calendar.getProperty("calendar-main-in-composite")
    );
    newCalendar.setProperty("calendar-main-default", calendar.getProperty("calendar-main-default"));

    calmgr.registerCalendar(newCalendar);
    calmgr.removeCalendar(calendar);
  }
}

/**
 * Get all calendars that are ics and point to a google calendar
 *
 * @return {calICalendar[]}     Migratable calendars
 */
function getMigratableCalendars() {
  const re = new RegExp(
    "^http[s]?://(www|calendar)\\.google\\.com/calendar/ical/" +
      "[^/]+/(private(-[^/]+)?|public)/" +
      "(full|full-noattendees|composite|" +
      "attendees-only|free-busy|basic)(\\.ics)?$"
  );

  return cal.manager.getCalendars({}).filter(calendar => {
    return calendar.type == "ics" && calendar.uri.spec.match(re);
  });
}
