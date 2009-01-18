/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Google Calendar Provider code.
 *
 * The Initial Developer of the Original Code is
 *   Philipp Kewisch <mozilla@kewis.ch>
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Joey Minta <jminta@gmail.com>
 *   Axel Zechner <axel.zechner@googlemail.com> - category support
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calIteratorUtils.jsm");

/**
 * getGoogleSessionManager
 * Shortcut to the google session manager
 */
function getGoogleSessionManager() {
    if (this.mObject === undefined) {
        this.mObject =
            Components.classes["@mozilla.org/calendar/providers/gdata/session-manager;1"]
                      .createInstance(Components.interfaces.calIGoogleSessionManager);
    }
    return this.mObject;
}

// Sandbox for evaluating extendedProperties.
var gGoogleSandbox;

/**
 * setCalendarPref
 * Helper to set an independant Calendar Preference, since I cannot use the
 * calendar manager because of early initialization Problems.
 *
 * @param aCalendar     The Calendar to set the pref for
 * @param aPrefName     The Preference name
 * @param aPrefType     The type of the preference ("BOOL", "INT", "CHAR")
 * @param aPrefValue    The Preference value
 *
 * @return              The value of aPrefValue
 *
 * @require aCalendar.googleCalendarName
 */
function setCalendarPref(aCalendar, aPrefName, aPrefType, aPrefValue) {

    setPref("calendar.google.calPrefs." + aCalendar.googleCalendarName + "." +
            aPrefName, aPrefValue, aPrefType);

    return aPrefValue;
}

/**
 * getCalendarPref
 * Helper to get an independant Calendar Preference, since I cannot use the
 * calendar manager because of early initialization Problems.
 *
 * @param aCalendar     The calendar to set the pref for
 * @param aPrefName     The preference name
 *
 * @return              The preference value
 *
 * @require aCalendar.googleCalendarName
 */
function getCalendarPref(aCalendar, aPrefName) {
    return getPrefSafe("calendar.google.calPrefs." +
                       aCalendar.googleCalendarName + "."  + aPrefName);
}

/**
 * getFormattedString
 * Returns the string from the properties file, formatted with args
 *
 * @param aBundleName   The .properties file to access
 * @param aStringName   The property to access
 * @param aFormatArgs   An array of arguments to format the string
 * @param aComponent    Optionally, the stringbundle component name
 * @return              The formatted string
 */
function getFormattedString(aBundleName, aStringName, aFormatArgs, aComponent) {
    return calGetString(aBundleName, aStringName, aFormatArgs, aComponent || "gdata-provider");
}

/**
 * getCalendarCredentials
 * Tries to get the username/password combination of a specific calendar name
 * from the password manager or asks the user.
 *
 * @param   in  aCalendarName   The calendar name to look up. Can be null.
 * @param   out aUsername       The username that belongs to the calendar.
 * @param   out aPassword       The password that belongs to the calendar.
 * @param   out aSavePassword   Should the password be saved?
 * @return  Could a password be retrieved?
 */
function getCalendarCredentials(aCalendarName,
                                aUsername,
                                aPassword,
                                aSavePassword) {
    return cal.auth.getCredentials(getFormattedString("gdata", "loginDialogTitle"),
                                   aCalendarName,
                                   aUsername,
                                   aPassword,
                                   aSavePassword);
}

/**
 * Gets the date and time that Google's http server last sent us. Note the
 * passed argument is modified. This might not be the exact server time (i.e it
 * may be off by network latency), but it does give a good guess when syncing.
 *
 * @param aDate     The date to modify
 */
function getCorrectedDate(aDate) {

    if (!getCorrectedDate.mClockSkew) {
        return aDate;
    }

    aDate.second += getCorrectedDate.mClockSkew;
    return aDate;
}

/**
 * The timezone service to translate Google timezones.
 */
var gdataTimezoneService = {
    ctz: getTimezoneService(),

    get floating gTS_get_floating() {
        return this.ctz.floating;
    },

    get UTC gTS_get_UTC() {
        return this.ctz.UTC;
    },

    get version gTS_get_version() {
        return this.ctz.version;
    },

    get defaultTimezone gTS_get_defaultTimezone() {
        return this.ctz.defaultTimezone;
    },

    getTimezone: function gTS_getTimezone(aTzid) {
        if (aTzid == "Etc/GMT") {
            // Most timezones are covered by the timezone service, there is one
            // exception I've found out about. GMT without DST is pretty close
            // to UTC, lets take it.
            return UTC();
        }

        var baseTZ = this.ctz.getTimezone(aTzid);
        ASSERT(baseTZ, "Unknown Timezone requested: " + aTzid);
        return baseTZ;
    }
};

