/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["gdataInitUI"];

function gdataInitUI(window, document) {
  ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
    "ui/gdata-calendar-properties.jsm"
  );
  const { monkeyPatch } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );

  function gdataOnLoad() {
    let calendar = window.gCalendar;
    if (calendar.type != "gdata") {
      return;
    }

    let accessRole = calendar.getProperty("settings.accessRole");
    let isReader = accessRole == "freeBusyReader" || accessRole == "reader";
    let isEventsCalendar = calendar.getProperty("capabilities.events.supported");
    let isDisabled = calendar.getProperty("disabled");

    // Disable setting read-only if the calendar is readonly anyway
    document.getElementById("read-only").disabled = isDisabled || (isEventsCalendar && isReader);
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
