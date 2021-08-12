/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Migrate item metadata from aOldItem to aNewItem. If aOldItem is a recurring
 * event and an exception was turned into an EXDATE, the metadata will be
 * updated accordingly.
 *
 * @param aOfflineStorage   The offline storage that holds the metadata for this item.
 * @param aOldItem          The item to migrate from.
 * @param aNewItem          The item to migrate to.
 * @param aMetadata         The metadata for this new item.
 */
function migrateItemMetadata(aOfflineStorage, aOldItem, aNewItem, aMetadata) {
  if (aNewItem.status == "CANCELLED") {
    deleteItemMetadata(aOfflineStorage, aNewItem);
  } else {
    saveItemMetadata(aOfflineStorage, aNewItem.hashId, aMetadata);
  }

  // If an exception was turned into an EXDATE, we need to clear its metadata
  if (aOldItem.recurrenceInfo && aNewItem.recurrenceInfo) {
    let newExIds = new Set(
      aNewItem.recurrenceInfo.getExceptionIds({}).map(exception => exception.icalString)
    );
    for (let exId of aOldItem.recurrenceInfo.getExceptionIds({})) {
      if (!newExIds.has(exId.icalString)) {
        let ex = aOldItem.recurrenceInfo.getExceptionFor(exId);
        deleteItemMetadata(aOfflineStorage, ex);
      }
    }
  }
}

/**
 * Delete metadata for the given item.
 *
 * @param aOfflineStorage   The offline storage that holds the metadata for this item.
 * @param aItem             The item to delete metadata for.
 */
function deleteItemMetadata(aOfflineStorage, aItem) {
  aOfflineStorage.deleteMetaData(aItem.hashId);
  if (aItem.recurrenceInfo) {
    let recInfo = aItem.recurrenceInfo;
    for (let exId of recInfo.getExceptionIds({})) {
      let occ = recInfo.getExceptionFor(exId);
      aOfflineStorage.deleteMetaData(occ.hashId);
    }
  }
}

/**
 * Retrieve the item metadata for the given item
 *
 * @param aOfflineStorage   The offline storage that holds the metadata for this item.
 * @param aItem             The item to retrieve metadat for.
 */
function getItemMetadata(aOfflineStorage, aItem) {
  let data = null;
  let meta = aOfflineStorage.getMetaData(aItem.hashId);
  let parts = meta && meta.split("\u001A");
  if (parts && parts.length == 3) {
    data = { etag: parts[0], path: parts[1] };
  } else if (parts && parts.length == 1) {
    // Temporary migration for alpha versions of this provider.
    data = { etag: parts[0], path: aItem.getProperty("X-GOOGLE-ID") };
  }
  return data;
}

/**
 * Covnvert a calIDateTime date to the JSON object expected by Google.
 *
 * @param aDate     The date to convert.
 * @return          The converted JS Object.
 */
function dateToJSON(aDate) {
  let jsonData = {};
  let tzid = aDate.timezone.tzid;
  jsonData[aDate.isDate ? "date" : "dateTime"] = cal.dtz.toRFC3339(aDate);
  if (!aDate.isDate && tzid != "floating") {
    if (tzid in windowsTimezoneMap) {
      // A Windows timezone, likely an outlook invitation.
      jsonData.timeZone = windowsTimezoneMap[tzid];
      // eslint-disable-next-line no-useless-escape
    } else if (tzid.match(/^[^\/ ]+(\/[^\/ ]+){1,2}$/)) {
      // An Olson timezone id
      jsonData.timeZone = aDate.timezone.tzid;
    } else {
      // Uhh...something. Google requires a timezone id for recurring
      // events, we can fake it with Etc/ timezones.
      let full_tzoffset = aDate.timezoneOffset;
      let tzoffset_hr = Math.floor(Math.abs(full_tzoffset) / 3600);
      // sign for etc needs to be the opposite of the UTC tz offset sign
      let sign = full_tzoffset > 0 ? "-" : "+";
      if (tzoffset_hr == 0) {
        jsonData.timeZone = "UTC";
      } else {
        jsonData.timeZone = "Etc/GMT" + sign + tzoffset_hr;
      }
    }

    if (jsonData.timeZone) {
      // Strip the timezone offset if a timeZone was specified.
      jsonData.dateTime = jsonData.dateTime.replace(/[+-]\d{2}:\d{2}$/, "");

      // Strip the Z for zones other than UTC, this usually happens for
      // unknown timezones.
      if (jsonData.timeZone != "UTC") {
        jsonData.dateTime = jsonData.dateTime.replace(/Z$/, "");
      }
    }
  }
  return jsonData;
}

