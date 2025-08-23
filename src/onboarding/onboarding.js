/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

function changeSetting(id, event) {
  messenger.storage.local.set({ [id]: event.target.checked });
}

(async function() {
  let openOptions = document.getElementById("openOptions");
  if (openOptions) {
    openOptions.addEventListener("click", (event) => {
      messenger.runtime.openOptionsPage();
      event.preventDefault();
    });
  }

  populateL10n();
  populateUpgradeList();
  populatePrefs();
})();

function populateL10n() {
  for (let node of document.querySelectorAll("[data-l10n-id]")) {
    node.textContent = messenger.i18n.getMessage(node.getAttribute("data-l10n-id"));
  }
  for (let node of document.querySelectorAll("[data-l10n-attrs-alt]")) {
    node.setAttribute("alt", messenger.i18n.getMessage(node.getAttribute("data-l10n-attrs-alt")));
  }

  for (let node of document.querySelectorAll(".donatebutton .button")) {
    node.href = node.href.replace("AMOUNT", messenger.i18n.getMessage("onboarding.donate.amount"));
  }
}

async function populatePrefs() {
  let prefs = await messenger.storage.local.get({
    "settings.enableEmailInvitations": false,
    "settings.sendEventNotifications": false,
    "settings.enableAttendees": false,
  });

  for (let [id, value] of Object.entries(prefs)) {
    let node = document.getElementById(id.substr(9));
    if (node) {
      node.checked = value;
      node.addEventListener("change", changeSetting.bind(undefined, id));
    }
  }
}

async function populateUpgradeList() {
  let upgradeList = document.getElementById("calendar-upgrade-list");
  if (!upgradeList) {
    return;
  }

  let calendars = await messenger.calendar.calendars.query({ type: "gdata" });

  if (!calendars.length) {
    document.getElementById("upgradeSection").remove();
    return;
  }

  for (let calendar of calendars) {
    let listItem = upgradeList.appendChild(document.createElement("li"));
    let label = listItem.appendChild(document.createElement("label"));

    let checkbox = label.appendChild(document.createElement("input"));
    checkbox.type = "checkbox";
    checkbox.value = calendar.id;
    checkbox.checked = true;

    label.appendChild(document.createTextNode(calendar.name));
  }

  document.getElementById("calendar-upgrade-button").addEventListener("click", upgradeButtonClick);
}

async function upgradeButtonClick(event) {
  for (let calendarNode of document.querySelectorAll("#calendar-upgrade-list > li input")) {
    if (calendarNode.checked) {
      await messenger.gdata.upgradeCalendar(calendarNode.value);
      calendarNode.parentNode.parentNode.remove();
    }
  }

  window.close();
}