/**
 * passwordManagerSave
 * Helper to insert an entry to the password manager.
 *
 * @param aUserName     The username to search
 * @param aPassword     The corresponding password
 */
function passwordManagerSave(aUsername, aPassword) {
    cal.auth.passwordManagerSave(aUsername, aPassword, aUsername, "Google Calendar");
}

/**
 * passwordManagerGet
 * Helper to retrieve an entry from the password manager
 *
 * @param in  aUsername     The username to search
 * @param out aPassword     The corresponding password
 * @return                  Does an entry exist in the password manager
 */
function passwordManagerGet(aUsername, aPassword) {
    return cal.auth.passwordManagerGet(aUsername, aPassword, aUsername, "Google Calendar");
}

/**
 * passwordManagerRemove
 * Helper to remove an entry from the password manager
 *
 * @param aUsername     The username to remove.
 * @return              Could the user be removed?
 */
function passwordManagerRemove(aUsername) {
    return cal.auth.passwordManagerRemove(aUsername, aUsername, "Google Calendar");
}

/**
 * ItemToXMLEntry
 * Converts a calIEvent to a string of xml data.
 *
 * @param aItem         The item to convert
 * @param aAuthorEmail  The email of the author of the event
 * @param aAuthorName   The full name of the author of the event
 * @return              The xml data of the item
 */