/**
 * Convert a JSON date object as received by Google into a calIDateTime.
 *
 * @param aEntry                The JSON entry to convert.
 * @param aTimezone             The timezone the date/dateTime is specified in.
 * @return                      The converted calIDateTime.
 */
function JSONToDate(aEntry, aTimezone) {
  let dateTime = null;
  if (!aEntry) {
    return null;
  }

  // The entry is provided in the default zone and the timezone is
  // specified separately.
  let entryDate = aEntry.dateTime || aEntry.date;
  dateTime = fromRFC3339FixedZone(entryDate, aTimezone);

  if (!dateTime) {
    return null;
  }

  if ("timeZone" in aEntry) {
    // If a timezone was specified, convert to that zone
    let zone = cal.getTimezoneService().getTimezone(aEntry.timeZone);
    if (zone) {
      dateTime = dateTime.getInTimezone(zone);
    }
  }
  return dateTime;
}

/**
 * Like cal.dtz.fromRFC3339(), but assumes that the passed timezone is the timezone
 * for the date. A quick check is done to make sure the offset matches the
 * timezone.
 *
 * @param aStr          The RFC3339 compliant Date String
 * @param aTimezone     The timezone this date string is in
 * @return              A calIDateTime object
 */
function fromRFC3339FixedZone(aStr, aTimezone) {
  let dateTime = cal.createDateTime();
  let matches = fromRFC3339FixedZone.regex.exec(aStr);

  if (!matches) {
    return null;
  }

  dateTime.isDate = matches[4] == null;
  dateTime.year = matches[1];
  dateTime.month = matches[2] - 1; // Jan is 0
  dateTime.day = matches[3];

  if (!dateTime.isDate) {
    dateTime.hour = matches[5];
    dateTime.minute = matches[6];
    dateTime.second = matches[7];
  }

  dateTime.timezone = aTimezone;
  if (matches[9] != null) {
    let offset_in_s = 0;
    if (matches[10] != null) {
      offset_in_s = (matches[11] == "-" ? -1 : 1) * (matches[11] * 3600 + matches[12] * 60);
    }

    if (dateTime.timezoneOffset != offset_in_s) {
      // Warn here, since this shouldn't be happening. Then use the
      // original fromRFC3339, which goes through the timezone list and
      // finds the first matching zone.
      cal.WARN(
        "[calGoogleCalendar] " + aStr + " does not match timezone offset for " + aTimezone.tzid
      );
      dateTime = cal.dtz.fromRFC3339(aStr, aTimezone);
    }
  }

  return dateTime;
}
fromRFC3339FixedZone.regex = new RegExp(
  "^([0-9]{4})-([0-9]{2})-([0-9]{2})" +
    "([Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(\\.[0-9]+)?)?" +
    "([Zz]|([+-])([0-9]{2}):([0-9]{2}))?"
);

/**
 * Like cal.dtz.toRFC3339, but include milliseconds. Google timestamps require
 * this.
 *
 * @param date      The calIDateTime to convert.
 * @return          The RFC3339 string stamp.
 */
function toRFC3339Fraction(date) {
  let str = cal.dtz.toRFC3339(date);
  return str ? str.replace(/(Z?)$/, ".000$1") : null;
}

