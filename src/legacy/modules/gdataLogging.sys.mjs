/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  cal: "resource:///modules/calendar/calUtils.sys.mjs" /* global cal */
});


ChromeUtils.defineLazyGetter(lazy, "log", () => {
  return console.createInstance({ // eslint-disable-line no-console
    prefix: "[gdata-provider]",
    maxLogLevel: "Warn",
    maxLogLevelPref: "calendar.loglevel",
  });
});

export function LOGerror(aStr) {
  lazy.log.error(aStr);
}

export function LOG(aStr) {
  lazy.log.debug(aStr);
}


export function LOGverbose(aStr) {
  lazy.log.debug(aStr);
}

export function stringException(e) {
  if ("fileName" in e && "lineNumber" in e) {
    return " (" + e.fileName + ":" + e.lineNumber + "):" + e;
  } else {
    return e.toString();
  }
}

/**
 * LOGitem
 * Custom logging functions
 */
export function LOGitem(item) {
  if (!item) {
    return;
  }

  let attendees = item.getAttendees({});
  let attendeeString = "";
  for (let a of attendees) {
    attendeeString += "\n" + LOGattendee(a);
  }

  let rstr = "\n";
  if (item.recurrenceInfo) {
    let ritems = item.recurrenceInfo.getRecurrenceItems({});
    for (let ritem of ritems) {
      rstr += "\t\t" + ritem.icalProperty.icalString;
    }

    rstr += "\tExceptions:\n";
    let exids = item.recurrenceInfo.getExceptionIds({});
    for (let exc of exids) {
      rstr += "\t\t" + exc + "\n";
    }
  }

  let astr = "\n";
  let alarms = item.getAlarms({});
  for (let alarm of alarms) {
    astr += "\t\t" + LOGalarm(alarm) + "\n";
  }

  LOGverbose(
    "[calGoogleCalendar] Logging calIEvent:" +
      "\n\tid:" +
      item.id +
      "\n\ttype:" +
      item.getProperty("X-GOOGLE-EVENT-TYPE") +
      "\n\tcreated:" +
      item.getProperty("CREATED") +
      "\n\tupdated:" +
      item.getProperty("LAST-MODIFIED") +
      "\n\ttitle:" +
      item.title +
      "\n\tdescription:" +
      item.getProperty("DESCRIPTION") +
      "\n\ttransparency:" +
      item.getProperty("TRANSP") +
      "\n\tstatus:" +
      item.status +
      "\n\tstartTime:" +
      (item.startDate && item.startDate.toString()) +
      "\n\tendTime:" +
      (item.endDate && item.endDate.toString()) +
      "\n\tlocation:" +
      item.getProperty("LOCATION") +
      "\n\tprivacy:" +
      item.privacy +
      "\n\tsequence:" +
      item.getProperty("SEQUENCE") +
      "\n\talarmLastAck:" +
      item.alarmLastAck +
      "\n\tsnoozeTime:" +
      item.getProperty("X-MOZ-SNOOZE-TIME") +
      "\n\tisOccurrence: " +
      (item.recurrenceId != null) +
      "\n\tOrganizer: " +
      LOGattendee(item.organizer) +
      "\n\tAttendees: " +
      attendeeString +
      "\n\trecurrence: " +
      (rstr.length > 1 ? "yes: " + rstr : "no") +
      "\n\talarms: " +
      (astr.length > 1 ? "yes: " + astr : "no")
  );
}

function LOGattendee(aAttendee, asString) {
  return (
    aAttendee &&
    "\n\t\tID: " +
      aAttendee.id +
      "\n\t\t\tName: " +
      aAttendee.commonName +
      "\n\t\t\tRsvp: " +
      aAttendee.rsvp +
      "\n\t\t\tIs Organizer: " +
      (aAttendee.isOrganizer ? "yes" : "no") +
      "\n\t\t\tRole: " +
      aAttendee.role +
      "\n\t\t\tStatus: " +
      aAttendee.participationStatus
  );
}

function LOGalarm(aAlarm) {
  if (!aAlarm) {
    return "";
  }

  let xpropstr = "";
  for (let [name, value] of aAlarm.properties) {
    xpropstr += "\n\t\t\t" + name + ":" + value;
  }

  return (
    "\n\t\tAction: " +
    aAlarm.action +
    "\n\t\tOffset: " +
    (aAlarm.offset && aAlarm.offset.toString()) +
    "\n\t\talarmDate: " +
    (aAlarm.alarmDate && aAlarm.alarmDate.toString()) +
    "\n\t\trelated: " +
    aAlarm.related +
    "\n\t\trepeat: " +
    aAlarm.repeat +
    "\n\t\trepeatOffset: " +
    (aAlarm.repeatOffset && aAlarm.repeatOffset.toString()) +
    "\n\t\trepeatDate: " +
    (aAlarm.repeatDate && aAlarm.repeatDate.toString()) +
    "\n\t\tdescription: " +
    aAlarm.description +
    "\n\t\tsummary: " +
    aAlarm.summary +
    "\n\t\tproperties: " +
    (xpropstr.length ? "yes:" + xpropstr : "no")
  );
}

export function LOGinterval(aInterval) {
  const fbtypes = Ci.calIFreeBusyInterval;
  let type;
  if (aInterval.freeBusyType == fbtypes.FREE) {
    type = "FREE";
  } else if (aInterval.freeBusyType == fbtypes.BUSY) {
    type = "BUSY";
  } else {
    type = aInterval.freeBusyType + " (UNKNOWN)";
  }

  LOG(
    "[calGoogleCalendar] Interval from " +
      aInterval.interval.start +
      " to " +
      aInterval.interval.end +
      " is " +
      type
  );
}