function ItemToXMLEntry(aItem, aAuthorEmail, aAuthorName) {

    var selfIsOrganizer = (!aItem.organizer ||
                            aItem.organizer.id == "mailto:" + aItem.calendar.googleCalendarName);

    function addExtendedProperty(aName, aValue) {
        if (!selfIsOrganizer || !aValue) {
            // We can't set extended properties if we are not the organizer,
            // discard. Also, if the value is null/false, we can delete the
            // extended property by not adding it.
            return;
        }
        var gdExtendedProp = <gd:extendedProperty xmlns:gd={gd}/>;
        gdExtendedProp.@name = aName;
        gdExtendedProp.@value = aValue || "";
        entry.gd::extendedProperty += gdExtendedProp;
    }

    if (!aItem) {
        throw new Components.Exception("", Components.results.NS_ERROR_INVALID_ARG);
    }

    const kEVENT_SCHEMA = "http://schemas.google.com/g/2005#event.";

    // Namespace definitions
    var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
    var gCal = new Namespace("gCal", "http://schemas.google.com/gCal/2005");
    var atom = new Namespace("", "http://www.w3.org/2005/Atom");
    default xml namespace = atom;

    var entry = <entry xmlns={atom} xmlns:gd={gd} xmlns:gCal={gCal}/>;

    // Basic elements
    entry.category.@scheme = "http://schemas.google.com/g/2005#kind";
    entry.category.@term = "http://schemas.google.com/g/2005#event";

    entry.title.@type = "text";
    entry.title = aItem.title;

    // atom:content
    entry.content = aItem.getProperty("DESCRIPTION") || "";
    entry.content.@type = "text";

    // atom:author
    entry.author.name = aAuthorName;
    entry.author.email = aAuthorEmail;

    // gd:transparency
    var transp = aItem.getProperty("TRANSP") || "opaque";
    transp = kEVENT_SCHEMA + transp.toLowerCase();
    entry.gd::transparency.@value = transp;

    // gd:eventStatus
    var status = aItem.status || "confirmed";

    if (status == "CANCELLED") {
        // If the status is canceled, then the event will be deleted. Since the
        // user didn't choose to delete the event, we will protect him and not
        // allow this status to be set
        throw new Components.Exception("",
                                       Components.results.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA);
    } else if (status == "NONE") {
        status = "CONFIRMED";
    }
    entry.gd::eventStatus.@value = kEVENT_SCHEMA + status.toLowerCase();

    // gd:where
    entry.gd::where.@valueString = aItem.getProperty("LOCATION") || "";

    // gd:who
    if (getPrefSafe("calendar.google.enableAttendees", false)) {
        // XXX Only parse attendees if they are enabled, due to bug 407961

        var attendees = aItem.getAttendees({});
        if (aItem.organizer) {
            // Taking care of the organizer is the same as taking care of any other
            // attendee. Add the organizer to the local attendees list.
            attendees.push(aItem.organizer);
        }

        const attendeeStatusMap = {
            "REQ-PARTICIPANT": "required",
            "OPT-PARTICIPANT": "optional",
            "NON-PARTICIPANT": null,
            "CHAIR": null,

            "NEEDS-ACTION": "invited",
            "ACCEPTED": "accepted",
            "DECLINED": "declined",
            "TENTATIVE": "tentative",
            "DELEGATED": "tentative"
        };

        for each (var attendee in attendees) {
            if (attendee.userType && attendee.userType != "INDIVIDUAL") {
                // We can only take care of individuals.
                continue;
            }

            var xmlAttendee = <gd:who xmlns:gd={gd}/>;

            // Strip "mailto:" part
            xmlAttendee.@email = attendee.id.replace(/^mailto:/, "");

            if (attendee.isOrganizer) {
                xmlAttendee.@rel = kEVENT_SCHEMA + "organizer";
            } else {
                xmlAttendee.@rel = kEVENT_SCHEMA + "attendee";
            }

            if (attendee.commonName) {
                xmlAttendee.@valueString = attendee.commonName;
            }

            if (attendeeStatusMap[attendee.role]) {
                xmlAttendee.gd::attendeeType.@value = kEVENT_SCHEMA +
                    attendeeStatusMap[attendee.role];
            }

            if (attendeeStatusMap[attendee.participationStatus]) {
                xmlAttendee.gd::attendeeStatus.@value = kEVENT_SCHEMA +
                    attendeeStatusMap[attendee.participationStatus];
            }

            entry.gd::who += xmlAttendee;
        }
    }

    // Don't notify attendees by default. Use a preference in case the user
    // wants this to be turned on.
    var notify = getPrefSafe("calendar.google.sendEventNotifications", false);
    entry.gCal::sendEventNotifications.@value = (notify ? "true" : "false");

    // gd:when
    var duration = aItem.endDate.subtractDate(aItem.startDate);
    entry.gd::when.@startTime = cal.toRFC3339(aItem.startDate);
    entry.gd::when.@endTime = cal.toRFC3339(aItem.endDate);

    // gd:reminder
    let alarms = aItem.getAlarms({});
    let actionMap = {
        DISPLAY: "alert",
        EMAIL: "email",
        SMS: "sms"
    };
    if (selfIsOrganizer) {
        for (let i = 0; i < 5 && i < alarms.length; i++) {
            let alarm = alarms[i];
            let gdReminder = <gd:reminder xmlns:gd={gd}/>;
            if (alarm.related == alarm.ALARM_RELATED_ABSOLUTE) {
                // Setting an absolute date can be done directly. Google will take
                // care of calculating the offset.
                gdReminder.@absoluteTime = cal.toRFC3339(alarm.alarmDate);
            } else {
                let alarmOffset = alarm.offset;
                if (alarm.related == alarm.ALARM_RELATED_END) {
                    // Google always uses an alarm offset related to the start time
                    // for relative alarms.
                    alarmOffset = alarmOffset.clone();
                    alarmOffset.addDuration(duration);
                }

                gdReminder.@minutes = -alarmOffset.inSeconds / 60;
                gdReminder.@method = actionMap[alarm.action] || "alert";
            }


            if (aItem.recurrenceInfo) {
                // On recurring items, set the reminder directly in the <entry> tag.
                entry.gd::reminder += gdReminder;
            } else {
                // Otherwise, its a child of the gd:when element
                entry.gd::when.gd::reminder += gdReminder;
            }
        }
    } else if (alarms.length) {
        // We need to reset this so the item gets returned correctly.
        aItem.clearAlarms();
    }

    // gd:extendedProperty (alarmLastAck)
    addExtendedProperty("X-MOZ-LASTACK", cal.toRFC3339(aItem.alarmLastAck));

    // XXX While Google now supports multiple alarms and alarm values, we still
    // need to fix bug 353492 first so we can better take care of finding out
    // what alarm is used for snoozing.

    // gd:extendedProperty (snooze time)
    var itemSnoozeTime = aItem.getProperty("X-MOZ-SNOOZE-TIME");
    var icalSnoozeTime = null;
    if (itemSnoozeTime) {
        // The propery is saved as a string, translate back to calIDateTime.
        icalSnoozeTime = cal.createDateTime();
        icalSnoozeTime.icalString = itemSnoozeTime;
    }
    addExtendedProperty("X-MOZ-SNOOZE-TIME", cal.toRFC3339(icalSnoozeTime));

    // gd:extendedProperty (snooze recurring alarms)
    var snoozeValue = "";
    if (aItem.recurrenceInfo) {
        // This is an evil workaround since we don't have a really good system
        // to save the snooze time for recurring alarms or even retrieve them
        // from the event. This should change when we have multiple alarms
        // support.
        var snoozeObj = {};
        var enumerator = aItem.propertyEnumerator;
        while (enumerator.hasMoreElements()) {
            var prop = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
            if (prop.name.substr(0, 18) == "X-MOZ-SNOOZE-TIME-") {
                // We have a snooze time for a recurring event, add it to our object
                snoozeObj[prop.name.substr(18)] = prop.value;
            }
        }
        snoozeValue = snoozeObj.toSource();
    }
    // Now save the snooze object in source format as an extended property. Do
    // so always, since its currently impossible to unset extended properties.
    addExtendedProperty("X-GOOGLE-SNOOZE-RECUR", snoozeValue);

    // gd:visibility
    var privacy = aItem.privacy || "default";
    entry.gd::visibility.@value = kEVENT_SCHEMA + privacy.toLowerCase();

    // categories
    // Google does not support categories natively, but allows us to store data
    // as an "extendedProperty", so we do here
    addExtendedProperty("X-MOZ-CATEGORIES",
                        categoriesArrayToString(aItem.getCategories({})));

    // gd:recurrence
    if (aItem.recurrenceInfo) {
        try {
            const kNEWLINE = "\r\n";
            var icalString;
            var recurrenceItems = aItem.recurrenceInfo.getRecurrenceItems({});

            // Dates of the master event
            var startTZID = aItem.startDate.timezone.tzid;
            var endTZID = aItem.endDate.timezone.tzid;
            icalString = "DTSTART;TZID=" + startTZID
                         + ":" + aItem.startDate.icalString + kNEWLINE
                         + "DTEND;TZID=" + endTZID
                         + ":"  + aItem.endDate.icalString + kNEWLINE;

            // Add all recurrence items to the ical string
            for each (var ritem in recurrenceItems) {
                var prop = ritem.icalProperty;
                if (calInstanceOf(ritem, Components.interfaces.calIRecurrenceDate)) {
                    // EXDATES require special casing, since they might contain
                    // a TZID. To avoid the need for conversion of TZID strings,
                    // convert to UTC before serialization.
                    prop.valueAsDatetime = ritem.date.getInTimezone(UTC());
                }
                icalString += prop.icalString;
            }

            // Put the ical string in a <gd:recurrence> tag
            entry.gd::recurrence = icalString + kNEWLINE;
        } catch (e) {
            LOG("Error: " + e);
        }
    }

    // gd:originalEvent
    if (aItem.recurrenceId) {
        entry.gd::originalEvent.@id = aItem.parentItem.id;
        entry.gd::originalEvent.gd::when.@startTime =
            cal.toRFC3339(aItem.recurrenceId.getInTimezone(UTC()));
    }

    // While it may sometimes not work out, we can always try to set the uid and
    // sequence properties
    entry.gCal::sequence.@value = aItem.getProperty("SEQUENCE") || 0;
    entry.gCal::uid.@value = aItem.id || "";

    // TODO gd:comments: Enhancement tracked in bug 362653

    // XXX Google currently has no priority support. See
    // http://code.google.com/p/google-gdata/issues/detail?id=52
    // for details.

    return entry;
}

