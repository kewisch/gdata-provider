/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {
    Components.utils.import("resource://gdata-provider/modules/gdataUtils.jsm");
    monkeyPatch(window, "onLoad", function(protofunc, ...args) {
        let rv = protofunc.apply(this, args);
        if (gCalendar.type == "gdata") {
            let accessRole = gCalendar.getProperty("settings.accessRole");
            let isReader = (accessRole == "freeBusyReader" || accessRole == "reader");
            let isEventsCalendar = gCalendar.getProperty("capabilities.events.supported");
            let isDisabled = gCalendar.getProperty("disabled");

            // Disable setting read-only if the calendar is readonly anyway
            document.getElementById("read-only").disabled = isDisabled || (isEventsCalendar && isReader);

            // Don't allow setting refresh interval to less than 30 minutes
            let refInterval = document.getElementById("calendar-refreshInterval-menupopup");
            Array.from(refInterval.childNodes).filter(function(n) {
                let nv = parseInt(n.getAttribute("value"), 10);
                return nv < 30 && nv != 0;
            }).forEach(function(n) { refInterval.removeChild(n); });

            // Old Lightning doesn't hide the cache label
            let oldCacheLabel = document.getElementById("cache");
            if (oldCacheLabel) {
                oldCacheLabel.setAttribute("hidden", "true");
            }
        }
        return rv;
    });
})();
