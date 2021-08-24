/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { getMigratableCalendars, migrateCalendars } from "../background/migrate.js";
import { isTesting } from "../background/utils.js";

export async function main() {
  let accept = document.getElementById("accept");
  let cancel = document.getElementById("cancel");
  let alwaysCheck = document.getElementById("always-check");
  let listbox = document.getElementById("calendar-listbox");
  let listboxItem = document.getElementById("calendar-listbox-item");

  // Doing i18n manually since there are just a few
  document.title = messenger.i18n.getMessage("gdata.migration.title");
  document.getElementById("gdata-migration-description").textContent = messenger.i18n.getMessage(
    "gdata.migration.description"
  );
  accept.textContent = messenger.i18n.getMessage("gdata.migration.upgrade.label");
  accept.setAttribute("accesskey", messenger.i18n.getMessage("gdata.migration.upgrade.accesskey"));
  cancel.textContent = messenger.i18n.getMessage("gdata.migration.cancel.label");
  cancel.setAttribute("accesskey", messenger.i18n.getMessage("gdata.migration.cancel.accesskey"));
  document.getElementById("always-check-label").lastChild.nodeValue = messenger.i18n.getMessage(
    "gdata.migration.showagain.label"
  );

  // Load calendars into the listbox
  let calendars = await getMigratableCalendars();
  for (let calendar of calendars) {
    let item = listboxItem.content.cloneNode(true);
    item.querySelector("input").value = calendar.id;
    item.querySelector("label").lastChild.nodeValue = calendar.name;
    item.querySelector(".colordot").style.backgroundColor = calendar.color;
    listbox.appendChild(item);
  }

  let prefs = await messenger.storage.local.get({ "settings.migrate": true });
  alwaysCheck.checked = prefs["settings.migrate"];

  // Event listeners
  accept.addEventListener("click", clickAccept);
  cancel.addEventListener("click", clickCancel);
}

export async function clickAccept(event) {
  try {
    let alwaysCheck = document.getElementById("always-check");
    let calendarIds = [...document.querySelectorAll("#calendar-listbox input:checked")].map(
      item => item.value
    );
    await messenger.storage.local.set({ "settings.migrate": alwaysCheck.checked });
    await migrateCalendars(calendarIds);
  } finally {
    window.close();
  }
}
export async function clickCancel(event) {
  let alwaysCheck = document.getElementById("always-check");
  await messenger.storage.local.set({ "settings.migrate": alwaysCheck.checked });
  window.close();
}

/* istanbul ignore next */
(async function() {
  if (await isTesting()) {
    return;
  }

  await main();
})();
