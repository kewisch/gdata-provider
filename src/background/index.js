/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { getMigratableCalendars } from "./migrate.js";
import { isTesting } from "./utils.js";
import calGoogleCalendar from "./calendar.js";
import sessions from "./session.js";

export async function migrate() {
  let legacyprefs = await messenger.gdata.getLegacyPrefs();
  if (legacyprefs) {
    console.log("[gdata-provider] Migrating legacy prefs", legacyprefs);
    await messenger.storage.local.set(legacyprefs);
    await messenger.gdata.purgeLegacyPrefs();
  }

  let prefs = await messenger.storage.local.get({ "settings.migrate": true });
  let calendars = await getMigratableCalendars();
  // if (calendars.length) {
  //  // TODO notification
  // }
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

export async function initMessageListener() {
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
      await Promise.all(
        message.calendars.map(async data => {
          let calendar = {
            name: data.name,
            type: "ext-" + messenger.runtime.id,
            url: `googleapi://${message.sessionId}/?calendar=${encodeURIComponent(data.id)}`,
          };
          return messenger.calendar.calendars.create(calendar);
        })
      );
    }
    return null;
  });
}

/* istanbul ignore next */
(async () => {
  if (await isTesting()) {
    return;
  }

  initMessageListener();
  calGoogleCalendar.initListeners();
  await migrate();
  // installDebugCalendar();
})();
