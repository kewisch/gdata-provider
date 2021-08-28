/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["gdataInitUI"];

function gdataInitUI(window, document) {
  ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
    "ui/gdata-lightning-item-iframe.jsm"
  );

  const { getMessenger } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );
  const { monkeyPatch } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );
  const { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
  let messenger = getMessenger();

  let { getCurrentCalendar } = window;

  (function() {
    /* initXUL */
    let defaultReminderItem = document.createXULElement("menuitem");
    defaultReminderItem.id = "gdata-reminder-default-menuitem";
    defaultReminderItem.label = messenger.i18n.getMessage("gdata.reminder.default");
    defaultReminderItem.value = "default";
    defaultReminderItem.setAttribute("provider", "gdata");

    let separator = document.getElementById("reminder-none-separator");
    separator.parentNode.insertBefore(defaultReminderItem, separator);
  })();

  monkeyPatch(window, "updateCalendar", function(protofunc, ...args) {
    let rv = protofunc.apply(this, args);
    let calendar = getCurrentCalendar();
    let isGoogleCalendar = calendar.type == "gdata";
    let isTask = window.calendarItem.isTodo();
    let isEvent = window.calendarItem.isEvent();
    let isGoogleTask = isGoogleCalendar && isTask;
    let isGoogleEvent = isGoogleCalendar && isEvent;

    window.sendMessage({ command: "gdataIsTask", isGoogleTask: isGoogleTask });

    let hideForTaskIds = [
      "FormatToolbox",
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
      "event-grid-alarm-separator",
    ];

    for (let id of hideForTaskIds) {
      let node = document.getElementById(id);
      if (node) {
        node.hidden = isGoogleTask;
      }
    }

    document
      .getElementById("todo-duedate")
      .querySelector(".datetimepicker-timepicker").style.display = isGoogleTask ? "none" : "";

    if (window.gEndTime) {
      if (isGoogleTask) {
        let floating = cal.dtz.floating;
        if (window.gEndTimezone != floating) {
          window.gOldEndTimezone = window.gEndTimezone;
        }
        window.gEndTimezone = cal.dtz.floating;
        window.gEndTime = window.gEndTime.getInTimezone(window.gEndTimezone);
        window.gEndTime.isDate = true;
      } else {
        if (window.gOldEndTimezone) {
          window.gEndTimezone = window.gOldEndTimezone;
        }
        window.gEndTime.isDate = false;
        window.gEndTime = window.gEndTime.getInTimezone(window.gEndTimezone);
      }
      window.updateDateTime();
    }

    for (let elem of document.getElementsByAttribute("provider", "gdata")) {
      elem.style.display = isGoogleCalendar ? "" : "none";
    }

    let reminderList = document.getElementById("item-alarm");
    let hasDefaultReminders = isGoogleEvent && calendar.getProperty("settings.defaultReminders");
    if (isGoogleCalendar && !hasDefaultReminders && reminderList.value == "default") {
      reminderList.value = "none";
    }

    let defaultReminderItem = document.getElementById("gdata-reminder-default-menuitem");
    defaultReminderItem.style.display = hasDefaultReminders ? "" : "none";

    // Remove categories for Google Tasks
    let categoriesLabel = document.getElementById("item-categories-label");
    let calendarLabel = document.getElementById("item-calendar-label");
    if (!categoriesLabel.origLabel) {
      categoriesLabel.origLabel = categoriesLabel.value;
    }

    let itemCategories = document.getElementById("item-categories");

    if (isGoogleTask) {
      itemCategories.setAttribute("hidden", "true");
      calendarLabel.setAttribute("hidden", "true");
    } else {
      itemCategories.removeAttribute("hidden");
      calendarLabel.removeAttribute("hidden");
    }

    categoriesLabel.value = isGoogleTask ? calendarLabel.value : categoriesLabel.origLabel;

    return rv;
  });

  monkeyPatch(window, "updateCategoryMenulist", function(protofunc, ...args) {
    let rv;
    let calendar = window.getCurrentCalendar();
    if (calendar.type == "gdata" && window.calendarItem.isTodo()) {
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
      let iconBox = document.querySelector(".alarm-icons-box");
      while (iconBox.firstChild) {
        iconBox.firstChild.remove();
      }
    }

    return rv;
  });

  monkeyPatch(window, "saveReminder", function(protofunc, item, ...args) {
    let calendar = window.getCurrentCalendar();
    let reminderList = document.getElementById("item-alarm");
    if (calendar.type == "gdata" && reminderList.value == "default") {
      item.clearAlarms();
      let unwrappedCal = item.calendar.getProperty("cache.uncachedCalendar").wrappedJSObject;
      let defaultReminders = unwrappedCal.defaultReminders || [];

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
    let calendar = window.getCurrentCalendar().getProperty("cache.uncachedCalendar");
    let unwrappedCal = calendar && calendar.wrappedJSObject;
    let defaultReminders = unwrappedCal.defaultReminders
      ? unwrappedCal.defaultReminders.concat([])
      : [];
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
      // eslint-disable-next-line no-undef
      window.gLastAlarmSelection = reminderList.selectedIndex;
    } else {
      rv = protofunc.call(this, reminders, ...args);
    }
    return rv;
  });

  monkeyPatch(window, "editReminder", function(protofunc, ...args) {
    let rv = protofunc.apply(this, args);

    // Now that the custom reminders were changed, we need to remove the
    // default alarm status, otherwise the wrong alarm will be set.
    let customItem = document.querySelector(".reminder-custom-menuitem");
    if (customItem.reminders) {
      for (let reminder of customItem.reminders) {
        reminder.deleteProperty("X-DEFAULT-ALARM");
      }
    }

    return rv;
  });
}