/**
 * relevantFieldsMatch
 * Tests if all google supported fields match
 *
 * @param a The reference item
 * @param b The comparing item
 * @return  true if all relevant fields match, otherwise false
 */
function relevantFieldsMatch(a, b) {

    // flat values
    if (a.id != b.id ||
        a.title != b.title ||
        a.status != b.status ||
        a.privacy != b.privacy) {
        return false;
    }

    function compareNotNull(prop) {
        let ap = a[prop];
        let bp = b[prop];
        return (ap && !bp || !ap && bp ||
                (typeof(ap) == 'object' && ap && bp &&
                 ap.compare && ap.compare(bp)));
    }

    // Object flat values
    if (compareNotNull("recurrenceInfo") ||
        /* Compare startDate and endDate */
        compareNotNull("startDate") ||
        compareNotNull("endDate") ||
        (a.startDate.isDate != b.startDate.isDate) ||
        (a.endDate.isDate != b.endDate.isDate)) {
        return false;
    }

    // Properties
    const kPROPERTIES = ["DESCRIPTION", "TRANSP", "X-GOOGLE-EDITURL",
                         "LOCATION", "X-MOZ-SNOOZE-TIME"];

    for each (let p in kPROPERTIES) {
        // null and an empty string should be handled as non-relevant
        if ((a.getProperty(p) || "") != (b.getProperty(p) || "")) {
            return false;
        }
    }

    // categories
    let aCat = a.getCategories({});
    let bCat = b.getCategories({});
    if ((aCat.length != bCat.length) ||
        aCat.some(function notIn(cat) { return (bCat.indexOf(cat) == -1); })) {
        return false;
    }

    // attendees and organzier
    let aa = a.getAttendees({});
    let ab = b.getAttendees({});
    if (aa.length != ab.length) {
        return false;
    }

    if ((a.organizer && !b.organizer) ||
        (!a.organizer && b.organizer) ||
        (a.organizer && b.organizer && a.organizer.id != b.organizer.id)) {
        return false;
    }

    // go through attendees in a, check if its id is in b
    for each (let attendee in aa) {
        let ba = b.getAttendeeById(attendee.id);
        if (!ba ||
            ba.participationStatus != attendee.participationStatus ||
            ba.commonName != attendee.commonName ||
            ba.isOrganizer != attendee.isOrganizer ||
            ba.role != attendee.role) {
            return false;
        }
    }

    // Alarms
    aa = a.getAlarms({});
    ab = b.getAlarms({});

    if (aa.length != ab.length) {
        return false;
    }

    let alarmMap = {};
    for each (let alarm in aa) {
        alarmMap[alarm.icalString] = true;
    }
    let found = 0;
    for each (let alarm in ab) {
        if (alarm.icalString in alarmMap) {
            found++;
        }
    }

    if (found != ab.length) {
        return false;
    }

    // Recurrence Items
    if (a.recurrenceInfo) {
        let ra = a.recurrenceInfo.getRecurrenceItems({});
        let rb = b.recurrenceInfo.getRecurrenceItems({});

        // If we have more or less, it definitly changed.
        if (ra.length != rb.length) {
            return false;
        }

        // I assume that if the recurrence pattern has not changed, the order
        // of the recurrence items should not change. Anything more will be
        // very expensive.
        for (let i = 0; i < ra.length; i++) {
            if (ra[i].icalProperty.icalString !=
                rb[i].icalProperty.icalString) {
                return false;
            }
        }
    }

    return true;
}

