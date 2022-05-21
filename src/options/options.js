/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

function changeSetting(id, event) {
  messenger.storage.local.set({ [id]: event.target.checked });
}

for (let node of document.querySelectorAll("[data-l10n-id]")) {
  node.textContent = messenger.i18n.getMessage(node.getAttribute("data-l10n-id"));
}

(async function() {
  let prefs = await messenger.storage.local.get({
    "settings.enableEmailInvitations": false,
    "settings.sendEventNotifications": false,
    "settings.enableAttendees": false,
    "settings.forcePlainText": false,
  });

  for (let [id, value] of Object.entries(prefs)) {
    let node = document.getElementById(id.substr(9));
    node.checked = value;
    node.addEventListener("change", changeSetting.bind(undefined, id));
  }
})();
