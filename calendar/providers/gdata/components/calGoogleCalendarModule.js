/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Google Calendar Provider code.
 *
 * The Initial Developer of the Original Code is
 *   Philipp Kewisch <mozilla@kewis.ch>
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

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
