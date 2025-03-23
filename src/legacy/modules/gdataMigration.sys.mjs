/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var lazy = {};

ChromeUtils.defineLazyGetter(lazy, "messenger", () => {
  let { loadGdataModule } = ChromeUtils.importESModule(
    "resource://gdata-provider/legacy/modules/gdataUI.sys.mjs?bump=2"
  );
  let { getMessenger } = loadGdataModule(
    "resource://gdata-provider/legacy/modules/gdataUtils.sys.mjs"
  );

  return getMessenger();
});

ChromeUtils.defineESModuleGetters(lazy, {
  cal: "resource:///modules/calendar/calUtils.sys.mjs" /* global cal */
});

export async function checkMigrateCalendars(window) {
  let prefs = await lazy.messenger.storage.local.get({ "settings.migrate": true });
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

export function migrateCalendars(calendars) {
  let calmgr = lazy.cal.manager;
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
export function getMigratableCalendars() {
  const re = new RegExp(
    "^http[s]?://(www|calendar)\\.google\\.com/calendar/ical/" +
      "[^/]+/(private(-[^/]+)?|public)/" +
      "(full|full-noattendees|composite|" +
      "attendees-only|free-busy|basic)(\\.ics)?$"
  );

  return lazy.cal.manager.getCalendars({}).filter(calendar => {
    return calendar.type == "ics" && calendar.uri.spec.match(re);
  });
}
