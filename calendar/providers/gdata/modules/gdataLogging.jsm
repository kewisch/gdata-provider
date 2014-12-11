/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["LOGitem", "LOGverbose", "LOGinterval", "stringException"];

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm").shimIt(this);

CuImport("resource://calendar/modules/calUtils.jsm", this);
CuImport("resource://gre/modules/Preferences.jsm", this);

function LOGverbose(aStr) {
    if (Preferences.get("calendar.debug.log.verbose", false)) {
        cal.LOG(aStr);
    }
}

function stringException(e) {
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
function LOGitem(item) {
    if (!item) {
        return;
    }

    let attendees = item.getAttendees({});
    let attendeeString = "";
    for each (let a in attendees) {
        attendeeString += "\n" + LOGattendee(a);
    }

    let rstr = "\n";
    if (item.recurrenceInfo) {
        let ritems = item.recurrenceInfo.getRecurrenceItems({});
        for each (let ritem in ritems) {
            rstr += "\t\t" + ritem.icalProperty.icalString;
        }

        rstr += "\tExceptions:\n";
        let exids = item.recurrenceInfo.getExceptionIds({});
        for each (let exc in exids) {
            rstr += "\t\t" + exc + "\n";
        }
    }

    let astr = "\n";
    let alarms = item.getAlarms({});
    for each (let alarm in alarms) {
        astr += "\t\t" + LOGalarm(alarm) + "\n";
    }

    LOGverbose("[calGoogleCalendar] Logging calIEvent:" +
        "\n\tid:" + item.id +
        "\n\tcreated:" + item.getProperty("CREATED") +
        "\n\tupdated:" + item.getProperty("LAST-MODIFIED") +
        "\n\ttitle:" + item.title +
        "\n\tdescription:" + item.getProperty("DESCRIPTION") +
        "\n\ttransparency:" + item.getProperty("TRANSP") +
        "\n\tstatus:" + item.status +
        "\n\tstartTime:" + (item.startDate && item.startDate.toString()) +
        "\n\tendTime:" + (item.endDate && item.endDate.toString()) +
        "\n\tlocation:" + item.getProperty("LOCATION") +
        "\n\tprivacy:" + item.privacy +
        "\n\tsequence:" + item.getProperty("SEQUENCE") +
        "\n\talarmLastAck:" + item.alarmLastAck +
        "\n\tsnoozeTime:" + item.getProperty("X-MOZ-SNOOZE-TIME") +
        "\n\tisOccurrence: " + (item.recurrenceId != null) +
        "\n\tOrganizer: " + LOGattendee(item.organizer) +
        "\n\tAttendees: " + attendeeString +
        "\n\trecurrence: " + (rstr.length > 1 ? "yes: " + rstr : "no") +
        "\n\talarms: " + (astr.length > 1 ? "yes: " + astr : "no"));
}

function LOGattendee(aAttendee, asString) {
    return aAttendee &&
        ("\n\t\tID: " + aAttendee.id +
         "\n\t\t\tName: " + aAttendee.commonName +
         "\n\t\t\tRsvp: " + aAttendee.rsvp +
         "\n\t\t\tIs Organizer: " + (aAttendee.isOrganizer ? "yes" : "no") +
         "\n\t\t\tRole: " + aAttendee.role +
         "\n\t\t\tStatus: " + aAttendee.participationStatus);
}

function LOGalarm(aAlarm) {
    if (!aAlarm) {
        return "";
    }

    let enumerator = aAlarm.propertyEnumerator;
    let xpropstr = "";
    while (enumerator && enumerator.hasMoreElements()) {
        let el = enumerator.getNext();
        xpropstr += "\n\t\t\t" + el.key + ":" + el.value;
    }

    return ("\n\t\tAction: " + aAlarm.action +
            "\n\t\tOffset: " + (aAlarm.offset && aAlarm.offset.toString()) +
            "\n\t\talarmDate: " + (aAlarm.alarmDate && aAlarm.alarmDate.toString()) +
            "\n\t\trelated: " + aAlarm.related +
            "\n\t\trepeat: " + aAlarm.repeat +
            "\n\t\trepeatOffset: " + (aAlarm.repeatOffset && aAlarm.repeatOffset.toString()) +
            "\n\t\trepeatDate: " + (aAlarm.repeatDate && aAlarm.repeatDate.toString()) +
            "\n\t\tdescription: " + aAlarm.description +
            "\n\t\tsummary: " + aAlarm.summary +
            "\n\t\tproperties: " + (xpropstr.length > 0 ? "yes:" + xpropstr : "no"));
}

function LOGinterval(aInterval) {
    const fbtypes = Components.interfaces.calIFreeBusyInterval;
    if (aInterval.freeBusyType == fbtypes.FREE) {
        type = "FREE";
    } else if (aInterval.freeBusyType == fbtypes.BUSY) {
        type = "BUSY";
    } else {
        type = aInterval.freeBusyType + "(UNKNOWN)";
    }

    cal.LOG("[calGoogleCalendar] Interval from " +
            aInterval.interval.start + " to " + aInterval.interval.end +
            " is " + type);
}