/**
 * Converts a calIEvent to a JS Object that can be serialized to JSON.
 *
 * @param aItem         The item to convert.
 * @return              A JS Object representing the item.
 */
function EventToJSON(aItem, aOfflineStorage, aIsImport) {
  if (aIsImport && aItem.id) {
    itemData.iCalUID = aItem.id;
    setIf(itemData, "created", toRFC3339Fraction(aItem.creationDate));
    setIf(itemData, "updated", toRFC3339Fraction(aItem.lastModifiedTime));
  }

  // Only parse attendees if they are enabled, due to bug 407961
  if (Services.prefs.getBoolPref("calendar.google.enableAttendees", false)) {
    let createAttendee = function(attendee) {
      const statusMap = {
        "NEEDS-ACTION": "needsAction",
        DECLINED: "declined",
        TENTATIVE: "tentative",
        ACCEPTED: "accepted",
      };

      // TODO there seems to be code that either includes or doesn't include the organizer as an
      // attendee

      let attendeeData = {};
      if (aItem.organizer && aItem.organizer.id == attendee.id) {
        needsOrganizer = false;
      }
    };

    let needsOrganizer = true;

    if (aItem.organizer) {
      itemData.organizer = createAttendee(aItem.organizer);
      if (needsOrganizer) {
        attendeeData.push(itemData.organizer);
      }
    }
  }
}

/**
 * Sets up the recurrence info on the item
 *
 * @param aItem              The item to setup recurrence for.
 * @param aRecurrence        The JSON entry describing recurrence.
 */
function setupRecurrence(aItem, aRecurrence, aTimezone) {
  if (!aRecurrence) {
    return;
  }

  if (aItem.recurrenceInfo) {
    aItem.recurrenceInfo.clearRecurrenceItems();
  } else {
    aItem.recurrenceInfo = new CalRecurrenceInfo(aItem);
  }

  let rootComp;
  let vevent = "BEGIN:VEVENT\r\n" + aRecurrence.join("\r\n") + "\r\nEND:VEVENT";
  try {
    rootComp = cal.getIcsService().parseICS(vevent, null);
  } catch (e) {
    cal.ERROR("[calGoogleCalendar] Unable to parse recurrence item: " + vevent);
  }

  let hasRecurringRules = false;
  for (let prop = rootComp.getFirstProperty("ANY"); prop; prop = rootComp.getNextProperty("ANY")) {
    switch (prop.propertyName) {
      case "RDATE":
      case "EXDATE": {
        let recItem = Cc["@mozilla.org/calendar/recurrence-date;1"].createInstance(
          Ci.calIRecurrenceDate
        );
        try {
          recItem.icalProperty = prop;
          aItem.recurrenceInfo.appendRecurrenceItem(recItem);
          hasRecurringRules = true;
        } catch (e) {
          cal.ERROR(
            "[calGoogleCalendar] Error parsing " +
              prop.propertyName +
              " (" +
              prop.icalString +
              "):" +
              e
          );
        }
        break;
      }
      case "RRULE": {
        let recRule = cal.createRecurrenceRule();
        try {
          recRule.icalProperty = prop;
          aItem.recurrenceInfo.appendRecurrenceItem(recRule);
          hasRecurringRules = true;
        } catch (e) {
          cal.ERROR("[calGoogleCalendar] Error parsing RRULE (" + prop.icalString + "):" + e);
        }
        break;
      }
    }
  }

  if (!hasRecurringRules) {
    // If there were no parsable recurrence items, then clear the
    // recurrence info.
    aItem.recurrenceInfo = null;
  }
}

/**
 * Converts a JS Object representing the event to a calIEvent.
 *
 * @param aEntry            The JS Object representation of the item.
 * @param aCalendar         The calendar this item will belong to.
 * @param aDefaultReminders An array of default reminders, as a JS Object.
 * @param aMetadata         (optional,out) Item metadata that should be set.
 * @return                  The calIEvent with the item data.
 */
