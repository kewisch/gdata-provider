/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["gdataInitUI"];

function gdataInitUI(window, document) {
  ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
    "ui/gdata-event-dialog-reminder.jsm"
  );

  let item = window.arguments[0].item;
  let calendar = window.arguments[0].calendar;
  if (calendar.type != "gdata") {
    return;
  }

  const FOUR_WEEKS_BEFORE = -2419200;
  const { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
  const { monkeyPatch, getMessenger } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );

  let messenger = getMessenger();
  let reminderOutOfRange = messenger.i18n.getMessage("reminderOutOfRange");
  let notificationbox;
  let checkPending;

  function calculateAlarmOffset(aItem, aAlarm, aRelated) {
    let offset = aAlarm.offset;
    if (aAlarm.related == Ci.calIAlarm.ALARM_RELATED_ABSOLUTE) {
      let returnDate;
      if (aRelated === undefined || aRelated == Ci.calIAlarm.ALARM_RELATED_START) {
        returnDate = aItem[cal.dtz.startDateProp(aItem)];
      } else if (aRelated == Ci.calIAlarm.ALARM_RELATED_END) {
        returnDate = aItem[cal.dtz.endDateProp(aItem)];
      }

      if (returnDate && aAlarm.alarmDate) {
        offset = aAlarm.alarmDate.subtractDate(returnDate);
      }
    }
    return offset;
  }

  function checkReminderRange(reminder) {
    let alarm;
    let offset = calculateAlarmOffset(item, reminder);
    let seconds = offset.inSeconds;
    return seconds < 1 && seconds >= FOUR_WEEKS_BEFORE;
  }

  function checkAllReminders() {
    if (checkAllReminders.pending) {
      return checkAllReminders.pending;
    }
    checkAllReminders.pending = checkAllRemindersAsync().finally(() => {
      checkAllReminders.pending = null;
    });
    return checkAllReminders.pending;
  }

  async function checkAllRemindersAsync() {
    let listbox = document.getElementById("reminder-listbox");

    let validated = true;
    for (let node of listbox.querySelectorAll("richlistitem")) {
      validated = validated && checkReminderRange(node.reminder);
      if (!validated) {
        break;
      }
    }

    let acceptButton = document
      .querySelector("#calendar-event-dialog-reminder dialog")
      .getButton("accept");
    acceptButton.disabled = !validated;

    if (!notificationbox) {
      notificationbox = new window.MozElements.NotificationBox(element => {
        element.setAttribute("flex", "1");
        document.getElementById("reminder-notifications").append(element);
      });
    }

    if (validated) {
      notificationbox.removeAllNotifications();
    } else if (!notificationbox.getNotificationWithValue("reminderNotification")) {
      let notification = await notificationbox.appendNotification("reminderNotification", {
        label: reminderOutOfRange,
        priority: notificationbox.PRIORITY_CRITICAL_HIGH,
      });

      notification.closeButton.style.display = "none";
    }
  }

  monkeyPatch(window, "updateReminder", function(protofunc, event) {
    let rv = protofunc.apply(this, Array.from(arguments).slice(1));
    if (
      window.suppressListUpdate ||
      event.target.localName == "richlistitem" ||
      event.target.parentNode.localName == "richlistitem" ||
      event.target.id == "reminder-remove-button" ||
      !document.commandDispatcher.focusedElement
    ) {
      // Same hack from the original dialog
      return undefined;
    }

    checkAllReminders();
    return rv;
  });

  monkeyPatch(window, "loadReminders", function(protofunc, ...args) {
    let rv = protofunc.apply(this, args);
    checkAllReminders();

    // Hides the "after the event starts" reminder relations, these are not supported by Google.
    document.getElementById("reminder-after-start-menuitem").hidden = true;
    document.getElementById("reminder-after-end-menuitem").hidden = true;
    return rv;
  });
}
