/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global MozElements */

/* import-globals-from ../../../base/content/dialogs/calendar-event-dialog-reminder.js */

(function() {
  const FOUR_WEEKS_BEFORE = -2419200;
  const { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");
  const { monkeyPatch, getProviderString } = ChromeUtils.import(
    "resource://gdata-provider/modules/gdataUtils.jsm"
  );
  const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

  XPCOMUtils.defineLazyGetter(this, "notificationbox", () => {
    return new MozElements.NotificationBox(element => {
      element.setAttribute("flex", "1");
      document.getElementById("reminder-notifications").append(element);
    });
  });

  // NOTE: This function exits early if its not a gdata calendar
  let item = window.arguments[0].item;
  let calendar = window.arguments[0].calendar;
  if (calendar.type != "gdata") {
    return;
  }

  let label = getProviderString("reminderOutOfRange");

  function checkReminderRange(reminder) {
    let offset = cal.alarms.calculateAlarmOffset(item, reminder);
    let seconds = offset.inSeconds;
    return seconds < 1 && seconds >= FOUR_WEEKS_BEFORE;
  }

  function checkAllReminders() {
    let listbox = document.getElementById("reminder-listbox");

    let validated = true;
    for (let node of listbox.childNodes) {
      validated = validated && checkReminderRange(node.reminder);
      if (!validated) {
        break;
      }
    }

    let acceptButton = document.documentElement.getButton("accept");
    acceptButton.disabled = !validated;

    if (validated) {
      this.notificationbox.removeAllNotifications();
    } else {
      let notification = this.notificationbox.appendNotification(
        label,
        "reminderNotification",
        null,
        this.notificationbox.PRIORITY_CRITICAL_HIGH
      );

      let closeButton = notification.messageDetails.nextSibling;
      closeButton.setAttribute("hidden", "true");
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
    if (!Services.prefs.getBoolPref("calendar.google.enableSMSReminders", false)) {
      document.getElementById("reminder-action-SMS").hidden = true;
    }
  }

  monkeyPatch(window, "updateReminder", function(protofunc, event) {
    let rv = protofunc.apply(this, Array.from(arguments).slice(1));
    if (
      event.explicitOriginalTarget.localName == "listitem" ||
      event.explicitOriginalTarget.id == "reminder-remove-button" ||
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
    hideReminderRelations();
    hideSMSReminders();
    return rv;
  });
})();
