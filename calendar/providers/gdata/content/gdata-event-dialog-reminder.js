/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {
    const FOUR_WEEKS_BEFORE = -2419200;
    Components.utils.import("resource://gdata-provider/modules/gdataUtils.jsm");

    // NOTE: This function exits early if its not a gdata calendar
    let item = window.arguments[0].item;
    let calendar = window.arguments[0].calendar;
    if (calendar.type != "gdata") {
        return;
    }

    let label = getProviderString("reminderOutOfRange");
    let notification = createXULElement("notification");
    notification.setAttribute("label", label);
    notification.setAttribute("type", "critical");
    notification.setAttribute("hideclose", "true");

    function calculateAlarmOffset(item, reminder) {
        let offset = cal.alarms.calculateAlarmOffset(item, reminder);
        // bug 1196455: The offset calcuated for absolute alarms is flipped
        if (Services.vc.compare(Services.appinfo.platformVersion, "43.0") < 0) {
            if (reminder.related == reminder.ALARM_RELATED_ABSOLUTE) {
                offset.isNegative = !offset.isNegative;
            }
        }
        return offset;
    }

    function checkReminderRange(reminder) {
        let offset = calculateAlarmOffset(item, reminder);
        let seconds = offset.inSeconds;
        return (seconds < 1 && seconds >= FOUR_WEEKS_BEFORE);
    }

    function checkAllReminders() {
        let listbox = document.getElementById("reminder-listbox");
        let notificationbox = document.getElementById("reminder-notifications");

        let validated = true;
        for each (let node in Array.slice(listbox.childNodes)) {
            validated = validated && checkReminderRange(node.reminder);
            if (!validated) {
                break;
            }
        }

        let acceptButton = document.documentElement.getButton("accept");
        acceptButton.disabled = !validated;

        if (validated) {
            try {
                notificationbox.removeNotification(notification);
            } catch (e) {
                // Ok to swallow if it hasn't been added yet.
            }
        } else {
            notificationbox.appendChild(notification);
        }
    }

    /**
     * Hides the "after the event starts" reminder relations, these are not
     * supported by Google.
     */
    function hideReminderRelations() {
        document.getElementById("reminder-after-start-menuitem").hidden = true;
        document.getElementById("reminder-after-end-menuitem").hidden = true;
    }

    /**
     * SMS Reminders are only supported for Google Apps for Work, Education,
     * and Government. hide the menuitem if SMS reminders are not supported
     */
    function hideSMSReminders() {
        if (!Preferences.get("calendar.google.enableSMSReminders", false)) {
            document.getElementById("reminder-action-SMS").hidden = true;
        }
    }

    monkeyPatch(window, "updateReminder", function(protofunc, event) {
        let rv = protofunc.apply(this, Array.slice(arguments, 1));
        if (event.explicitOriginalTarget.localName == "listitem" ||
            event.explicitOriginalTarget.id == "reminder-remove-button" ||
            !document.commandDispatcher.focusedElement) {
            // Same hack from the original dialog
            return;
        }

        checkAllReminders();
        return rv;
    });

    monkeyPatch(window, "loadReminders", function(protofunc /*, ...args */) {
        let rv = protofunc.apply(this, Array.slice(arguments, 1));
        checkAllReminders();
        hideReminderRelations();
        hideSMSReminders();
        return rv;
    });
})();
