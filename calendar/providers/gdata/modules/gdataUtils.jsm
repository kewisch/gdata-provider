/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm").shimIt(this);
Components.utils.import("resource://gdata-provider/modules/shim/Calendar.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataLogging.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataRequest.jsm");
Components.utils.import("resource://gdata-provider/modules/timezoneMap.jsm");

CuImport("resource://gre/modules/Services.jsm", this);
CuImport("resource://gre/modules/Preferences.jsm", this);
CuImport("resource://gre/modules/Promise.jsm", this);
CuImport("resource://gre/modules/PromiseUtils.jsm", this);
CuImport("resource://gre/modules/Task.jsm", this);

CuImport("resource://calendar/modules/calUtils.jsm", this);
CuImport("resource://calendar/modules/calIteratorUtils.jsm", this);
CuImport("resource://calendar/modules/calProviderUtils.jsm", this);

var cIE = Components.interfaces.calIErrors;

var FOUR_WEEKS_IN_MINUTES = 40320;

var EXPORTED_SYMBOLS = [
    "ItemToJSON", "JSONToItem", "ItemSaver",
    "checkResolveConflict", "getGoogleId",
    "getItemMetadata", "saveItemMetadata",
    "deleteItemMetadata", "migrateItemMetadata",
    "JSONToAlarm", "dateToJSON", "JSONToDate",
    "getProviderString", "monkeyPatch", "spinEventLoop"
];

/**
 * Retrives the Google ID associated with this event. This is either a simple
 * id or the id in combination with the recurrence id.
 *
 * @param aItem             The Item to get the id for.
 * @param aOfflineStorage   The offline storage that holds the metadata for this item.
 */
function getGoogleId(aItem, aOfflineStorage) {
    let meta = getItemMetadata(aOfflineStorage, aItem) ||
               getItemMetadata(aOfflineStorage, aItem.parentItem);
    let baseId = meta ? meta.path : aItem.id.replace("@google.com", "");
    if (aItem.recurrenceId) {
        let recSuffix = "_" + aItem.recurrenceId.getInTimezone(cal.UTC()).icalString;
        if (!baseId.endsWith(recSuffix)) {
            baseId += recSuffix;
        }
    }
    return baseId;
}

/**
 * Save metadata for the given hash id.
 *
 * @param aOfflineStorage   The offline storage that holds the metadata for this item.
 * @param aId               The hash id to save metadata with.
 * @param aMetadata         The metadata object to save.
 */
