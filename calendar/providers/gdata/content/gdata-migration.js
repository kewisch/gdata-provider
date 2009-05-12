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
 * The Original Code is Provider for Google Calendar code.
 *
 * The Initial Developer of the Original Code is
 *   Philipp Kewisch <mozilla@kewis.ch>
 * Portions created by the Initial Developer are Copyright (C) 2008
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

/**
 * Migrate the calendar selected in the wizard from ics to gdata.
 */
function migrateSelectedCalendars() {
    var listbox = document.getElementById("calendars-listbox");
    var calmgr = getCalendarManager();

    for (var i = 0; i < listbox.childNodes.length; i++) {
        var item = listbox.childNodes[i];
        if (item.checked) {
            // Migrate the calendar to a gdata calendar
            var newCal = calmgr.createCalendar("gdata", item.calendar.uri);
            calmgr.unregisterCalendar(item.calendar);
            calmgr.deleteCalendar(item.calendar);

            // Copy some properties to the new calendar
            newCal.name = item.calendar.name;
            newCal.setProperty("color",
                               item.calendar.getProperty("color"));
            newCal.setProperty("disabled",
                               item.calendar.getProperty("disabled"));
            newCal.setProperty("cache.enabled",
                               item.calendar.getProperty("cache.enabled"));
            newCal.setProperty("suppressAlarms",
                               item.calendar.getProperty("suppressAlarms"));
            newCal.setProperty("calendar-main-in-composite",
                               item.calendar.getProperty("calendar-main-in-composite"));
            newCal.setProperty("calendar-main-default",
                               item.calendar.getProperty("calendar-main-default"));

            calmgr.registerCalendar(newCal);
        }
    }

    // Only bring up the dialog on the next startup if the user wants us to.
    setPref("calendar.google.migrate",
            document.getElementById("showagain-checkbox").checked);
}

/**
 * Get all calendars that are ics and point to a google calendar
 *
 * @return An array of calendars that are migratable
 */
function getMigratableCalendars() {
    function isMigratable(c) {
        var re = new RegExp("^http[s]?://www\\.google\\.com/calendar/ical/" +
                            "[^/]+/(private(-[^/]+)?|public)/" +
                            "(full|full-noattendees|composite|" +
                            "attendees-only|free-busy|basic)(\\.ics)?$");
        return c.type == "ics" && c.uri.spec.match(re);
    }

    return getCalendarManager().getCalendars({}).filter(isMigratable);
}

/**
 * Load Handler for both the wizard and the Sunbird/Thunderbird main windows.
 */
function gdata_migration_loader() {
    // Only load once
    window.removeEventListener("load", gdata_migration_loader, false);

    if (document.documentElement.id == "gdata-migration-wizard") {
        // This is the migration wizard, load the calendars neeeded.
        let listbox = document.getElementById("calendars-listbox");

        for each (let calendar in sortCalendarArray(getMigratableCalendars())) {
            let item = listbox.appendItem(calendar.name, calendar.id);
            item.setAttribute("type", "checkbox");
            item.calendar = calendar;
        }

        // Set up the "always check" field
        document.getElementById("showagain-checkbox").checked =
            getPrefSafe("calendar.google.migrate", true);
    } else {
        // This is not the migration wizard, so it must be a main window. Check
        // if the migration wizard needs to be shown.
        if (getPrefSafe("calendar.google.migrate", true)) {
            // Check if there are calendars that are worth migrating.
            if (getMigratableCalendars().length > 0) {
                // Do this after load, so the calendar window appears before the
                // wizard is opened.

                // XXX Waiting a second gives the views enough time to display
                // right, at least on my system. The viewloaded event is quite
                // view specific, so there is no good non-hacked way to do this.
                setTimeout(function() {
                    window.openDialog("chrome://gdata-provider/content/gdata-migration-wizard.xul",
                                      "gdata-migration-wizard",
                                      "chrome,titlebar,modal,alwaysRaised");
                }, 1000);
            }
        }
    }
}

// Add a Load handler to check for migratable calendars in the main window, or
// to load the migration wizard if this is the migration wizard
window.addEventListener("load", gdata_migration_loader, false);