/**
 * getItemEditURI
 * Helper to get the item's edit URI
 *
 * @param aItem         The item to get it from
 * @return              The edit URI
 */
function getItemEditURI(aItem) {

    ASSERT(aItem);
    var edituri = aItem.getProperty("X-GOOGLE-EDITURL");
    if (!edituri) {
        // If the item has no edit uri, it is read-only
        throw new Components.Exception("", Components.interfaces.calIErrors.CAL_IS_READONLY);
    }
    return edituri;
}

function getIdFromEntry(aXMLEntry) {
    var gCal = new Namespace("gCal", "http://schemas.google.com/gCal/2005");
    var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
    var id = aXMLEntry.gCal::uid.@value.toString();
    return id.replace(/@google.com/,"");
}

function getRecurrenceIdFromEntry(aXMLEntry, aTimezone) {
    var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
    if (aXMLEntry.gd::originalEvent.toString().length > 0) {
        var rId = aXMLEntry.gd::originalEvent.gd::when.@startTime;
        return cal.fromRFC3339(rId.toString(), aTimezone);
    }
    return null;
}

/**
 * XMLEntryToItem
 * Converts a string of xml data to a calIEvent.
 *
 * @param aXMLEntry         The xml data of the item
 * @param aTimezone         The timezone the event is most likely in
 * @param aCalendar         The calendar this item will belong to. This needs to
 *                              be a calIGoogleCalendar instance.
 * @param aReferenceItem    The item to apply the information from the xml to.
 *                              If null, a new item will be used.
 * @return                  The calIEvent with the item data.
 */