function JSONToEvent(aEntry, aCalendar, aDefaultReminders, aReferenceItem, aMetadata) {
  aDefaultReminders = aDefaultReminders || [];
  aMetadata = aMetadata || {};
  let item = aReferenceItem || new CalEvent();
  item.calendar = aCalendar.superCalendar;
  let privateProps = ("extendedProperties" in aEntry && aEntry.extendedProperties.private) || {};
  let sharedProps = ("extendedProperties" in aEntry && aEntry.extendedProperties.shared) || {};
  let accessRole = aCalendar.getProperty("settings.accessRole");

  LOGverbose("[calGoogleCalendar] Parsing entry:\n" + JSON.stringify(aEntry, null, " ") + "\n");

  if (!aEntry || !("kind" in aEntry) || aEntry.kind != "calendar#event") {
    cal.ERROR(
      "[calGoogleCalendar] Attempt to decode invalid event: " +
        (aEntry && JSON.stringify(aEntry, null, " "))
    );
    return null;
  }

  let tzs = cal.getTimezoneService();
  let calendarZoneName = aCalendar.getProperty("settings.timeZone");
  let calendarZone = calendarZoneName ? tzs.getTimezone(calendarZoneName) : cal.dtz.defaultTimezone;

  try {
    item.id = aEntry.iCalUID || (aEntry.recurringEventId || aEntry.id) + "@google.com";
    item.recurrenceId = JSONToDate(aEntry.originalStartTime, calendarZone);
    if (!item.recurrenceId) {
      // Sometimes recurring event instances don't have recurringEventId
      // set, but are still instances. work around by detecting the ID.
      // http://code.google.com/a/google.com/p/apps-api-issues/issues/detail?id=3199
      let hack = aEntry.id.match(/([^_]*)_(\d{8}(T\d{6}Z)?)$/);
      item.recurrenceId = hack ? cal.createDateTime(hack[2]) : null;
    }
    item.status = aEntry.status ? aEntry.status.toUpperCase() : null;
    item.title = aEntry.summary;
    if (accessRole == "freeBusyReader") {
      item.title = getMessenger().i18n.getMessage("busyTitle", aCalendar.name);
    }
    item.privacy = aEntry.visibility ? aEntry.visibility.toUpperCase() : null;

    item.setProperty(
      "URL",
      aEntry.htmlLink && aCalendar.uri.schemeIs("https")
        ? aEntry.htmlLink.replace(/^http:/, "https:")
        : aEntry.htmlLink
    );
    item.setProperty(
      "CREATED",
      aEntry.created
        ? cal.dtz.fromRFC3339(aEntry.created, calendarZone).getInTimezone(cal.dtz.UTC)
        : null
    );
    item.descriptionHTML = aEntry.description;
    item.setProperty("LOCATION", aEntry.location);
    item.setProperty("TRANSP", aEntry.transparency ? aEntry.transparency.toUpperCase() : null);
    item.setProperty("SEQUENCE", aEntry.sequence);
    aMetadata.etag = aEntry.etag;
    aMetadata.path = aEntry.id;

    // organizer
    if (aEntry.organizer) {
      let organizer = new CalAttendee();
      if (aEntry.organizer.email) {
        organizer.id = "mailto:" + aEntry.organizer.email;
      } else {
        organizer.id = "urn:id:" + aEntry.organizer.id;
      }
      organizer.commonName = aEntry.organizer.displayName;
      organizer.isOrganizer = true;
      item.organizer = organizer;

      if (aEntry.organizer.self && aCalendar.session) {
        // Remember the display name, we found ourselves!
        aCalendar.setProperty("organizerCN", aEntry.organizer.displayName);
      }
    } else {
      item.organizer = null;
    }

    // start and end
    item.startDate = JSONToDate(aEntry.start, calendarZone);
    item.endDate = JSONToDate(aEntry.end, calendarZone);

    // recurrence
    setupRecurrence(item, aEntry.recurrence, calendarZone);

    // attendees
    item.removeAllAttendees();
    if (aEntry.attendees) {
      const statusMap = {
        needsAction: "NEEDS-ACTION",
        declined: "DECLINED",
        tentative: "TENTATIVE",
        accepted: "ACCEPTED",
      };
      for (let attendeeEntry of aEntry.attendees) {
        let attendee = new CalAttendee();
        if (attendeeEntry.email) {
          attendee.id = "mailto:" + attendeeEntry.email;
        } else {
          attendee.id = "urn:id:" + attendeeEntry.id;
        }
        attendee.commonName = attendeeEntry.displayName;

        if (attendeeEntry.optional) {
          attendee.role = "OPT-PARTICIPANT";
        } else {
          attendee.role = "REQ-PARTICIPANT";
        }

        attendee.participationStatus = statusMap[attendeeEntry.responseStatus];

        if (attendeeEntry.resource) {
          attendee.userType = "RESOURCE";
        } else {
          attendee.userType = "INDIVIDUAL";
        }

        item.addAttendee(attendee);
      }
    }

    // reminders
    item.clearAlarms();

    if (aEntry.reminders) {
      if (aEntry.reminders.useDefault) {
        aDefaultReminders.forEach(item.addAlarm, item);

        if (aDefaultReminders.length) {
          item.deleteProperty("X-DEFAULT-ALARM");
        } else {
          // Nothing to make clear we are using default reminders.
          // Set an X-PROP until VALARM extensions are supported
          item.setProperty("X-DEFAULT-ALARM", "TRUE");
        }
      }

      if (aEntry.reminders.overrides) {
        for (let reminderEntry of aEntry.reminders.overrides) {
          item.addAlarm(JSONToAlarm(reminderEntry));
        }
      }
    }

    // extendedProperty (alarmLastAck)
    item.alarmLastAck = cal.dtz.fromRFC3339(privateProps["X-MOZ-LASTACK"], calendarZone);

    // extendedProperty (snooze time)
    let dtSnoozeTime = cal.dtz.fromRFC3339(privateProps["X-MOZ-SNOOZE-TIME"], calendarZone);
    let snoozeProperty = dtSnoozeTime ? dtSnoozeTime.icalString : null;
    item.setProperty("X-MOZ-SNOOZE-TIME", snoozeProperty);

    // extendedProperty (snooze recurring alarms)
    if (item.recurrenceInfo) {
      // Transform back the string into our snooze properties
      let snoozeObj;
      try {
        let snoozeString = privateProps["X-GOOGLE-SNOOZE-RECUR"];
        snoozeObj = JSON.parse(snoozeString);
      } catch (e) {
        // Just swallow parsing errors, not so important.
      }

      if (snoozeObj) {
        for (let rid in snoozeObj) {
          item.setProperty("X-MOZ-SNOOZE-TIME-" + rid, snoozeObj[rid]);
        }
      }
    }

    // Google does not support categories natively, but allows us to store
    // data as an "extendedProperty", and here it's going to be retrieved
    // again
    let categories = cal.category.stringToArray(sharedProps["X-MOZ-CATEGORIES"]);
    item.setCategories(categories);

    // updated (This must be set last!)
    if (aEntry.updated) {
      let updated = cal.dtz.fromRFC3339(aEntry.updated, calendarZone).getInTimezone(cal.dtz.UTC);
      item.setProperty("DTSTAMP", updated);
      item.setProperty("LAST-MODIFIED", updated);
    }
  } catch (e) {
    cal.ERROR(stringException(e));
    throw e;
  }
  return item;
}

