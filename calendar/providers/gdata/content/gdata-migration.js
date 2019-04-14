/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from ../../../base/content/calendar-ui-utils.js */

var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

/**
 * Migrate the calendar selected in the wizard from ics to gdata.
 */
document.addEventListener("dialogaccept", () => {
    let listbox = document.getElementById("calendars-listbox");
    let calmgr = cal.getCalendarManager();

    for (let i = 0; i < listbox.childNodes.length; i++) {
        let item = listbox.childNodes[i];
        if (item.checked) {
            // Migrate the calendar to a gdata calendar
            let newCal = calmgr.createCalendar("gdata", item.calendar.uri);
            calmgr.removeCalendar(item.calendar);

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
    Services.prefs.setBoolPref("calendar.google.migrate",
                               document.getElementById("showagain-checkbox").checked);
});

/**
 * Get all calendars that are ics and point to a google calendar
 *
 * @return An array of calendars that are migratable
 */
function getMigratableCalendars() {
    function isMigratable(calendar) {
        let re = new RegExp("^http[s]?://(www|calendar)\\.google\\.com/calendar/ical/" +
                            "[^/]+/(private(-[^/]+)?|public)/" +
                            "(full|full-noattendees|composite|" +
                            "attendees-only|free-busy|basic)(\\.ics)?$");
        return calendar.type == "ics" && calendar.uri.spec.match(re);
    }

    return cal.getCalendarManager().getCalendars({}).filter(isMigratable);
}

/**
 * Load Handler for both the wizard and the Thunderbird main window.
 */
function gdata_migration_loader() {
    if (document.documentElement.id == "gdata-migration-wizard") {
        // This is the migration wizard, load the calendars needed.
        let listbox = document.getElementById("calendars-listbox");

        for (let calendar of sortCalendarArray(getMigratableCalendars())) {
            let item = document.createElement("checkbox");
            item.setAttribute("label", calendar.name);
            item.setAttribute("value", calendar.id);
            item.calendar = calendar;
            listbox.appendChild(item);
        }

        // Set up the "always check" field
        document.getElementById("showagain-checkbox").checked =
            Services.prefs.getBoolPref("calendar.google.migrate", true);
    } else if (Services.prefs.getBoolPref("calendar.google.migrate", true) &&
               getMigratableCalendars().length > 0) {
        // This is not the migration wizard, so it must be a main window. Check
        // if the migration wizard needs to be shown and calendars are worth
        // migrating.

        // Do this after load, so the calendar window appears before the
        // wizard is opened.
        // XXX Waiting a second gives the views enough time to display
        // right, at least on my system. The viewloaded event is quite
        // view specific, so there is no good non-hacked way to do this.
        setTimeout(() => {
            window.openDialog("chrome://gdata-provider/content/gdata-migration-wizard.xul",
                              "GdataMigrationWizard",
                              "chrome,titlebar,modal,alwaysRaised");
        }, 1000);
    }
}

// Add a Load handler to check for migratable calendars in the main window, or
// to load the migration wizard if this is the migration wizard
window.addEventListener("load", gdata_migration_loader, { capture: false, once: true });
