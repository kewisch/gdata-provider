/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm").shimIt(this);

CuImport("resource://calendar/modules/calUtils.jsm", this);
CuImport("resource://gre/modules/Preferences.jsm", this);

/**
 * Migrate the calendar selected in the wizard from ics to gdata.
 */
function migrateSelectedCalendars() {
    let listbox = document.getElementById("calendars-listbox");
    let calmgr = cal.getCalendarManager();

    for (let i = 0; i < listbox.childNodes.length; i++) {
        let item = listbox.childNodes[i];
        if (item.checked) {
            // Migrate the calendar to a gdata calendar
            let newCal = calmgr.createCalendar("gdata", item.calendar.uri);
            if (calmgr.removeCalendar) {
                // Lightning 4.0+
                calmgr.removeCalendar(item.calendar);
            } else {
                calmgr.unregisterCalendar(item.calendar);
                calmgr.deleteCalendar(item.calendar);
            }

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
    Preferences.set("calendar.google.migrate",
                    document.getElementById("showagain-checkbox").checked);
}

/**
 * Get all calendars that are ics and point to a google calendar
 *
 * @return An array of calendars that are migratable
 */
function getMigratableCalendars() {
    function isMigratable(c) {
        let re = new RegExp("^http[s]?://www\\.google\\.com/calendar/ical/" +
                            "[^/]+/(private(-[^/]+)?|public)/" +
                            "(full|full-noattendees|composite|" +
                            "attendees-only|free-busy|basic)(\\.ics)?$");
        return c.type == "ics" && c.uri.spec.match(re);
    }

    return getCalendarManager().getCalendars({}).filter(isMigratable);
}

/**
 * Load Handler for both the wizard and the Thunderbird main window.
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
            Preferences.get("calendar.google.migrate", true);
    } else {
        // This is not the migration wizard, so it must be a main window. Check
        // if the migration wizard needs to be shown.
        if (Preferences.get("calendar.google.migrate", true)) {
            // Check if there are calendars that are worth migrating.
            if (getMigratableCalendars().length > 0) {
                // Do this after load, so the calendar window appears before the
                // wizard is opened.

                // XXX Waiting a second gives the views enough time to display
                // right, at least on my system. The viewloaded event is quite
                // view specific, so there is no good non-hacked way to do this.
                setTimeout(function() {
                    window.openDialog("chrome://gdata-provider/content/gdata-migration-wizard.xul",
                                      "GdataMigrationWizard",
                                      "chrome,titlebar,modal,alwaysRaised");
                }, 1000);
            }
        }
    }
}

// Add a Load handler to check for migratable calendars in the main window, or
// to load the migration wizard if this is the migration wizard
window.addEventListener("load", gdata_migration_loader, false);