/**
 * Save items spread over multiple pages to the calendar's offline storage.
 *
 * @param aCalendar     The calendar the events belong to.
 */
function ItemSaver(aCalendar) {
  this.calendar = aCalendar;
  this.offlineStorage = this.calendar.offlineStorage;
  this.promiseOfflineStorage = cal.async.promisifyCalendar(this.calendar.offlineStorage);
  this.missingParents = [];
  this.masterItems = Object.create(null);
  this.metaData = Object.create(null);
  this.activity = new ActivityShell(aCalendar);
}
ItemSaver.prototype = {
  masterItems: null,
  missingParents: null,

  /**
   * Convenience function to apply a list of items (task/event) in JSON form to
   * the given calendar.
   *
   * @param aData         The JS Object from the list response.
   * @return              A promise resolved when completed.
   */
  parseItemStream: function(aData) {
    if (aData.kind == "calendar#events") {
      this.activity.type = "Event";
      return this.parseEventStream(aData);
    } else if (aData.kind == "tasks#tasks") {
      this.activity.type = "Task";
      return this.parseTaskStream(aData);
    } else {
      let message = "Invalid Stream type: " + (aData ? aData.kind || aData.toSource() : null);
      throw new Components.Exception(message, Cr.NS_ERROR_FAILURE);
    }
  },

  /**
   * Parse the response from Google's list command into tasks and modify the
   * calendar's offline storage to reflect those changes.
   *
   * @param aData         The JS Object from the list response.
   * @return              A promise resolved when completed.
   */
  parseTaskStream: async function(aData) {
    if (!aData.items || !aData.items.length) {
      cal.LOG("[calGoogleCalendar] No tasks have been changed on " + this.calendar.name);
    } else {
      cal.LOG("[calGoogleCalendar] Parsing " + aData.items.length + " received tasks");

      let total = aData.items.length;
      let committedUnits = 0;
      this.activity.addTotal(total);

      for (let cur = 0; cur < total; cur++) {
        let entry = aData.items[cur];
        // let metaData = Object.create(null);
        let metaData = {};
        let item = JSONToTask(entry, this.calendar, null, null, metaData);
        this.metaData[item.hashId] = metaData;

        await this.commitItem(item);

        if (await spinEventLoop()) {
          this.activity.addProgress(cur - committedUnits);
          committedUnits = cur;
        }
      }
    }
  },

  /**
   * Parse the response from Google's list command into events.
   *
   * @param aData         The JS Object from the list response.
   * @return              A promise resolved when completed.
   */
  parseEventStream: async function(aData) {
    if (aData.timeZone) {
      cal.LOG("[calGoogleCalendar] Timezone for " + this.calendar.name + " is " + aData.timeZone);
      this.calendar.setProperty("settings.timeZone", aData.timeZone);
    }

    if (!aData.items || !aData.items.length) {
      cal.LOG("[calGoogleCalendar] No events have been changed on " + this.calendar.name);
      return;
    } else {
      cal.LOG("[calGoogleCalendar] Parsing " + aData.items.length + " received events");
    }

    let exceptionItems = [];
    let defaultReminders = (aData.defaultReminders || []).map(reminder =>
      JSONToAlarm(reminder, true)
    );

    // In the first pass, we go through the data and sort into master items and
    // exception items, as the master item might be after the exception in the
    // stream.

    let total = aData.items.length;
    let committedUnits = 0;
    this.activity.addTotal(total);

    for (let cur = 0; cur < total; cur++) {
      let entry = aData.items[cur];
      let metaData = Object.create(null);
      let item = JSONToEvent(entry, this.calendar, defaultReminders, null, metaData);
      LOGitem(item);

      this.metaData[item.hashId] = metaData;

      if (item.recurrenceId) {
        exceptionItems.push(item);
      } else {
        this.masterItems[item.id] = item;
        await this.commitItem(item);
      }

      if (await spinEventLoop()) {
        this.activity.addProgress(cur - committedUnits);
        committedUnits = cur;
      }
    }

    // Go through all exceptions and attempt to find the master item in the
    // item stream. If it can't be found there, the offline storage is asked
    // for the parent item. If it still can't be found, then we have to do
    // this at the end.
    for (let exc of exceptionItems) {
      // If we have the master item in our cache then use it. Otherwise
      // attempt to get it from the offline storage.
      let item;
      if (exc.id in this.masterItems) {
        item = this.masterItems[exc.id];
      } else {
        item = (await this.promiseOfflineStorage.getItem(exc.id))[0];
      }

      // If an item was found, we can process this exception. Otherwise
      // save it for later, maybe its on the next page of the request.
      if (item) {
        if (!item.isMutable) {
          item = item.clone();
        }
        await this.processException(exc, item);
      } else {
        this.missingParents.push(exc);
      }

      await this.commitException(exc);
    }
  },

  /**
   * Handle the exception for the given item by committing it to the
   * calendar.
   *
   * @param exc       The exception to process.
   * @param item      The item the exception belongs to.
   * @return          A promise resolved when the item is added to the
   *                    calendar.
   */
  processException: function(exc, item) {
    if (item.status == "CANCELLED") {
      // Cancelled master items don't have the full amount of
      // information, specifically no recurrence info. Since they are
      // cancelled anyway, we can just ignore processing this exception.
      return Promise.resolve();
    }

    exc.parentItem = item;
    if (exc.status == "CANCELLED") {
      // Canceled means the occurrence is an EXDATE.
      item.recurrenceInfo.removeOccurrenceAt(exc.recurrenceId);
    } else {
      // Not canceled means the occurrence was modified.
      item.recurrenceInfo.modifyException(exc, true);
    }
    this.masterItems[item.id] = item;
    return this.commitItem(item);
  },

  /**
   * Handle final tasks for the exception. This means saving the metadat for the exception.
   *
   * @param exc       The exception to process.
   */
  commitException: function(exc) {
    // Make sure we also save the etag of the exception for a future request.
    if (exc.hashId in this.metaData) {
      saveItemMetadata(this.offlineStorage, exc.hashId, this.metaData[exc.hashId]);
    }
  },

  /**
   * Handle adding the item to the calendar, or removing it if its a cancelled item.
   *
   * @param item      The item to process.
   * @return          A promise resolved when the process is completed.
   */
  commitItem: async function(item) {
    // This is a normal item. If it was canceled, then it should be
    // deleted, otherwise it should be either added or modified. The
    // relaxed mode of the destination calendar takes care of the latter
    // two cases.
    if (item.status == "CANCELLED") {
      await this.promiseOfflineStorage.deleteItem(item);
    } else {
      await this.promiseOfflineStorage.modifyItem(item, null);
    }

    if (item.hashId in this.metaData) {
      // Make sure the metadata is up to date for the next request
      saveItemMetadata(this.offlineStorage, item.hashId, this.metaData[item.hashId]);
    }
  },

  /**
   * Complete the item saving, this will take care of all steps required
   * after the last request.
   */
  complete: function() {
    return this.processRemainingExceptions().then(() => {
      this.activity.complete();
    });
  },

  /**
   * Handle all remaining exceptions in the item saver. Ensures that any
   * missing master items are searched for or created.
   *
   * @return          A promise resolved on completion
   */
  processRemainingExceptions: async function() {
    for (let exc of this.missingParents) {
      let item = (await this.promiseOfflineStorage.getItem(exc.id))[0];
      if (item) {
        await this.processException(exc, item);
      } else if (exc.status != "CANCELLED") {
        // If the item could not be found, it could be that the
        // user is invited to an instance of a recurring event.
        // Unless this is a cancelled exception, create a mock
        // parent item with one positive RDATE.
        let parent = exc.clone();
        parent.recurrenceId = null;
        parent.calendar = this.calendar.superCalendar;
        parent.startDate = exc.recurrenceId.clone();
        parent.setProperty("X-MOZ-FAKED-MASTER", "1");
        if (!parent.id) {
          // Exceptions often don't have the iCalUID field set,
          // we need to fake it from the google id.
          let meta = this.metaData[exc.hashId];
          parent.id = meta.path + "@google.com";
        }
        parent.recurrenceInfo = new CalRecurrenceInfo(parent);
        let rdate = Cc["@mozilla.org/calendar/recurrence-date;1"].createInstance(
          Ci.calIRecurrenceDate
        );
        rdate.date = exc.recurrenceId;
        parent.recurrenceInfo.appendRecurrenceItem(rdate);
        await this.commitItem(parent);
      }
    }
  },
};

