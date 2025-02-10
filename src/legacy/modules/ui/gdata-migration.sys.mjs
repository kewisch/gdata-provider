/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.importESModule("resource://gdata-provider/legacy/modules/gdataUI.sys.mjs").recordModule(
  "ui/gdata-migration.sys.mjs"
);

var lazy = {};

/* global cal, migrateCalendars, getMigratableCalendars */
ChromeUtils.defineESModuleGetters(lazy, {
  migrateCalendars: "resource://gdata-provider/legacy/modules/gdataMigration.sys.mjs",
  getMigratableCalendars: "resource://gdata-provider/legacy/modules/gdataMigration.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "messenger", () => {
  let { getMessenger } = ChromeUtils.importESModule(
    "resource://gdata-provider/legacy/modules/gdataUtils.sys.mjs"
  );

  return getMessenger();
});

export async function gdataInitUI(window, document) {
  // Strings. Doing these manually since there are just a few.
  document.title = lazy.messenger.i18n.getMessage("gdata.migration.title");
  document.getElementById("gdata-migration-description").textContent = lazy.messenger.i18n.getMessage(
    "gdata.migration.description"
  );

  let dialog = document.getElementById("gdata-migration-dialog");
  dialog.setAttribute(
    "buttonlabelaccept",
    lazy.messenger.i18n.getMessage("gdata.migration.upgrade.label")
  );
  dialog.setAttribute(
    "buttonaccesskeyaccept",
    lazy.messenger.i18n.getMessage("gdata.migration.upgrade.accesskey")
  );

  let showAgain = document.getElementById("showagain-checkbox");
  showAgain.setAttribute("label", lazy.messenger.i18n.getMessage("gdata.migration.showagain.label"));

  // Load the listbox with calendars to migrate
  let listbox = document.getElementById("calendars-listbox");
  for (let calendar of window.sortCalendarArray(lazy.getMigratableCalendars())) {
    let item = document.createXULElement("checkbox");
    item.setAttribute("label", calendar.name);
    item.setAttribute("value", calendar.id);
    item.calendar = calendar;
    listbox.appendChild(item);
  }

  // Set up the "always check" field
  let prefs = await lazy.messenger.storage.local.get({ "settings.migrate": true });
  showAgain.checked = prefs["settings.migrate"];

  // Set up listeners. Don't close the window until we are done.
  document.addEventListener("dialogaccept", event => {
    event.preventDefault();
    let calendars = [];
    for (let item of listbox.querySelectorAll("checkbox[checked]")) {
      calendars.push(item.calendar);
    }
    lazy.migrateCalendars(calendars);
    window.opener.postMessage({ command: "gdataSettingsMigrate", value: showAgain.checked });
    window.close();
  });
  document.addEventListener("dialogcancel", event => {
    window.opener.postMessage({ command: "gdataSettingsMigrate", value: showAgain.checked });
  });
}
