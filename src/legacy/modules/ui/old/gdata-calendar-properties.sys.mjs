/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export function gdataInitUI(window, document, version) {
  function i18n(str, subs) {
    return messenger.i18n.getMessage("propertiesdialog." + str, subs);
  }

  const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

  const { monkeyPatch, getMessenger } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/old/gdataUtils.sys.mjs?version=${version}`
  );
  const messenger = getMessenger();

  const NEW_GDATA_TYPE = "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}";

  const UPGRADE_FRAGMENT = `
    <vbox id="gdata-legacy-upgrade">
      <label id="gdata-legacy-upgrade-title" value="${i18n("upgradeTitle")}"/>
      <description id="gdata-legacy-upgrade-description"/>
      <hbox pack="end">
        <button id="gdata-legacy-upgrade-button"/>
      </hbox>
    </vbox>
  `;

  function gdataUpgrade() {
    let calendar = window.gCalendar;
    let button = document.getElementById("gdata-legacy-upgrade-button");

    if (button.dataset.action == "upgradeButton") {
      let newCalendar = cal.manager.createCalendar(NEW_GDATA_TYPE, calendar.uri);
      newCalendar.id = cal.getUUID();
      newCalendar.readOnly = calendar.readOnly;

       const propsToCopy = [
        "color",
        "disabled",
        "forceEmailScheduling",
        "auto-enabled",
        "cache.enabled",
        "refreshInterval",
        "suppressAlarms",
        "calendar-main-in-composite",
        "calendar-main-default",
        "readOnly",
        "imip.identity.key",
        "username",
      ];
      for (const prop of propsToCopy) {
        newCalendar.setProperty(prop, calendar.getProperty(prop));
      }

      let legacyLabel = messenger.i18n.getMessage("gdataProviderLabelLegacy", [""]);

      if (calendar.name.endsWith(legacyLabel)) {
        newCalendar.name = calendar.name.substring(0, calendar.name.length - legacyLabel.length);
      } else if (calendar.name.startsWith(legacyLabel)) {
        newCalendar.name = calendar.name.substring(legacyLabel.length);
      } else {
        newCalendar.name = calendar.name;
      }

      cal.manager.registerCalendar(newCalendar);
    }

    cal.manager.removeCalendar(calendar, Ci.calICalendarManager.REMOVE_NO_DELETE);
    window.close();
  }

  function gdataOnLoad() {
    let calendar = window.gCalendar;
    if (calendar.type != "gdata") {
      return;
    }

    let accessRole = calendar.getProperty("settings.accessRole");
    let isReader = accessRole == "freeBusyReader" || accessRole == "reader";
    let isEventsCalendar = calendar.getProperty("capabilities.events.supported");
    let isDisabled = calendar.getProperty("disabled");


    let calendars = cal.manager.getCalendars();
    let hasDuplicate = calendars.find(eachcal => eachcal.type == NEW_GDATA_TYPE && eachcal.uri.spec == calendar.uri.spec);

    let upgradeFragment = window.MozXULElement.parseXULToFragment(UPGRADE_FRAGMENT);
    document.querySelector("dialog").appendChild(upgradeFragment);
    document.getElementById("gdata-legacy-upgrade-description").textContent =
      i18n("upgradeDescription" + (hasDuplicate ? ".duplicate" : ""));

    let button = document.getElementById("gdata-legacy-upgrade-button");

    button.setAttribute(
      "label",
      i18n(hasDuplicate ? "unsubscribeButton" : "upgradeButton")
    );
    button.dataset.action = hasDuplicate ? "unsubscribeButton" : "upgradeButton";
    button.addEventListener("click", gdataUpgrade);

    let link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `chrome://gdata-provider/content/old/properties.css?version=${version}`;
    document.head.appendChild(link);

    // Work around a bug where the notification is shown when imip is disabled
    if (calendar.getProperty("imip.identity.disabled")) {
      window.gIdentityNotification.removeAllNotifications();
    }

    // Disable setting read-only if the calendar is readonly anyway
    document.getElementById("read-only").disabled = isDisabled || (isEventsCalendar && isReader);

    // Don't allow setting refresh interval to less than 30 minutes
    let refInterval = document.getElementById("calendar-refreshInterval-menupopup");
    for (let node of [...refInterval.childNodes]) {
      let nodeval = parseInt(node.getAttribute("value"), 10);
      if (nodeval < 30 && nodeval != 0) {
        node.remove();
      }
    }
  }

  if (window.gCalendar) {
    gdataOnLoad();
  } else {
    monkeyPatch(window, "onLoad", (protofunc, ...args) => {
      let rv = protofunc(...args);
      gdataOnLoad();
      return rv;
    });
  }
}
