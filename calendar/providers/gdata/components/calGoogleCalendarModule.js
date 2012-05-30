/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");

// These constants are used internally to signal errors, to avoid the need for
// our own error range in calIErrors
const kGOOGLE_LOGIN_FAILED = 1;
const kGOOGLE_CONFLICT_DELETED = 2;
const kGOOGLE_CONFLICT_MODIFY = 3

/** Module Registration */
const calendarScriptLoadOrder = [
    "calUtils.js",
];

const gdataScriptLoadOrder = [
    "calGoogleCalendar.js",
    "calGoogleSession.js",
    "calGoogleRequest.js",
    "calGoogleUtils.js"
];

function NSGetFactory(cid) {
    if (!this.scriptsLoaded) {
        // First load the calendar scripts
        cal.loadScripts(calendarScriptLoadOrder, Components.utils.getGlobalForObject(this));

        // Now load gdata extension scripts. __LOCATION__ is the current
        // filename, so  __LOCATION__.parent == . We expect to find the
        // subscripts in ./../js
        let thisDir = __LOCATION__.parent.parent.clone();
        thisDir.append("js");
        cal.loadScripts(gdataScriptLoadOrder, Components.utils.getGlobalForObject(this), thisDir);
        this.scriptsLoaded = true;
    }

    let components = [
        calGoogleCalendar,
        calGoogleSession,
        calGoogleSessionManager,
        calGoogleRequest
    ];

    return (XPCOMUtils.generateNSGetFactory(components))(cid);
}