function saveItemMetadata(aOfflineStorage, aId, aMetadata) {
    // Save metadata using the same format as for the CalDAV provider, this
    // will make things easier when upgrading to the new item based metadata.
    let meta = [aMetadata.etag, aMetadata.path, false].join("\u001A");
    aOfflineStorage.setMetaData(aId, meta);
}

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
        let newExIds = new Set(aNewItem.recurrenceInfo.getExceptionIds({}).map(function(x) { return x.icalString; }));
        for each (let exId in aOldItem.recurrenceInfo.getExceptionIds({})) {
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
        for each (let exId in recInfo.getExceptionIds({})) {
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
        data = { etag: parts[0], path: aItem.getProperty("X-GOOGLE-ID") }
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
    jsonData[aDate.isDate ? "date" : "dateTime"] = cal.toRFC3339(aDate);
    if (!aDate.isDate && tzid != "floating") {
        if (tzid in windowsTimezoneMap) {
            // A Windows timezone, likely an outlook invitation.
            jsonData.timeZone = windowsTimezoneMap[tzid];
        } else if (tzid.match(/^[^\/ ]+(\/[^\/ ]+){1,2}$/)) {
            // An Olson timezone id
            jsonData.timeZone = aDate.timezone.tzid;
        } else {
            // Uhh...something. Google requires a timezone id for recurring
            // events, we can fake it with Etc/ timezones.
            let full_tzoffset = aDate.timezoneOffset;
            let tzoffset_hr = Math.floor(Math.abs(full_tzoffset) / 3600);
            // sign for etc needs to be the opposite of the UTC tz offset sign
            let sign = (full_tzoffset > 0 ? "-" : "+");
            if (tzoffset_hr == 0) {
                jsonData.timeZone = "UTC";
            } else {
                jsonData.timeZone = "Etc/GMT" + sign + tzoffset_hr;
            }
        }

        if (jsonData.timeZone) {
            // Strip the timezone offset if a timeZone was specified.
            jsonData.dateTime = jsonData.dateTime.replace(/[+-]\d{2}:\d{2}$/, '');

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
 * Like cal.fromRFC3339(), but assumes that the passed timezone is the timezone
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
            offset_in_s = (matches[11] == "-" ? -1 : 1) *
                (matches[11] * 3600 + matches[12] * 60);
        }

        if (dateTime.timezoneOffset != offset_in_s) {
            // Warn here, since this shouldn't be happening. Then use the
            // original fromRFC3339, which goes through the timezone list and
            // finds the first matching zone.
            cal.WARN("[calGoogleCalendar] " + aStr + " does not match timezone offset for " + aTimezone.tzid);
            dateTime = cal.fromRFC3339(aStr, aTimezone);
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
 * Like cal.toRFC3339, but include milliseconds. Google timestamps require
 * this.
 *
 * @param dt        The calIDateTime to convert.
 * @return          The RFC3339 string stamp.
 */
function toRFC3339Fraction(dt) {
    let str = cal.toRFC3339(dt);
    return str ? str.replace(/(Z?)$/, ".000$1") : null;
}

/**
 * Converts a calIEvent to a JS Object that can be serialized to JSON.
 *
 * @param aItem         The item to convert.
 * @return              A JS Object representing the item.
 */
function EventToJSON(aItem, aOfflineStorage, aIsImport) {
    function addExtendedProperty(aName, aValue, aPrivate) {
        if (!aValue) {
            // We unset an extended prop by not adding it
            return;
        }

        if (!("extendedProperties" in itemData)) {
            itemData.extendedProperties = {};
        }
        if (aPrivate) {
            if (!("private" in itemData.extendedProperties)) {
                itemData.extendedProperties.private = {};
            }
            itemData.extendedProperties.private[aName] = aValue;
        } else {
            if (!("shared" in itemData.extendedProperties)) {
                itemData.extendedProperties.shared = {};
            }
            itemData.extendedProperties.shared[aName] = aValue;
        }
    }
    function setIf(data, prop, value) {
        if (value) data[prop] = value;
    }

    let itemData = {};

    itemData.start = dateToJSON(aItem.startDate);
    itemData.end = dateToJSON(aItem.endDate);

    if (aIsImport && aItem.id) {
        itemData.iCalUID = aItem.id;
        setIf(itemData, "created", toRFC3339Fraction(aItem.creationDate));
        setIf(itemData, "updated", toRFC3339Fraction(aItem.lastModifiedTime));
    }

    setIf(itemData, "summary", aItem.title);
    setIf(itemData, "description", aItem.getProperty("DESCRIPTION"));
    setIf(itemData, "location", aItem.getProperty("LOCATION"));
    setIf(itemData, "transparency", aItem.getProperty("TRANSP") && aItem.getProperty("TRANSP").toLowerCase());
    setIf(itemData, "visibility", aItem.privacy && aItem.privacy.toLowerCase());
    setIf(itemData, "sequence", aItem.getProperty("SEQUENCE"));

    // eventStatus
    let status = aItem.status && aItem.status.toLowerCase();
    if (status == "cancelled") {
        // If the status is canceled, then the event will be deleted. Since the
        // user didn't choose to delete the event, we will protect him and not
        // allow this status to be set
        throw new Components.Exception("The status CANCELLED is reserved, delete the event instead!",
                                       Components.results.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA);
    } else if (status == "none") {
        status = null;
    }
    setIf(itemData, "status", status);

    // Google does not support categories natively, but allows us to store data
    // as an "extendedProperty", so we do here
    let categories = cal.categoriesArrayToString(aItem.getCategories({}));
    addExtendedProperty("X-MOZ-CATEGORIES", categories);

    // Only parse attendees if they are enabled, due to bug 407961
    if (Preferences.get("calendar.google.enableAttendees", false)) {
        let createAttendee = function(attendee) {
            const statusMap = {
                "NEEDS-ACTION": "needsAction",
                "DECLINED": "declined",
                "TENTATIVE": "tentative",
                "ACCEPTED": "accepted"
            };

            let attendeeData = {};
            if (aItem.organizer && aItem.organizer.id == attendee.id) {
                needsOrganizer = false;
            }
            let lowerId = attendee.id.toLowerCase();
            if (lowerId.startsWith("mailto:")) {
                attendeeData.email = attendee.id.replace(/^mailto:/i, "");
            } else if (lowerId.startsWith("urn:id:")) {
                attendeeData.id = attendee.id.replace(/^urn:id:/i, "");
            }

            setIf(attendeeData, "displayName", attendee.commonName);
            setIf(attendeeData, "optional", attendee.role && attendee.role != "REQ-PARTICIPANT");
            setIf(attendeeData, "responseStatus", statusMap[attendee.participationStatus]);
            setIf(attendeeData, "comment", attendee.getProperty("COMMENT"));
            setIf(attendeeData, "resource", attendee.userType && attendee.userType != "INDIVIDUAL");
            setIf(attendeeData, "additionalGuests", attendee.getProperty("X-NUM-GUESTS"));
            return attendeeData;
        };

        let needsOrganizer = true;
        let attendees = aItem.getAttendees({});
        let attendeeData = [ createAttendee(a) for each (a in attendees) ];

        if (aItem.organizer) {
            itemData.organizer = createAttendee(aItem.organizer);
            if (needsOrganizer) {
                attendeeData.push(itemData.organizer);
            }
        }

        if (attendeeData.length) itemData.attendees = attendeeData;
    }

    // reminder
    let alarms = aItem.getAlarms({});
    let actionMap = {
        DISPLAY: "popup",
        EMAIL: "email",
        SMS: "sms"
    };

    itemData.reminders = { overrides: [], useDefault: false };
    for (let i = 0; i < 5 && i < alarms.length; i++) {
        let alarm = alarms[i];
        let alarmOffset;
        let alarmData = {};

        if (alarm.getProperty("X-DEFAULT-ALARM")) {
            // This is a default alarm, it shouldn't be set as an override
            itemData.reminders.useDefault = true;
            continue;
        }

        alarmData.method = actionMap[alarm.action] || "popup";

        if (alarm.related == alarm.ALARM_RELATED_ABSOLUTE) {
            alarmOffset = aItem.startDate.subtractDate(alarm.alarmDate);
        } else {
            if (alarm.related == alarm.ALARM_RELATED_END) {
                // Google always uses an alarm offset related to the start time
                // for relative alarms.
                alarmOffset = alarm.alarmOffset.clone();
                alarmOffset.addDuration(aItem.endDate.subtractDate(aItem.startDate));
            } else {
                alarmOffset = alarm.offset;
            }
        }
        alarmData.minutes = -alarmOffset.inSeconds / 60;

        // Google doesn't allow alarms after the event starts, or more than 4
        // weeks before the event. Make sure the minutes are within range.
        alarmData.minutes = Math.min(Math.max(0, alarmData.minutes), FOUR_WEEKS_IN_MINUTES);

        itemData.reminders.overrides.push(alarmData);
    }

    if (!alarms.length && aItem.getProperty("X-DEFAULT-ALARM") == "TRUE") {
        delete itemData.reminders.overrides;
        itemData.reminders.useDefault = true;
    }

    // gd:extendedProperty (alarmLastAck)
    addExtendedProperty("X-MOZ-LASTACK", cal.toRFC3339(aItem.alarmLastAck), true);

    // XXX While Google now supports multiple alarms and alarm values, we still
    // need to fix bug 353492 first so we can better take care of finding out
    // what alarm is used for snoozing.

    // gd:extendedProperty (snooze time)
    let itemSnoozeTime = aItem.getProperty("X-MOZ-SNOOZE-TIME");
    let icalSnoozeTime = null;
    if (itemSnoozeTime) {
        // The propery is saved as a string, translate back to calIDateTime.
        icalSnoozeTime = cal.createDateTime();
        icalSnoozeTime.icalString = itemSnoozeTime;
    }
    addExtendedProperty("X-MOZ-SNOOZE-TIME", cal.toRFC3339(icalSnoozeTime), true);

    // gd:extendedProperty (snooze recurring alarms)
    let snoozeValue = "";
    if (aItem.recurrenceInfo) {
        // This is an evil workaround since we don't have a really good system
        // to save the snooze time for recurring alarms or even retrieve them
        // from the event. This should change when we have multiple alarms
        // support.
        let snoozeObj = {};
        let enumerator = aItem.propertyEnumerator;
        while (enumerator.hasMoreElements()) {
            let prop = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
            if (prop.name.substr(0, 18) == "X-MOZ-SNOOZE-TIME-") {
                // We have a snooze time for a recurring event, add it to our object
                snoozeObj[prop.name.substr(18)] = prop.value;
            }
        }
        if (Object.keys(snoozeObj).length > 0) {
            snoozeValue = JSON.stringify(snoozeObj);
        }
    }
    // Now save the snooze object in source format as an extended property. Do
    // so always, since its currently impossible to unset extended properties.
    addExtendedProperty("X-GOOGLE-SNOOZE-RECUR", snoozeValue, true);

    // recurrence information
    if (aItem.recurrenceInfo) {
        itemData.recurrence = [];
        let recurrenceItems = aItem.recurrenceInfo.getRecurrenceItems({});
        for each (let ritem in recurrenceItems) {
            let prop = ritem.icalProperty;
            if (ritem instanceof Components.interfaces.calIRecurrenceDate) {
                // EXDATES require special casing, since they might contain
                // a TZID. To avoid the need for conversion of TZID strings,
                // convert to UTC before serialization.
                prop.valueAsDatetime = ritem.date.getInTimezone(cal.UTC());
            }
            itemData.recurrence.push(prop.icalString.trim());
        }
    } else if (aItem.recurrenceId) {
        itemData.originalStartTime = dateToJSON(aItem.recurrenceId);
        let parentMeta = getItemMetadata(aOfflineStorage, aItem.parentItem);
        itemData.recurringEventId = parentMeta ? parentMeta.path : aItem.id.replace("@google.com", "");
    }

    return itemData;
}

/**
 * Converts a calITodo to a JS Object that can be serialized to JSON.
 *
 * @param aItem         The item to convert.
 * @return              A JS Object representing the item.
 */
function TaskToJSON(aItem, aOfflineStorage, aIsImport) {
    function setIf(data, prop, value) {
        if (value) data[prop] = value;
    }

    let itemData = {};

    setIf(itemData, "id", aItem.id);
    setIf(itemData, "title", aItem.title);
    setIf(itemData, "notes", aItem.getProperty("DESCRIPTION"));
    setIf(itemData, "position", aItem.getProperty("X-SORTKEY"));
    itemData.status = (aItem.isCompleted ? "completed" : "needsAction");

    if (aItem.dueDate) {
        let dueDate = aItem.dueDate.getInTimezone(cal.UTC());
        dueDate.isDate = false;
        itemData.due = cal.toRFC3339(dueDate);
    }
    setIf(itemData, "completed", cal.toRFC3339(aItem.completedDate));

    for each (let relation in aItem.getRelations({})) {
        if (relation.relId &&
            (!relation.relType || relation.relType == "PARENT")) {
            itemData.parent = relation.relId;
            break;
        }
    }

    let attachments = aItem.getAttachments({});
    if (attachments.length) itemData.links = [];
    for each (let attach in aItem.getAttachments({})) {
        let attachData = {};
        attachData.link = attach.uri.spec;
        attachData.description = attach.getParameter("FILENAME");
        attachData.type = attach.getParameter("X-TYPE");
        itemData.links.push(attachData);
    }

    return itemData;
}

/**
 * Convenience function to convert any item type (task/event) to its JSON
 * representation
 *
 * @param aItem         The item to convert
 * @return              A JS Object representing the item.
 */
function ItemToJSON(aItem, aOfflineStorage, aIsImport) {
    if (cal.isEvent(aItem)) {
        return EventToJSON(aItem, aOfflineStorage, aIsImport);
    } else if (cal.isToDo(aItem)) {
        return TaskToJSON(aItem, aOfflineStorage, aIsImport);
    } else {
        cal.ERROR("[calGoogleCalendar] Invalid item type: " + aItem.icalString);
        return null;
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

    if (!aItem.recurrenceInfo) {
        aItem.recurrenceInfo = cal.createRecurrenceInfo(aItem);
    } else {
        aItem.recurrenceInfo.clearRecurrenceItems();
    }

    let rootComp;
    try {
        let vevent = "BEGIN:VEVENT\r\n" + aRecurrence.join("\r\n") + "\r\nEND:VEVENT";
        rootComp = cal.getIcsService().parseICS(vevent, null);
    } catch (e) {
        cal.ERROR("[calGoogleCalendar] Unable to parse recurrence item: " + vevent);
    }

    let hasRecurringRules = false;
    for (let prop in cal.ical.propertyIterator(rootComp)) {
       switch (prop.propertyName) {
            case "RDATE":
            case "EXDATE":
                let recItem = Components.classes["@mozilla.org/calendar/recurrence-date;1"]
                              .createInstance(Components.interfaces.calIRecurrenceDate);
                try {
                    recItem.icalProperty = prop;
                    aItem.recurrenceInfo.appendRecurrenceItem(recItem);
                    hasRecurringRules = true;
                } catch (e) {
                    cal.ERROR("[calGoogleCalendar] Error parsing " +
                              prop.propertyName + " (" +
                              prop.icalString + "):" + e);
                }
                break;
            case "RRULE":
                let recRule = cal.createRecurrenceRule();
                try {
                    recRule.icalProperty = prop;
                    aItem.recurrenceInfo.appendRecurrenceItem(recRule);
                    hasRecurringRules = true;
                } catch (e) {
                    cal.ERROR("[calGoogleCalendar] Error parsing RRULE (" +
                              prop.icalString + "):" + e);
                }
                break;
        }
    }

    if (!hasRecurringRules) {
        // If there were no parsable recurrence items, then clear the
        // recurrence info.
        aItem.recurrenceInfo = null;
    }
}

/**
 * Create an alarm from the JSON reminder entry
 *
 * @param aEntry            The JSON reminder entry.
 * @param aDefault          (optional) If true, this is a default alarm.
 * @return                  The translated calIAlarm.
 */
function JSONToAlarm(aEntry, aDefault) {
    const alarmActionMap = {
        email: "EMAIL",
        popup: "DISPLAY",
        sms: "SMS"
    };
    let alarm = cal.createAlarm();
    let alarmOffset = cal.createDuration();
    alarm.action = alarmActionMap[aEntry.method] || "DISPLAY";
    alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_START;
    alarmOffset.inSeconds = -aEntry.minutes * 60;
    alarmOffset.normalize();
    alarm.offset = alarmOffset;

    if (aDefault) {
        alarm.setProperty("X-DEFAULT-ALARM", "TRUE");
    }
    return alarm;
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
    let item = aReferenceItem || cal.createEvent();
    item.calendar = aCalendar.superCalendar;
    let privateProps = ("extendedProperties" in aEntry && aEntry.extendedProperties.private) || {};
    let sharedProps = ("extendedProperties" in aEntry && aEntry.extendedProperties.shared) || {};
    let accessRole = aCalendar.getProperty("settings.accessRole");

    LOGverbose("[calGoogleCalendar] Parsing entry:\n" +
               JSON.stringify(aEntry, null, " ") + "\n");

    if (!aEntry || !("kind" in aEntry) || aEntry.kind != "calendar#event") {
        cal.ERROR("[calGoogleCalendar] Attempt to decode invalid event: " +
                  (aEntry && JSON.stringify(aEntry, null, " ")));
        return null;
    }

    let tzs = cal.getTimezoneService();
    let calendarZoneName = aCalendar.getProperty("settings.timeZone");
    let calendarZone = calendarZoneName ? tzs.getTimezone(calendarZoneName) : cal.calendarDefaultTimezone();

    try {
        item.id = aEntry.iCalUID || ((aEntry.recurringEventId || aEntry.id) + "@google.com");
        item.recurrenceId = JSONToDate(aEntry.originalStartTime, calendarZone);
        if (!item.recurrenceId) {
            // Sometimes recurring event instances don't have recurringEventId
            // set, but are still instances. work around by detecting the ID.
            // http://code.google.com/a/google.com/p/apps-api-issues/issues/detail?id=3199
            let hack = aEntry.id.match(/([^_]*)_(\d{8}(T\d{6}Z)?)$/);
            item.recurrenceId = hack ? cal.createDateTime(hack[2]) : null;
        }
        item.status = (aEntry.status ? aEntry.status.toUpperCase() : null);
        item.title = aEntry.summary;
        if (accessRole == "freeBusyReader") {
            item.title = getProviderString("busyTitle", aCalendar.name);
        }
        item.privacy = (aEntry.visibility ? aEntry.visibility.toUpperCase() : null);

        item.setProperty("URL", aEntry.htmlLink && aCalendar.uri.schemeIs("https") ? aEntry.htmlLink.replace(/^http:/, "https:") : aEntry.htmlLink);
        item.setProperty("CREATED", (aEntry.created ? cal.fromRFC3339(aEntry.created, calendarZone).getInTimezone(cal.UTC()) : null));
        item.setProperty("DESCRIPTION", aEntry.description);
        item.setProperty("LOCATION", aEntry.location);
        item.setProperty("TRANSP", (aEntry.transparency ? aEntry.transparency.toUpperCase() : null));
        item.setProperty("SEQUENCE", aEntry.sequence);
        aMetadata.etag = aEntry.etag;
        aMetadata.path = aEntry.id;

        // organizer
        if (aEntry.organizer) {
            let organizer = cal.createAttendee();
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
                accepted: "ACCEPTED"
            };
            for each (let attendeeEntry in aEntry.attendees) {
                let attendee = cal.createAttendee();
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
                for each (let reminderEntry in aEntry.reminders.overrides) {
                    item.addAlarm(JSONToAlarm(reminderEntry));
                }
            }
        }

        // extendedProperty (alarmLastAck)
        item.alarmLastAck = cal.fromRFC3339(privateProps["X-MOZ-LASTACK"], calendarZone);

        // extendedProperty (snooze time)
        let dtSnoozeTime = cal.fromRFC3339(privateProps["X-MOZ-SNOOZE-TIME"], calendarZone);
        let snoozeProperty = (dtSnoozeTime ? dtSnoozeTime.icalString : null);
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
        let categories = cal.categoriesStringToArray(sharedProps["X-MOZ-CATEGORIES"]);
        item.setCategories(categories.length, categories);

        // updated (This must be set last!)
        if (aEntry.updated) {
            let updated = cal.fromRFC3339(aEntry.updated, calendarZone).getInTimezone(cal.UTC());
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
 * Converts a JS Object representing the task to a calITodo.
 *
 * @param aEntry            The JS Object representation of the item.
 * @param aCalendar         The calendar this item will belong to.
 * @param aMetadata         (optional,out) Item metadata that should be set.
 * @return                  The calITodo with the item data.
 */
function JSONToTask(aEntry, aCalendar, aDefaultReminders, aReferenceItem, aMetadata) {
    aDefaultReminders = aDefaultReminders || [];
    aMetadata = aMetadata || {};
    if (!aEntry || !("kind" in aEntry) || aEntry.kind != "tasks#task") {
        cal.ERROR("[calGoogleCalendar] Attempt to decode invalid task: " +
                  (aEntry && JSON.stringify(aEntry, null, " ")));
        return null;
    }
    let item = cal.createTodo();
    item.calendar = aCalendar.superCalendar;

    let tzs = cal.getTimezoneService();
    let calendarZoneName = aCalendar.getProperty("settings.timeZone");
    let calendarZone = calendarZoneName ? tzs.getTimezone(calendarZoneName) : cal.calendarDefaultTimezone();

    try {
        item.id = aEntry.id;
        item.title = aEntry.title || "";
        item.setProperty("DESCRIPTION", aEntry.notes);
        item.setProperty("X-GOOGLE-SORTKEY", aEntry.position);
        item.isCompleted = (aEntry.status == "completed");

        aMetadata.etag = aEntry.etag;
        aMetadata.path = aEntry.id;

        // Google Tasks don't have a due time, but still use 0:00 UTC. They
        // should really be using floating time.
        item.dueDate = cal.fromRFC3339(aEntry.due, cal.floating())
        if (item.dueDate) {
            item.dueDate.timezone = cal.floating();
            item.dueDate.isDate = true;
        }
        item.completedDate = cal.fromRFC3339(aEntry.completed, calendarZone);
        if (aEntry.deleted) {
            item.status = "CANCELLED";
        } else if (aEntry.status == "needsAction") {
            item.status = "NEEDS-ACTION";
        } else {
            item.status = "COMPLETED";
        }

        if (aEntry.parent) {
            let relation = cal.createRelation();
            relation.relType = "PARENT";
            relation.relId = aEntry.parent;
            item.addRelation(relation);
        }

        if (aEntry.links) {
            for each (let link in aEntry.links) {
                let attach = cal.createAttachment();
                attach.uri = Services.io.newURI(link.link, null, null);
                attach.setParameter("FILENAME", link.description);
                attach.setParameter("X-GOOGLE-TYPE", link.type);
                item.addAttachment(attach);
            }
        }

        // updated (This must be set last!)
        item.setProperty("DTSTAMP", cal.fromRFC3339(aEntry.updated, calendarZone).getInTimezone(cal.UTC()));
        item.setProperty("LAST-MODIFIED", cal.fromRFC3339(aEntry.updated, calendarZone).getInTimezone(cal.UTC()));
    } catch (e) {
        cal.ERROR("[calGoogleCalendar] Error parsing JSON tasks stream: " + stringException(e));
        throw e;
    }

    return item;
}

/**
 * Convenience function to convert any JSON reply (task/event) to a calendar
 * item.
 *
 * @param aEntry            The JS Object representation of the item.
 * @param aCalendar         The calendar this item will belong to.
 * @param aMetadata         (optional,out) Item metadata that should be set.
 * @return                  The specialized calIItemBase with the item data.
 */
function JSONToItem(aEntry, aCalendar, aDefaultReminders, aReferenceItem, aMetadata) {
    aDefaultReminders = aDefaultReminders || [];
    aMetadata = aMetadata || {};
    if (aEntry.kind == "tasks#task") {
        return JSONToTask.apply(null, arguments);
    } else if (aEntry.kind == "calendar#event") {
        return JSONToEvent.apply(null, arguments);
    } else {
        cal.ERROR("[calGoogleCalendar] Invalid item type: " + (aEntry ? aEntry.kind : "<no entry>"));
        return null;
    }
}

/**
 * Save items spread over multiple pages to the calendar's offline storage.
 *
 * @param aCalendar     The calendar the events belong to.
 */
function ItemSaver(aCalendar) {
    this.calendar = aCalendar;
    this.offlineStorage = this.calendar.offlineStorage;
    this.promiseOfflineStorage = promisifyCalendar(this.calendar.offlineStorage);
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
            throw new Components.Exception(message, Components.results.NS_ERROR_FAILURE);
        }
    },

    /**
     * Parse the response from Google's list command into tasks and modify the
     * calendar's offline storage to reflect those changes.
     *
     * @param aData         The JS Object from the list response.
     * @return              A promise resolved when completed.
     */
    parseTaskStream: function(aData) {
        return Task.spawn(function() {
            if (!aData.items || !aData.items.length) {
                cal.LOG("[calGoogleCalendar] No tasks have been changed on " + this.calendar.name);
            } else {
                cal.LOG("[calGoogleCalendar] Parsing " + aData.items.length + " received tasks");

                let total = aData.items.length;
                let committedUnits = 0;
                this.activity.addTotal(total);

                for (let cur = 0; cur < total; cur++) {
                    let entry = aData.items[cur];
                    //let metaData = Object.create(null);
                    let metaData = {};
                    let item = JSONToTask(entry, this.calendar, null, null, metaData);
                    this.metaData[item.hashId] = metaData;

                    yield this.commitItem(item);

                    if (yield spinEventLoop()) {
                        this.activity.addProgress(cur - committedUnits);
                        committedUnits = cur;
                    }
                }
            }
        }.bind(this));
    },

    /**
     * Parse the response from Google's list command into events.
     *
     * @param aData         The JS Object from the list response.
     * @return              A promise resolved when completed.
     */
    parseEventStream: function(aData) {
        return Task.spawn(function() {
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
            let defaultReminders = (aData.defaultReminders || []).map(function(x) { return JSONToAlarm(x, true); });

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
                    yield this.commitItem(item);
                }

                if (yield spinEventLoop()) {
                    this.activity.addProgress(cur - committedUnits);
                    committedUnits = cur;
                }
            }

            // Go through all exceptions and attempt to find the master item in the
            // item stream. If it can't be found there, the offline storage is asked
            // for the parent item. If it still can't be found, then we have to do
            // this at the end.
            for each (let exc in exceptionItems) {
                // If we have the master item in our cache then use it. Otherwise
                // attempt to get it from the offline storage.
                let item;
                if (exc.id in this.masterItems) {
                    item = this.masterItems[exc.id];
                } else {
                    item = (yield this.promiseOfflineStorage.getItem(exc.id))[0];
                }

                // If an item was found, we can process this exception. Otherwise
                // save it for later, maybe its on the next page of the request.
                if (item) {
                    if (!item.isMutable) {
                        item = item.clone();
                    }
                    yield this.processException(exc, item);
                } else {
                    this.missingParents.push(exc);
                }

                yield this.commitException(exc);
            }
        }.bind(this));
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
    commitItem: function(item) {
        return Task.spawn(function() {
            // This is a normal item. If it was canceled, then it should be
            // deleted, otherwise it should be either added or modified. The
            // relaxed mode of the destination calendar takes care of the latter
            // two cases.
            if (item.status == "CANCELLED") {
                yield this.promiseOfflineStorage.deleteItem(item);
            } else {
                yield this.promiseOfflineStorage.modifyItem(item, null);
            }

            if (item.hashId in this.metaData) {
                // Make sure the metadata is up to date for the next request
                saveItemMetadata(this.offlineStorage, item.hashId, this.metaData[item.hashId]);
            }
        }.bind(this));
    },

    /**
     * Complete the item saving, this will take care of all steps required
     * after the last request.
     */
    complete: function() {
        return this.processRemainingExceptions().then(function() {
            this.activity.complete();
        }.bind(this));
    },

    /**
     * Handle all remaining exceptions in the item saver. Ensures that any
     * missing master items are searched for or created.
     *
     * @return          A promise resolved on completion
     */
    processRemainingExceptions: function() {
        return Task.spawn(function() {
            for each (let exc in this.missingParents) {
                let item = (yield this.promiseOfflineStorage.getItem(exc.id))[0];
                if (item) {
                    yield this.processException(exc, item);
                } else if (exc.status != "CANCELLED") {
                    // If the item could not be found, it could be that the
                    // user is invited to an instance of a recurring event.
                    // Unless this is a cancelled exception, create a mock
                    // parent item with one positive RDATE.
                    let item = exc.clone();
                    item.recurrenceId = null;
                    item.calendar = this.calendar.superCalendar;
                    item.startDate = exc.recurrenceId.clone();
                    item.setProperty("X-MOZ-FAKED-MASTER", "1");
                    if (!item.id) {
                        // Exceptions often don't have the iCalUID field set,
                        // we need to fake it from the google id.
                        let meta = this.metaData[exc.hashId];
                        item.id = meta.path + "@google.com";
                    }
                    item.recurrenceInfo = cal.createRecurrenceInfo(item);
                    let rdate = Components.classes["@mozilla.org/calendar/recurrence-date;1"]
                                          .createInstance(Components.interfaces.calIRecurrenceDate);
                    rdate.date = exc.recurrenceId;
                    item.recurrenceInfo.appendRecurrenceItem(rdate);
                    yield this.commitItem(item);
                }
            }
        }.bind(this));
    }
};

/**
 * A wrapper for nsIActivity to handle the synchronization process.
 *
 * @param aCalendar     The calendar for this activity.
 */
function ActivityShell(aCalendar) {
    this.calendar = aCalendar;

    if ('@mozilla.org/activity-process;1' in Components.classes) {
        this.init();
    }
}

ActivityShell.prototype = {
    act: null,
    actMgr: null,
    calendar: null,
    type: null,

    init: function() {
        this.actMgr = Components.classes['@mozilla.org/activity-manager;1']
                                .getService(Components.interfaces.nsIActivityManager);
        this.act =  Components.classes['@mozilla.org/activity-process;1']
                              .createInstance(Components.interfaces.nsIActivityProcess);
        this.act.init(getProviderString("syncStatus", this.calendar.name), this);
        this.act.iconClass = "syncMail";
        this.act.contextType = "gdata-calendar";
        this.act.contextObj = this.calendar;
        this.act.contextDisplayText = this.calendar.name;
        this.act.state = Components.interfaces.nsIActivityProcess.STATE_INPROGRESS;

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
        let str = getProviderString("syncProgress" + this.type, this.calendar.name, cur, total);
        this.act.setProgress(str, cur, total);
    },

    complete: function() {
        if (!this.act) {
            return;
        }
        let total = this.act.totalWorkUnits;
        this.act.setProgress("", total, total);
        this.act.state = Components.interfaces.nsIActivityProcess.STATE_COMPLETED;
        this.actMgr.removeActivity(this.act.id);
    }
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
function checkResolveConflict(aOperation, aCalendar, aItem) {
    return Task.spawn(function() {
        cal.LOG("[calGoogleCalendar] A conflict occurred for " + aItem.title);

        let method = (aOperation.type == aOperation.DELETE ? "delete" : "modify")
        let overwrite = cal.promptOverwrite(method, aItem);
        if (overwrite) {
            // The user has decided to overwrite the server version. Send again
            // overwriting the server version with If-Match: *
            cal.LOG("[calGoogleCalendar] Resending " + method + " and ignoring ETag");
            aOperation.addRequestHeader("If-Match", "*");
            try {
                throw new Task.Result(yield aCalendar.session.asyncItemRequest(aOperation));
            } catch (e if e.result == calGoogleRequest.RESOURCE_GONE &&
                          aOperation.type == aOperation.DELETE) {
                // The item was deleted on the server and locally, we don't need to
                // notify the user about this.
                throw new Task.Result(null);
            }
        } else {
            // The user has decided to throw away changes, use our existing
            // means to update the item locally.
            cal.LOG("[calGoogleCalendar] Reload requested, cancelling change of " + aItem.title);
            aCalendar.superCalendar.refresh();
            throw Components.Exception(null, cIE.OPERATION_CANCELLED);
        }
    });
}

/**
 * Get a string from the gdata properties file
 *
 * @param aStringName  The name of the string within the properties file
 * @param ...aParams   Optional parameters to format the string
 * @return             The localized string value.
 */
function getProviderString(aStringName /*...aParams */) {
    let aParams = Array.slice(arguments, 1);
    return cal.calGetString("gdata", aStringName, aParams, "gdata-provider");
}

/**
 * Monkey patch the function with the name x on obj and overwrite it with func.
 * The first parameter of this function is the original function that can be
 * called at any time.
 *
 * @param obj           The object the function is on.
 * @param name          The string name of the function.
 * @param func          The function to monkey patch with.
 */
function monkeyPatch(obj, x, func) {
    let old = obj[x];
    obj[x] = function() {
        let parent = old.bind(obj);
        let args = Array.slice(arguments);
        args.unshift(parent);
        try {
            return func.apply(obj, args);
        } catch (e) {
            Components.utils.reportError(e);
            throw e;
        }
    }
}

/**
 * Returns a promise that resolves after pending events have been processed.
 */
function spinEventLoop() {
    let diff = new Date() - spinEventLoop.lastSpin;
    if (diff < Preferences.get("calendar.threading.latency", 250)) {
        return Promise.resolve(false);
    }
    spinEventLoop.lastSpin = new Date();

    let deferred = PromiseUtils.defer();
    Services.tm.currentThread.dispatch({ run: function() { return deferred.resolve(true); } }, 0);
    return deferred.promise;
}
spinEventLoop.lastSpin = new Date();
