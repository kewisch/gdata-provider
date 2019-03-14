/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from ../../../lightning/content/lightning-item-iframe.js */
/* import-globals-from ../../../base/content/dialogs/calendar-dialog-utils.js */

var { monkeyPatch } = ChromeUtils.import("resource://gdata-provider/modules/gdataUtils.jsm");

var { cal } = ChromeUtils.import("resource://gdata-provider/modules/calUtilsShim.jsm");

(function() {
    monkeyPatch(window, "updateCalendar", function(protofunc, ...args) {
        let rv = protofunc.apply(this, args);
        let calendar = getCurrentCalendar();
        let isGoogleCalendar = (calendar.type == "gdata");
        let isTask = cal.item.isToDo(window.calendarItem);
        let isEvent = cal.item.isEvent(window.calendarItem);
        let isGoogleTask = isGoogleCalendar && isTask;
        let isGoogleEvent = isGoogleCalendar && isEvent;

        sendMessage({ command: "gdataIsTask", isGoogleTask: isGoogleTask });

        let hideForTaskIds = [
            "event-grid-location-row",

            "event-grid-startdate-row",
            "timezone-endtime",
            "link-image-bottom",

            "event-grid-tab-attendees",
            "event-grid-tabpanel-attendees",

            "todo-status-none-menuitem",
            "todo-status-inprogress-menuitem",
            "todo-status-canceled-menuitem",

            "percent-complete-textbox",
            "percent-complete-label",

            "event-grid-recurrence-row",
            "event-grid-recurrence-separator",

            "event-grid-alarm-row",
            "event-grid-alarm-separator"
        ];

        for (let id of hideForTaskIds) {
            let node = document.getElementById(id);
            if (node) {
                node.hidden = isGoogleTask;
            }
        }

        let duedate = document.getElementById("todo-duedate");
        let duetime = duedate._timepicker || // From Lightning 6.9 onwards
            document.getAnonymousElementByAttribute(duedate, "anonid", "time-picker");
        duetime.style.display = isGoogleTask ? "none" : "";

        if (gEndTime) {
            if (isGoogleTask) {
                let floating = cal.dtz.floating;
                if (gEndTimezone != floating) {
                    gOldEndTimezone = gEndTimezone;
                }
                gEndTimezone = cal.dtz.floating;
                gEndTime = gEndTime.getInTimezone(gEndTimezone);
                gEndTime.isDate = true;
            } else {
                if (gOldEndTimezone) {
                    gEndTimezone = gOldEndTimezone;
                }
                gEndTime.isDate = false;
                gEndTime = gEndTime.getInTimezone(gEndTimezone);
            }
            updateDateTime();
        }

        let elements = document.getElementsByAttribute("provider", "gdata");
        for (let elem of elements) {
            elem.style.display = isGoogleCalendar ? "" : "none";
        }

        let reminderList = document.getElementById("item-alarm");
        let hasDefaultReminders = isGoogleEvent && calendar.getProperty("settings.defaultReminders");
        if (isGoogleCalendar && !hasDefaultReminders && reminderList.value == "default") {
            reminderList.value = "none";
        }

        document.getElementById("gdata-reminder-default-menuitem").style.display = hasDefaultReminders ? "" : "none";

        // Remove categories for Google Tasks
        let categoriesLabel = document.getElementById("event-grid-category-color-row").firstChild;
        let calendarLabel = document.getElementById("item-categories").nextSibling;
        if (!categoriesLabel.origLabel) {
            categoriesLabel.origLabel = categoriesLabel.value;
        }

        setBooleanAttribute("item-categories", "hidden", isGoogleTask);
        setBooleanAttribute(calendarLabel, "hidden", isGoogleTask);

        if (isGoogleTask) {
            categoriesLabel.value = calendarLabel.value;
        } else {
            categoriesLabel.value = categoriesLabel.origLabel;
        }

        return rv;
    });

    monkeyPatch(window, "updateCategoryMenulist", function(protofunc, ...args) {
        let rv;
        let calendar = getCurrentCalendar();
        if (calendar.type == "gdata" && cal.item.isToDo(window.calendarItem)) {
            let unwrappedCal = calendar.getProperty("cache.uncachedCalendar").wrappedJSObject;
            unwrappedCal.mProperties["capabilities.categories.maxCount"] = 0;
            rv = protofunc.apply(this, args);
            delete unwrappedCal.mProperties["capabilities.categories.maxCount"];
        } else {
            rv = protofunc.apply(this, args);
        }
        return rv;
    });

    monkeyPatch(window, "updateReminderDetails", function(protofunc, ...args) {
        let rv = protofunc.apply(this, args);
        let reminderList = document.getElementById("item-alarm");

        if (reminderList.value == "default") {
            removeChildren("reminder-icon-box");
        }

        return rv;
    });

    monkeyPatch(window, "saveReminder", function(protofunc, item, ...args) {
        let calendar = getCurrentCalendar();
        let reminderList = document.getElementById("item-alarm");
        if (calendar.type == "gdata" && reminderList.value == "default") {
            item.clearAlarms();
            let unwrappedCal = item.calendar.getProperty("cache.uncachedCalendar").wrappedJSObject;
            let defaultReminders = unwrappedCal.defaultReminders;

            defaultReminders.forEach(item.addAlarm, item);
            if (!defaultReminders.length) {
                item.setProperty("X-DEFAULT-ALARM", "TRUE");
            }
            return null;
        } else {
            item.deleteProperty("X-DEFAULT-ALARM");
            return protofunc.call(this, item, ...args);
        }
    });

    monkeyPatch(window, "loadReminders", function(protofunc, reminders, ...args) {
        let reminderList = document.getElementById("item-alarm");

        // Set up the default reminders item
        let defaultItem = document.getElementById("gdata-reminder-default-menuitem");
        let calendar = getCurrentCalendar().getProperty("cache.uncachedCalendar");
        let unwrappedCal = calendar && calendar.wrappedJSObject;
        let defaultReminders = unwrappedCal.defaultReminders ? unwrappedCal.defaultReminders.concat([]) : [];
        defaultItem.reminders = defaultReminders;

        let rv = null;
        let usesDefault;
        if (reminders.length) {
            usesDefault = reminders.every(reminder => reminder.hasProperty("X-DEFAULT-ALARM"));
        } else {
            usesDefault = window.calendarItem.getProperty("X-DEFAULT-ALARM") == "TRUE";
        }

        if (calendar.type == "gdata" && (window.mode == "new" || usesDefault)) {
            // If all reminders are default reminders, then select the menuitem.
            reminderList.value = "default";

            // remember the selected index
            gLastAlarmSelection = reminderList.selectedIndex;
        } else {
            rv = protofunc.call(this, reminders, ...args);
        }
        return rv;
    });

    monkeyPatch(window, "editReminder", function(protofunc, ...args) {
        let rv = protofunc.apply(this, args);

        // Now that the custom reminders were changed, we need to remove the
        // default alarm status, otherwise the wrong alarm will be set.
        let customItem = document.getElementById("reminder-custom-menuitem");
        if (customItem.reminders) {
            for (let reminder of customItem.reminders) {
                reminder.deleteProperty("X-DEFAULT-ALARM");
            }
        }

        return rv;
    });
})();