function XMLEntryToItem(aXMLEntry, aTimezone, aCalendar, aReferenceItem) {

    if (!aXMLEntry || typeof(aXMLEntry) != "xml" || aXMLEntry.length() == 0) {
        throw new Components.Exception("", Components.results.NS_ERROR_FAILURE);
    }

    var gCal = new Namespace("gCal", "http://schemas.google.com/gCal/2005");
    var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
    var atom = new Namespace("", "http://www.w3.org/2005/Atom");
    default xml namespace = atom;

    let item = (aReferenceItem ? aReferenceItem.clone() : cal.createEvent());

    try {
        // id
        item.id = getIdFromEntry(aXMLEntry);

        // sequence
        item.setProperty("SEQUENCE",
                         aXMLEntry.gCal::sequence.@value.toString() || 0);

        // link (edit url)
        // Since Google doesn't set the edit url to be https if the request is
        // https, we need to work around this here.
        var editUrl = aXMLEntry.link.(@rel == 'edit').@href.toString();
        if (aCalendar.uri.schemeIs("https")) {
            editUrl = editUrl.replace(/^http:/, "https:");
        }
        item.setProperty("X-GOOGLE-EDITURL", editUrl);

        // link (alternative representation, html)
        var htmlUrl = aXMLEntry.link.(@rel == 'alternate').@href.toString();
        if (aCalendar.uri.schemeIs("https")) {
            htmlUrl = htmlUrl.replace(/^http:/, "https:");
        }
        item.setProperty("URL", htmlUrl);

        // title
        item.title = aXMLEntry.title.(@type == 'text');

        // content
        item.setProperty("DESCRIPTION",
                         aXMLEntry.content.(@type == 'text').toString());

        // gd:transparency
        item.setProperty("TRANSP",
                         aXMLEntry.gd::transparency.@value.toString()
                                  .substring(39).toUpperCase());

        // gd:eventStatus
        item.status = aXMLEntry.gd::eventStatus.@value.toString()
                               .substring(39).toUpperCase();

        // gd:reminder (preparation)
        // If a reference item was passed, it may already contain alarms. Since
        // we have no alarm id or such and the alarms are contained in every
        // feed, we can go ahead and clear the alarms here.
        item.clearAlarms();

        /**
         * Helper function to parse all reminders in a tagset.
         *
         * @param reminderTags      The tagset to parse.
         */
        function parseReminders(reminderTags) {
            if (aXMLEntry.gd::who.(@rel.substring(33) == "event.organizer")
                         .@email.toString() != aCalendar.googleCalendarName) {
                // We are not the organizer, so its not smart to set alarms on
                // this event.
                return;
            }
            const actionMap = {
                email: "EMAIL",
                alert: "DISPLAY",
                sms: "SMS"
            };
            for each (let reminderTag in reminderTags) {
                let alarm = cal.createAlarm();
                alarm.action = actionMap[reminderTag.@method] || "DISPLAY";
                if (reminderTag.@absoluteTime.toString()) {
                    alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_ABSOLUTE;
                    let absolute = cal.fromRFC3339(reminderTag.@absoluteTime,
                                                   aTimezone);
                    alarm.alarmDate = absolute;
                } else {
                    alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_START;
                    let alarmOffset = cal.createDuration();
                    if (reminderTag.@days.toString()) {
                        alarmOffset.days = -reminderTag.@days;
                    } else if (reminderTag.@hours.toString()) {
                        alarmOffset.hours = -reminderTag.@hours;
                    } else if (reminderTag.@minutes.toString()) {
                        alarmOffset.minutes = -reminderTag.@minutes;
                    } else {
                        // Invalid alarm, skip it
                        continue;
                    }
                    alarmOffset.normalize();
                    alarm.offset = alarmOffset;
                }
                item.addAlarm(alarm);
            }
        }

        // gd:when
        var recurrenceInfo = aXMLEntry.gd::recurrence.toString();
        if (recurrenceInfo.length == 0) {
            // If no recurrence information is given, then there will only be
            // one gd:when tag. Otherwise, we will be parsing the startDate from
            // the recurrence information.
            var when = aXMLEntry.gd::when;
            item.startDate = cal.fromRFC3339(when.@startTime, aTimezone);
            item.endDate = cal.fromRFC3339(when.@endTime, aTimezone);

            if (!item.endDate) {
                // We have a zero-duration event
                item.endDate = item.startDate.clone();
            }

            // gd:reminder
            parseReminders(aXMLEntry.gd::when.gd::reminder);
        } else {
            if (!item.recurrenceInfo) {
                item.recurrenceInfo = cal.createRecurrenceInfo(item);
            } else {
                item.recurrenceInfo.clearRecurrenceItems();
            }

            // We don't really care about google's timezone info for
            // now. This may change when bug 314339 is fixed. Split out
            // the timezone information so we only have the first bit
            var vevent = recurrenceInfo;
            var splitpos = recurrenceInfo.indexOf("BEGIN:VTIMEZONE");
            if (splitpos > -1) {
                // Sometimes (i.e if only DATE values are specified), no
                // timezone info is contained. Only remove it if it shows up.
                vevent = recurrenceInfo.substring(0, splitpos);
            }

            vevent = "BEGIN:VEVENT\n" + vevent + "END:VEVENT";
            var icsService = getIcsService();

            var rootComp = icsService.parseICS(vevent, gdataTimezoneService);
            var i = 0;
            var hasRecurringRules = false;
            for (let prop in cal.ical.propertyIterator(rootComp)) {
               switch (prop.propertyName) {
                    case "EXDATE":
                        var recItem = Components.classes["@mozilla.org/calendar/recurrence-date;1"]
                                      .createInstance(Components.interfaces.calIRecurrenceDate);
                        try {
                            recItem.icalProperty = prop;
                            item.recurrenceInfo.appendRecurrenceItem(recItem);
                            hasRecurringRules = true;
                        } catch (e) {
                            Components.utils.reportError(e);
                        }
                        break;
                    case "RRULE":
                        let recRule = cal.createRecurrenceRule();
                        try {
                            recRule.icalProperty = prop;
                            item.recurrenceInfo.appendRecurrenceItem(recRule);
                            hasRecurringRules = true;
                        } catch (e) {
                            Components.utils.reportError(e);
                        }
                        break;
                    case "DTSTART":
                        item.startDate = prop.valueAsDatetime;
                        break;
                    case "DTEND":
                        item.endDate = prop.valueAsDatetime;
                        break;
                }
            }

            if (!hasRecurringRules) {
                // Sometimes Google gives us events that have <gd:recurrence>
                // but contain no recurrence rules. Treat the event as a normal
                // event. See gdata issue 353.
                item.recurrenceInfo = null;
            }

            // gd:reminder (for recurring events)
            // This element is supplied as a direct child to the <entry> element
            // for recurring items.
            parseReminders(aXMLEntry.gd::reminder);
        }

        // gd:recurrenceException
        for each (var exception in aXMLEntry.gd::recurrenceException.(@specialized == "true").gd::entryLink.entry) {
            // We only want specialized exceptions, mainly becuase I haven't
            // quite found out if a non-specialized exception also corresponds
            // to a normal exception as libical knows it.
            var excItem = XMLEntryToItem(exception, aTimezone, aCalendar);

            // Google uses the status field to reflect negative exceptions.
            if (excItem.status == "CANCELED") {
                item.recurrenceInfo.removeOccurrenceAt(excItem.recurrenceId);
            } else {
                excItem.calendar = aCalendar.superCalendar;
                item.recurrenceInfo.modifyException(excItem, true);
            }
        }

        // gd:extendedProperty (alarmLastAck)
        var alarmLastAck = aXMLEntry.gd::extendedProperty
                           .(@name == "X-MOZ-LASTACK")
                           .@value.toString();
        item.alarmLastAck = cal.fromRFC3339(alarmLastAck, aTimezone);

        // gd:extendedProperty (snooze time)
        var xmlSnoozeTime = aXMLEntry.gd::extendedProperty
                         .(@name == "X-MOZ-SNOOZE-TIME").@value.toString();
        var dtSnoozeTime = cal.fromRFC3339(xmlSnoozeTime, aTimezone);
        var snoozeProperty = (dtSnoozeTime ? dtSnoozeTime.icalString : null);
        item.setProperty("X-MOZ-SNOOZE-TIME", snoozeProperty);

        // gd:extendedProperty (snooze recurring alarms)
        if (item.recurrenceInfo) {
            if (!gGoogleSandbox) {
                // Initialize sandbox if it does not already exist
                gGoogleSandbox = Components.utils.Sandbox("about:blank");
            }

            // Transform back the string into our snooze properties
            var snoozeString = aXMLEntry.gd::extendedProperty
                                        .(@name == "X-GOOGLE-SNOOZE-RECUR")
                                        .@value.toString();
            var snoozeObj = Components.utils.evalInSandbox(snoozeString,
                                                           gGoogleSandbox);
            if (snoozeObj) {
                for (var rid in snoozeObj) {
                    item.setProperty("X-MOZ-SNOOZE-TIME-" + rid,
                                     snoozeObj[rid]);
                }
            }
        }

        // gd:where
        item.setProperty("LOCATION",
                         aXMLEntry.gd::where.@valueString.toString());
        // gd:who
        if (getPrefSafe("calendar.google.enableAttendees", false)) {
            // XXX Only parse attendees if they are enabled, due to bug 407961

            // This object can easily translate Google's values to our values.
            const attendeeStatusMap = {
                // role
                "event.optional": "OPT-PARTICIPANT",
                "event.required": "REQ-PARTICIPANT",

                // Participation Statii
                "event.accepted": "ACCEPTED",
                "event.declined": "DECLINED",
                "event.invited": "NEEDS-ACTION",
                "event.tentative": "TENTATIVE"
            };

            // Clear all attendees in case a reference item was passed
            item.removeAllAttendees();

            // Iterate all attendee tags.
            for each (var who in aXMLEntry.gd::who) {
                let attendee = cal.createAttendee();

                var rel = who.@rel.toString().substring(33);
                var type = who.gd::attendeeType.@value.toString().substring(33);
                var status = who.gd::attendeeStatus.@value.toString().substring(33);

                attendee.id = "mailto:" + who.@email.toString();
                attendee.commonName = who.@valueString.toString();
                attendee.rsvp = "FALSE";
                attendee.userType = "INDIVIDUAL";
                attendee.isOrganizer = (rel == "event.organizer");
                attendee.participationStatus = attendeeStatusMap[status];
                attendee.role = attendeeStatusMap[type]
                attendee.makeImmutable();

                if (attendee.isOrganizer) {
                    item.organizer = attendee;
                } else {
                    item.addAttendee(attendee);
                }
            }
        }

        // gd:originalEvent
        item.recurrenceId = getRecurrenceIdFromEntry(aXMLEntry, aTimezone);

        // gd:visibility
        item.privacy = aXMLEntry.gd::visibility.@value.toString()
                                .substring(39).toUpperCase();

        // category
        // Google does not support categories natively, but allows us to store
        // data as an "extendedProperty", and here it's going to be retrieved
        // again
        var gdCategories = aXMLEntry.gd::extendedProperty
                                    .(@name == "X-MOZ-CATEGORIES")
                                    .@value.toString();
        var categories = categoriesStringToArray(gdCategories);
        item.setCategories(categories.length, categories);

        // published
        item.setProperty("CREATED", cal.fromRFC3339(aXMLEntry.published,
                                                    aTimezone));

        // updated (This must be set last!)
        item.setProperty("LAST-MODIFIED", cal.fromRFC3339(aXMLEntry.updated,
                                                          aTimezone));

        // TODO gd:comments: Enhancement tracked in bug 362653

        // XXX Google currently has no priority support. See
        // http://code.google.com/p/google-gdata/issues/detail?id=52
        // for details.
    } catch (e) {
        ERROR("Error parsing XML stream" + e);
        throw e;
    }
    return item;
}

