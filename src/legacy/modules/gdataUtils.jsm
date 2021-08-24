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