/**
 * A wrapper for nsIActivity to handle the synchronization process.
 *
 * @param aCalendar     The calendar for this activity.
 */
function ActivityShell(aCalendar) {
  this.calendar = aCalendar;

  if ("@mozilla.org/activity-process;1" in Cc) {
    this.init();
  }
}

ActivityShell.prototype = {
  act: null,
  actMgr: null,
  calendar: null,
  type: null,

  init: function() {
    this.actMgr = Cc["@mozilla.org/activity-manager;1"].getService(Ci.nsIActivityManager);
    this.act = Cc["@mozilla.org/activity-process;1"].createInstance(Ci.nsIActivityProcess);
    this.act.init(getMessenger().i18n.getMessage("syncStatus", this.calendar.name), this);
    this.act.iconClass = "syncMail";
    this.act.contextType = "gdata-calendar";
    this.act.contextObj = this.calendar;
    this.act.contextDisplayText = this.calendar.name;
    this.act.state = Ci.nsIActivityProcess.STATE_INPROGRESS;

    this.actMgr.addActivity(this.act);
  },

  addProgress: function(units) {
    if (!this.act) {
      return;
    }
    this.setProgress(this.act.workUnitComplete + units, this.act.totalWorkUnits);
  },

  addTotal: function(units) {
    if (!this.act) {
      return;
    }
    this.setProgress(this.act.workUnitComplete, this.act.totalWorkUnits + units);
  },

  setProgress: function(cur, total) {
    if (!this.act) {
      return;
    }
    let str = getMessenger().i18n.getMessage(
      "syncProgress" + this.type,
      this.calendar.name,
      cur,
      total
    );
    this.act.setProgress(str, cur, total);
  },

  complete: function() {
    if (!this.act) {
      return;
    }
    let total = this.act.totalWorkUnits;
    this.act.setProgress("", total, total);
    this.act.state = Ci.nsIActivityProcess.STATE_COMPLETED;
    this.actMgr.removeActivity(this.act.id);
  },
};

