/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export function gdataInitUI(window, document, version) {
  const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
  const { monkeyPatch, getMessenger } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/gdataUtils.sys.mjs?version=${version}`
  );
  const { CONFERENCE_ROW_FRAGMENT, initConferenceRow } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/ui/gdata-dialog-utils.sys.mjs?version=${version}`
  );
  const messenger = getMessenger();
  const GDATA_CALENDAR_TYPE = "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}";

  const { getCurrentCalendar } = window;

  (function() {
    /* initXUL */
    let defaultReminderItem = document.createXULElement("menuitem");
    defaultReminderItem.id = "gdata-reminder-default-menuitem";
    defaultReminderItem.label = messenger.i18n.getMessage("gdata.reminder.default");
    defaultReminderItem.value = "default";
    defaultReminderItem.setAttribute("provider", GDATA_CALENDAR_TYPE);

    let separator = document.getElementById("reminder-none-separator");
    separator.parentNode.insertBefore(defaultReminderItem, separator);

    let link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `chrome://gdata-provider/content/conference.css?version=${version}`;
    document.head.appendChild(link);

    let confFragment = window.MozXULElement.parseXULToFragment(CONFERENCE_ROW_FRAGMENT);
    document
      .getElementById("event-grid")
      .insertBefore(confFragment, document.getElementById("event-grid-location-row").nextSibling);

    // Fix an annoying bug, this should be upstreamed
    document.getElementById("url-link").style.maxWidth = "42em";
  })();

  monkeyPatch(window, "updateCalendar", function(protofunc, ...args) {
    let rv = protofunc.apply(this, args);
    let calendar = getCurrentCalendar();
    let isGoogleCalendar = calendar.type == GDATA_CALENDAR_TYPE;
    let isTask = window.calendarItem.isTodo();
    let isEvent = window.calendarItem.isEvent();
    let isGoogleTask = isGoogleCalendar && isTask;
    let isGoogleEvent = isGoogleCalendar && isEvent;
    let isOooEvent =
      isGoogleCalendar && window.calendarItem.getProperty("X-GOOGLE-EVENT-TYPE") == "outOfOffice";
    let isFocusEvent =
      isGoogleCalendar && window.calendarItem.getProperty("X-GOOGLE-EVENT-TYPE") == "focusTime";

    window.sendMessage({ command: "gdataIsTask", isGoogleTask: isGoogleTask });

    // Hide/show all elements with provider=GDATA_CALENDAR_TYPE
    for (let elem of document.getElementsByAttribute("provider", GDATA_CALENDAR_TYPE)) {
      elem.style.display = isGoogleCalendar ? "" : "none";
    }

    if (isEvent) {
      // Show a notification to indicate OOO and focus time events
      if (isOooEvent || isFocusEvent) {
        window.gEventNotification.appendNotification("gdata-info-event-type", {
          label: messenger.i18n.getMessage(
            "eventdialog." + (isOooEvent ? "oooEvent" : "focusEvent")
          ),
          priority: window.gEventNotification.PRIORITY_INFO_LOW,
        });
      }

      // Hide elements not valid in OOO events
      let hideForOooIds = [
        "event-grid-location-row",
        "event-grid-category-row",
        "event-grid-alarm-row",
      ];
      for (let id of hideForOooIds) {
        let node = document.getElementById(id);
        if (node) {
          node.hidden = isOooEvent;
        }
      }
      document.getElementById("event-grid-tab-box-row").style.visibility = isOooEvent
        ? "hidden"
        : "";

      // Hide elements not valid in focus time events
      let hideForFocusIds = [
        "event-grid-tab-attendees",
        "event-grid-tabpanel-attendees",
        "notify-options",
      ];
      for (let id of hideForFocusIds) {
        let node = document.getElementById(id);
        if (node) {
          node.hidden = isFocusEvent;
        }
      }

      // Update conference row
      initConferenceRow(document, messenger, window.calendarItem, calendar);

      // Set up default reminder items
      let reminderList = document.getElementById("item-alarm");
      let hasDefaultReminders = isGoogleEvent && calendar.getProperty("settings.defaultReminders");
      if (isGoogleCalendar && !hasDefaultReminders && reminderList.value == "default") {
        reminderList.value = "none";
      }

      let defaultReminderItem = document.getElementById("gdata-reminder-default-menuitem");
      defaultReminderItem.style.display = hasDefaultReminders ? "" : "none";
    } else if (isTask) {
      // Hide elements not valid for tasks
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
      // Hide end time for the tasks due date picker
      document
        .getElementById("todo-duedate")
        .querySelector(".datetimepicker-timepicker").style.display = isGoogleTask ? "none" : "";

      // Adjust timezones for Google Tasks
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

      // Remove categories for Google Tasks
      let categoriesLabel = document.getElementById("item-categories-label");
      let itemCategories = document.getElementById("item-categories");

      if (isGoogleTask) {
        itemCategories.setAttribute("hidden", "true");
        categoriesLabel.setAttribute("hidden", "true");
      } else {
        itemCategories.removeAttribute("hidden");
        categoriesLabel.removeAttribute("hidden");
      }

      // Update conference row (to hide it)
      initConferenceRow(document, messenger, window.calendarItem, calendar);
    }

    return rv;
  });

  monkeyPatch(window, "updateCategoryMenulist", function(protofunc, ...args) {
    let rv;
    let calendar = window.getCurrentCalendar();
    if (calendar.type == GDATA_CALENDAR_TYPE && window.calendarItem.isTodo()) {
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
    if (calendar.type == GDATA_CALENDAR_TYPE && reminderList.value == "default") {
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

    if (calendar.type == GDATA_CALENDAR_TYPE && (window.mode == "new" || usesDefault)) {
      // If all reminders are default reminders, then select the menuitem.
      reminderList.value = "default";

      // remember the selected index
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

  const IGNORE_PROPS = [
    "SEQUENCE",
    "DTSTAMP",
    "LAST-MODIFIED",
    "X-MOZ-GENERATION",
    "X-MICROSOFT-DISALLOW-COUNTER",
    "X-MOZ-SEND-INVITATIONS",
    "X-MOZ-SEND-INVITATIONS-UNDISCLOSED",
    "X-DEFAULT-ALARM",
  ];

  monkeyPatch(window, "isItemChanged", function(protofunc, ...args) {
    let calendar = window.getCurrentCalendar();
    if (calendar.type == GDATA_CALENDAR_TYPE) {
      let newItem = window.saveItem();
      let oldItem = window.calendarItem;
      return (
        newItem.calendar.id != oldItem.calendar.id ||
        !cal.item.compareContent(newItem, oldItem, IGNORE_PROPS)
      );
    } else {
      return protofunc.apply(this, args);
    }
  });

  monkeyPatch(window, "saveDialog", function(protofunc, item, ...args) {
    let res = protofunc.call(this, item, ...args);

    if (item.calendar.type == GDATA_CALENDAR_TYPE) {
      let confOption = document.getElementById("gdata-conf-new");
      if (confOption.value) {
        item.setProperty("X-GOOGLE-CONFNEW", confOption.value);
      }

      let rowmode = document.getElementById("gdata-conference-row").getAttribute("mode");

      if (rowmode == "delete") {
        item.deleteProperty("X-GOOGLE-CONFDATA");
      }
    }

    return res;
  });
}
