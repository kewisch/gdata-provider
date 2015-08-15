/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gdata-provider/modules/gdataUtils.jsm");

(function() {

    // Older versions of Lightning don't have this variable.
    if (!("gOldEndTimezone" in window)) {
        window.gOldEndTimezone = null;
    }

    monkeyPatch(window, "updateCalendar", function(protofunc /*, ...args */) {
        let rv = protofunc.apply(this, Array.slice(arguments, 1));
        let calendar = getCurrentCalendar();
        let isGoogleCalendar = (calendar.type == "gdata");
        let isTask = cal.isToDo(window.calendarItem);
        let isEvent = cal.isEvent(window.calendarItem);
        let isGoogleTask = isGoogleCalendar && isTask;
        let isGoogleEvent = isGoogleCalendar && isEvent;

        let hideForTaskIds = [
            "event-grid-location-row",

            "event-grid-startdate-row",
            "timezone-endtime",
            "link-image-bottom",

            "event-grid-attendee-row",
            "event-grid-attendee-row-2",

            "todo-status-none-menuitem",
            "todo-status-inprogress-menuitem",
            "todo-status-canceled-menuitem",

            "percent-complete-textbox",
            "percent-complete-label",

            "event-grid-recurrence-row",
            "event-grid-recurrence-separator",

            "event-grid-alarm-row",
            "event-grid-alarm-separator",

            "status-privacy",
            "status-priority"
        ];

        let disableForTaskIds = [
            "options-attachments-menu",
            "options-attendess-menuitem",
            "options-privacy-menu",
            "options-priority-menu",
            "options-freebusy-menu",
            "button-attendees",
            "button-privacy",
            "button-url"
        ];

        for each (let id in hideForTaskIds) {
            let node = document.getElementById(id);
            if (node) {
                node.hidden = isGoogleTask;
            }
        }

        for each (let id in disableForTaskIds) {
            let node = document.getElementById(id);
            if (node) {
                node.disabled = isGoogleTask;
            }
        }

        let duedate = document.getElementById("todo-duedate");
        let duetime = document.getAnonymousElementByAttribute(duedate, "anonid", "time-picker");
        duetime.style.display = isGoogleTask ? "none" : "";

        if (gEndTime) {
            if (isGoogleTask) {
                let floating = cal.floating();
                if (gEndTimezone != floating) {
                  gOldEndTimezone = gEndTimezone;
                }
                gEndTimezone = cal.floating();
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
        for each (let elem in Array.slice(elements)) {
            elem.style.display = isGoogleCalendar ? "" : "none";
        }

        let reminderList = document.getElementById("item-alarm");
        let hasDefaultReminders = isGoogleEvent && calendar.getProperty("settings.defaultReminders");
        if (isGoogleCalendar && !hasDefaultReminders && reminderList.value == "default") {
            reminderList.value = "none";
        }

        document.getElementById("gdata-reminder-default-menuitem").style.display = hasDefaultReminders ? "" : "none";

        // Older versions of Lightning don't update the category menulist.
        if (!document.getElementById("item-categories-panel")) {
            let categoriesLabel = document.getElementById("event-grid-category-color-row").firstChild;
            let calendarLabel = document.getElementById("item-categories").nextSibling;
            if (!categoriesLabel.origLabel) categoriesLabel.origLabel = categoriesLabel.value;

            setBooleanAttribute("item-categories", "hidden", isGoogleTask);
            setBooleanAttribute(calendarLabel, "hidden", isGoogleTask);

            if (isGoogleTask) {
                categoriesLabel.value = calendarLabel.value;
            } else {
                categoriesLabel.value = categoriesLabel.origLabel;
            }
        }
        return rv;
    });

    monkeyPatch(window, "updateCategoryMenulist", function(protofunc /*, ...args */) {
        let args = Array.slice(arguments, 1);
        let rv;
        let calendar = getCurrentCalendar();
        if (calendar.type == "gdata" && cal.isToDo(window.calendarItem)) {
            let unwrappedCal = calendar.getProperty("cache.uncachedCalendar").wrappedJSObject;
            unwrappedCal.mProperties['capabilities.categories.maxCount'] = 0;
            rv = protofunc.apply(this, args);
            delete unwrappedCal.mProperties['capabilities.categories.maxCount'];
        } else {
            rv = protofunc.apply(this, args);
        }
        return rv;
    });

    monkeyPatch(window, "updateReminderDetails", function(protofunc /*, ...args */) {
        let rv = protofunc.apply(this, Array.slice(arguments, 1));
        let reminderList = document.getElementById("item-alarm");

        if (reminderList.value == "default") {
            removeChildren("reminder-icon-box");
        }

        return rv;
    });

    monkeyPatch(window, "saveReminder", function(protofunc, item /*, ...args */) {
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
            return protofunc.apply(this, Array.slice(arguments, 1));
        }
    })

    monkeyPatch(window, "loadReminders", function(protofunc, reminders /*, ...args */) {
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
            usesDefault = reminders.every(function(x) { return x.hasProperty("X-DEFAULT-ALARM"); });
        } else {
            usesDefault = window.calendarItem.getProperty("X-DEFAULT-ALARM") == "TRUE";
        }

        if (calendar.type == "gdata" && (window.mode == "new" || usesDefault)) {
            // If all reminders are default reminders, then select the menuitem.
            reminderList.value = "default";

            // remember the selected index
            gLastAlarmSelection = reminderList.selectedIndex;
        } else {
            rv = protofunc.apply(this, Array.slice(arguments, 1));
        }
        return rv;
    });

    monkeyPatch(window, "editReminder", function(protofunc /*, ...args */) {
        let rv = protofunc.apply(this, Array.slice(arguments, 1));

        // Now that the custom reminders were changed, we need to remove the
        // default alarm status, otherwise the wrong alarm will be set.
        let customItem = document.getElementById("reminder-custom-menuitem");
        if (customItem.reminders) {
            for each (let reminder in customItem.reminders) {
                reminder.deleteProperty("X-DEFAULT-ALARM");
            }
        }

        return rv;
    });
})();
