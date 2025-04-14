/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { checkCalendarMigration } from "./migrate.js";
import { isTesting } from "./utils.js";
import calGoogleCalendar from "./calendar.js";
import sessions from "./session.js";
import TimezoneService from "./timezone.js";

export async function migrateLegacyPrefs() {
  let legacyprefs = await messenger.gdata.getLegacyPrefs();
  if (legacyprefs) {
    console.log("[gdata-provider] Migrating legacy prefs", legacyprefs);
    await messenger.storage.local.set(legacyprefs);
    await messenger.gdata.purgeLegacyPrefs();
  }
}

/* istanbul ignore next */
async function installDebugCalendar() {
  let calendars = await messenger.calendar.calendars.query({ type: "ext-" + messenger.runtime.id });
  if (!calendars.length) {
    await messenger.calendar.calendars.create({
      type: "ext-" + messenger.runtime.id,
      url: "googleapi://user@example.com/?calendar=user%40example.com",
      name: "Debug Provider for Google Calendar",
    });
  }
}

export async function initListeners() {
  messenger.runtime.onMessage.addListener(async (message, sender) => {
    if (message.action == "getSessions") {
      return sessions.ids;
    } else if (message.action == "getCalendarsAndTasks") {
      let session = sessions.byId(message.sessionId, true);
      await session.ensureLogin();

      let [{ value: calendars = [] }, { value: tasks = [] }] = await Promise.allSettled([
        session.getCalendarList(),
        session.getTasksList(),
      ]);

      return { calendars, tasks };
    } else if (message.action == "createCalendars") {
      let existing = await messenger.calendar.calendars.query({});
      let existingSet = new Set(existing.map(calendar => calendar.name));

      await Promise.all(
        message.calendars.map(async data => {
          let calendar = {
            name: existingSet.has(data.name) ? `${data.name} (${message.sessionId})` : data.name,
            type: "ext-" + messenger.runtime.id,
            url: `googleapi://${message.sessionId}/?${data.type}=${encodeURIComponent(data.id)}`,
            capabilities: {
              events: data.type == "calendar",
              tasks: data.type == "tasks"
              // TODO more task properties
            }
          };
          return messenger.calendar.calendars.create(calendar);
        })
      );
    }
    return null;
  });

  messenger.runtime.onInstalled.addListener(({ reason }) => {
    if (reason == "install") {
      browser.tabs.create({ url: "/onboarding/beta-welcome.html" });
    }
  });
}

/* istanbul ignore next */
(async () => {
  if (await isTesting()) {
    return;
  }

  // Do this early to augment ICAL.js TimezoneService
  TimezoneService.init();

  initListeners();
  calGoogleCalendar.initListeners();
  await migrateLegacyPrefs();
  await checkCalendarMigration();
  // installDebugCalendar();
})();