/**
 * Expand an item to occurrences, if the operation's item filter requests it.
 * Otherwise returns the item in an array.
 *
 * @param aItem         The item to expand
 * @param aOperation    The calIGoogleRequest that contains the filter and
 *                        ranges.
 * @return              The (possibly expanded) items in an array.
 */
function expandItems(aItem, aOperation) {
    var expandedItems;
    if (aOperation.itemFilter &
        Components.interfaces.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES) {
        expandedItems = aItem.getOccurrencesBetween(aOperation.itemRangeStart,
                                                    aOperation.itemRangeEnd,
                                                    {});
        LOG("Expanded item " + aItem.title + " to " +
            expandedItems.length + " items");
    }
    return expandedItems || [aItem];
}

/**
 * Helper prototype to set a certain variable to the first item passed via get
 * listener. Cleans up code.
 */
function syncSetter(aObj) {
    this.mObj = aObj
}
syncSetter.prototype = {

    onGetResult: function syncSetter_onGetResult(aCal,
                                                 aStatus,
                                                 aIID,
                                                 aDetail,
                                                 aCount,
                                                 aItems) {
        this.mObj.value = aItems[0];
    },

    onOperationComplete: function syncSetter_onOperationComplete(aCal,
                                                                 aStatus,
                                                                 aOpType,
                                                                 aId,
                                                                 aDetail) {

        if (!Components.isSuccessCode(aStatus)) {
            this.mObj.value = null;
        }
    }
};