/**
 * Check if the response is a conflict and handle asking the user what to do
 * about it. Will resolve if there is no conflict or with new item data.
 * where status is a conflict status, see the end of this function.
 *
 * @param aOperation        The operation to check.
 * @param aCalendar         The calendar this operation happens in
 * @param aItem             The item that was passed to the server
 * @return                  A promise resolved when the conflict has been resolved
 */
async function checkResolveConflict(aOperation, aCalendar, aItem) {
  cal.LOG("[calGoogleCalendar] A conflict occurred for " + aItem.title);

  let method = aOperation.type == aOperation.DELETE ? "delete" : "modify";
  let overwrite = cal.provider.promptOverwrite(method, aItem);
  if (overwrite) {
    // The user has decided to overwrite the server version. Send again
    // overwriting the server version with If-Match: *
    cal.LOG("[calGoogleCalendar] Resending " + method + " and ignoring ETag");
    aOperation.addRequestHeader("If-Match", "*");
    try {
      return await aCalendar.session.asyncItemRequest(aOperation);
    } catch (e) {
      if (e.result == calGoogleRequest.RESOURCE_GONE && aOperation.type == aOperation.DELETE) {
        // The item was deleted on the server and locally, we don't need to
        // notify the user about this.
        return null;
      } else {
        throw e;
      }
    }
  } else {
    // The user has decided to throw away changes, use our existing
    // means to update the item locally.
    cal.LOG("[calGoogleCalendar] Reload requested, cancelling change of " + aItem.title);
    aCalendar.superCalendar.refresh();
    throw Components.Exception(null, Ci.calIErrors.OPERATION_CANCELLED);
  }
}
