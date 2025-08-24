/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { getMigratableCalendars } from "../background/migrate.js";

function changeSetting(id, event) {
  messenger.storage.local.set({ [id]: event.target.checked });
}

for (let node of document.querySelectorAll("[data-l10n-id]")) {
  node.textContent = messenger.i18n.getMessage(node.getAttribute("data-l10n-id"));
}

(async function() {
  let prefs = await messenger.storage.local.get({
    "settings.sendEventNotifications": false,
    "settings.forcePlainText": false,

    // LEGACY
    "settings.enableEmailInvitations": false,
    "settings.enableAttendees": false
    // LEGACY END
  });

  for (let [id, value] of Object.entries(prefs)) {
    let node = document.getElementById(id.substr(9));
    node.checked = value;
    node.addEventListener("change", changeSetting.bind(undefined, id));
  }

  let migrateCalendarButton = document.getElementById("migrate-calendars");

  migrateCalendarButton.addEventListener("click", async () => {
    let tabs = await messenger.tabs.query({
      url: new URL("/content/migration-wizard.html", location).href,
      windowType: "popup"
    });

    if (tabs.length > 0) {
      await messenger.windows.update(tabs[0].windowId, { focused: true });
    } else {
      await messenger.storage.local.set({ "settings.migrate": true });
      await messenger.windows.create({
        url: "/content/migration-wizard.html",
        type: "popup",
        allowScriptsToClose: true
      });
    }
  });

  let calendars = await getMigratableCalendars();
  if (!calendars.length) {
    migrateCalendarButton.disabled = true;
    migrateCalendarButton.title = messenger.i18n.getMessage("settings.migrateCalendars.disabled");
  }
})();