/**
 * LOGitem
 * Custom logging functions
 */
function LOGitem(item) {
    if (!item) {
        return;
    }

    var attendees = item.getAttendees({});
    var attendeeString = "";
    for each (var a in attendees) {
        attendeeString += "\n" + LOGattendee(a);
    }

    var rstr = "\n";
    if (item.recurrenceInfo) {
        var ritems = item.recurrenceInfo.getRecurrenceItems({});
        for each (var ritem in ritems) {
            rstr += "\t\t" + ritem.icalProperty.icalString;
        }

        rstr += "\tExceptions:\n";
        var exids = item.recurrenceInfo.getExceptionIds({});
        for each (var exc in exids) {
            rstr += "\t\t" + exc + "\n";
        }
    }

    let astr = "\n";
    let alarms = item.getAlarms({});
    for each (let alarm in alarms) {
        astr += "\t\t" + LOGalarm(alarm) + "\n";
    }


    LOG("Logging calIEvent:" +
        "\n\tid:" + item.id +
        "\n\tediturl:" + item.getProperty("X-GOOGLE-EDITURL") +
        "\n\tcreated:" + item.getProperty("CREATED") +
        "\n\tupdated:" + item.getProperty("LAST-MODIFIED") +
        "\n\ttitle:" + item.title +
        "\n\tcontent:" + item.getProperty("DESCRIPTION") +
        "\n\ttransparency:" + item.getProperty("TRANSP") +
        "\n\tstatus:" + item.status +
        "\n\tstartTime:" + item.startDate.toString() +
        "\n\tendTime:" + item.endDate.toString() +
        "\n\tlocation:" + item.getProperty("LOCATION") +
        "\n\tprivacy:" + item.privacy +
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
         "\n\t\t\tIs Organizer: " +  (aAttendee.isOrganizer ? "yes" : "no") +
         "\n\t\t\tRole: " + aAttendee.role +
         "\n\t\t\tStatus: " + aAttendee.participationStatus);
}

function LOGalarm(aAlarm) {
    if (!aAlarm) {
        return "";
    }

    let enumerator = aAlarm.propertyEnumerator;
    let xpropstr = "";
    while (enumerator.hasMoreElements()) {
        let el = enumerator.getNext();
        xpropstr += "\n\t\t\t" + el.key + ":" + el.value;
    }

    return ("\n\t\tAction: " +  aAlarm.action +
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

    LOG("Interval from " + aInterval.interval.start + " to "
                         + aInterval.interval.end + " is " + type);
}
