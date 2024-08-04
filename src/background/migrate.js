/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

const GCAL_ICAL_REGEX = /^https?:\/\/(www|calendar).google.com\/calendar\/ical\/[^/]+\/(private(-[^/]+)?|public)\/(full|full-noattendees|composite|attendees-only|free-busy|basic)(\.ics)?$/;

export async function getMigratableCalendars() {
  let calendars = await messenger.calendar.calendars.query({
    type: "ics",
    url: "*://*.google.com/calendar/ical/*",
  });
  return calendars.filter(calendar => calendar.url.match(GCAL_ICAL_REGEX));
}

export async function migrateCalendars(ids) {
  await Promise.all(
    ids.map(async id => {
      let calendar = await messenger.calendar.calendars.get(id);
      delete calendar.id;
      calendar.type = "ext-" + messenger.runtime.id;

      await messenger.calendar.calendars.create(calendar);
      await messenger.calendar.calendars.remove(id);
    })
  ).catch(console.error);
}

export async function checkCalendarMigration() {
  let prefs = await messenger.storage.local.get({ "settings.migrate": true });
  let calendars = await getMigratableCalendars();
  if (prefs["settings.migrate"] && calendars) {
    let clickListener = (notificationId) => {
      messenger.notifications.onClicked.removeListener(clickListener);
      messenger.notifications.clear("gdata-migrate");

      if (notificationId == "gdata-migrate") {
        messenger.windows.create({
          url: "/content/migration-wizard.html",
          type: "popup",
          allowScriptsToClose: true
        });
      }
    };

    messenger.notifications.onClicked.addListener(clickListener);
    messenger.notifications.create("gdata-migrate", {
      type: "basic",
      title: messenger.i18n.getMessage("extensionName"),
      iconUrl: "/images/icon.png",
      message: messenger.i18n.getMessage("gdata.migration.notification")
    });
  }
}
