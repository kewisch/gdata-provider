/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from ../../../lightning/content/lightning-calendar-properties.js */

var { monkeyPatch } = ChromeUtils.import("resource://gdata-provider/modules/gdataUtils.jsm");

window.addEventListener("load", () => {
  if (document.getElementById("calendar-uri").value) {
    // Calendar's load function needs to be called first, and that seems to have happened.
    gdataOnLoad();
  } else {
    // onLoad has not yet been called, so we can piggyback on that function.
    monkeyPatch(window, "onLoad", (protofunc, ...args) => {
      let rv = protofunc(...args);
      gdataOnLoad();
      return rv;
    });
  }
});

function gdataOnLoad() {
  if (gCalendar.type == "gdata") {
    let accessRole = gCalendar.getProperty("settings.accessRole");
    let isReader = accessRole == "freeBusyReader" || accessRole == "reader";
    let isEventsCalendar = gCalendar.getProperty("capabilities.events.supported");
    let isDisabled = gCalendar.getProperty("disabled");

    // Disable setting read-only if the calendar is readonly anyway
    document.getElementById("read-only").disabled = isDisabled || (isEventsCalendar && isReader);
    // Don't allow setting refresh interval to less than 30 minutes
    let refInterval = document.getElementById("calendar-refreshInterval-menupopup");
    Array.from(refInterval.childNodes)
      .filter(node => {
        let nodeval = parseInt(node.getAttribute("value"), 10);
        return nodeval < 30 && nodeval != 0;
      })
      .forEach(node => {
        refInterval.removeChild(node);
      });
  }
}
