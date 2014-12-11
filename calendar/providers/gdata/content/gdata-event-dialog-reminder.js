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

    function checkReminderRange(reminder) {
        let offset = cal.alarms.calculateAlarmOffset(item, reminder);
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
        return rv;
    });
})();
