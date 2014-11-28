/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calXMLUtils.jsm");
Components.utils.import("resource://calendar/modules/calIteratorUtils.jsm");
Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

const atomNS = "http://www.w3.org/2005/Atom";
const gdNS = "http://schemas.google.com/g/2005";
const gcalNS = "http://schemas.google.com/gCal/2005";

function gdataNSResolver(prefix) {
    const ns = {
        atom: atomNS,
        gd: gdNS,
        gCal: gcalNS
    };

    return ns[prefix] || atomNS;
}

function gdataXPath(aNode, aExpr, aType) {
    return cal.xml.evalXPath(aNode, aExpr, gdataNSResolver, aType);
}
function gdataXPathFirst(aNode, aExpr, aType) {
    // Different than the caldav/ics functions, this one will return an empty string on null
    return cal.xml.evalXPathFirst(aNode, aExpr, gdataNSResolver, aType) || "";
}

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

    Preferences.set("calendar.google.calPrefs." + aCalendar.googleCalendarName + "." +
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
    return Preferences.get("calendar.google.calPrefs." +
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
    return cal.auth.getCredentials("Google Calendar",
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
    ctz: cal.getTimezoneService(),

    get floating() {
        return this.ctz.floating;
    },

    get UTC() {
        return this.ctz.UTC;
    },

    get version() {
        return this.ctz.version;
    },

    get defaultTimezone() {
        return this.ctz.defaultTimezone;
    },

    getTimezone: function gTS_getTimezone(aTzid) {
        if (aTzid == "Etc/GMT") {
            // Most timezones are covered by the timezone service, there is one
            // exception I've found out about. GMT without DST is pretty close
            // to UTC, lets take it.
            return UTC();
        }

        let baseTZ = this.ctz.getTimezone(aTzid);
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
 * If the operation has signaled that a conflict occurred, then prompt the user
 * to overwrite. If the user chooses to overwrite, restart the request with the
 * right parameters so the request succeeds.
 *
 * @param aOperation        The operation to check
 * @param aItem             The updated item from the response
 * @return                  False if further processing should be cancelled
 */
function resolveConflicts(aOperation, aItem) {
    if (aItem && (aOperation.status == kGOOGLE_CONFLICT_DELETED ||
                  aOperation.status == kGOOGLE_CONFLICT_MODIFY)) {
        if (aItem == "SEQUENCE-HACK") {
            // Working around a Google issue here, see what happens on a 400
            // code in calGoogleRequest.js. This will cause a new request
            // without the sequence number. In return, we get a new item with
            // the correct sequence number.
            let newItem =  aOperation.newItem.clone();
            let session = aOperation.calendar.session;
            newItem.deleteProperty("SEQUENCE");
            let xmlEntry = ItemToXMLEntry(newItem, aOperation.calendar,
                                          session.userName, session.fullName);

            aOperation.newItem = newItem;
            aOperation.setUploadData("application/atom+xml; charset=UTF-8", cal.xml.serializeDOM(xmlEntry));
            session.asyncItemRequest(aOperation);
            return false;
        } else if (aOperation.status == kGOOGLE_CONFLICT_DELETED &&
                   aOperation.type == aOperation.DELETE) {
            // Deleted on the server and deleted locally. Great!
            return true;
        } else {
            // If a conflict occurred, then prompt
            let method = (aOperation.type == aOperation.DELETE ? "delete" : "modify")
            let inputItem = aOperation.oldItem || aOperation.newItem;
            let overwrite = cal.promptOverwrite(method, inputItem);
            if (overwrite) {
                if (aOperation.status == kGOOGLE_CONFLICT_DELETED &&
                    aOperation.type == aOperation.MODIFY) {
                    // The item was deleted on the server, but modified locally.
                    // Add it again
                    aOperation.type = aOperation.ADD;
                    aOperation.uri = aOperation.calendar.fullUri.spec;
                    aOperation.calendar.session.asyncItemRequest(aOperation);
                    return false;
                } else if (aOperation.status == kGOOGLE_CONFLICT_MODIFY &&
                           aOperation.type == aOperation.MODIFY) {
                    // The item was modified in both places, repeat the current
                    // request with the edit uri of the updated event
                    aOperation.uri = getItemEditURI(aItem);
                    aOperation.calendar.session.asyncItemRequest(aOperation);
                    return false;
                } else if (aOperation.status == kGOOGLE_CONFLICT_MODIFY &&
                           aOperation.type == aOperation.DELETE) {
                    // Modified on the server, deleted locally. Just repeat the
                    // delete request with the updated edit uri.
                    aOperation.uri = getItemEditURI(aItem);
                    aOperation.calendar.session.asyncItemRequest(aOperation);
                    return false;
                }
            }
        }
        // Otherwise, we can just continue using the item that was parsed, it
        // is the newest version on the server.
    }
    return true;
}

/**
 * Helper function to convert raw data directly into a calIItemBase. If the
 * passed operation signals an error, then throw an exception
 *
 * @param aOperation        The operation to check for errors
 * @param aData             The result from the response
 * @param aGoogleCalendar   The calIGoogleCalendar to operate on
 * @param aReferenceItem    The reference item to apply the information to
 * @return                  The parsed item
 * @throws                  An exception on a parsing or request error
 */
function DataToItem(aOperation, aData, aGoogleCalendar, aReferenceItem) {
    if (aOperation.status == kGOOGLE_CONFLICT_DELETED ||
        aOperation.status == kGOOGLE_CONFLICT_MODIFY ||
        Components.isSuccessCode(aOperation.status)) {

        let item;
        if (aData == "SEQUENCE-HACK") {
            // Working around a Google issue here, see what happens on a 400
            // code in calGoogleRequest.js. This will be processed in
            // resolveConflicts().
            return "SEQUENCE-HACK";
        }

        if (aData && aData.length) {
            let xml = cal.xml.parseString(aData);
            cal.LOG("[calGoogleCalendar] Parsing entry:\n" + aData + "\n");

            // Get the local timezone from the preferences
            let timezone = calendarDefaultTimezone();

            // Parse the Item with the given timezone
            item = XMLEntryToItem(xml.documentElement, timezone,
                                  aGoogleCalendar,
                                  aReferenceItem);
        } else {
            cal.LOG("[calGoogleCalendar] No content, using reference item instead ");
            // No data happens for example on delete. Just assume the reference
            // item.
            item = aReferenceItem.clone();
        }

        LOGitem(item);
        item.calendar = aGoogleCalendar.superCalendar;
        return item;
    } else {
        throw new Components.Exception(aData, aOperation.status);
    }
}

/**
 * ItemToXMLEntry
 * Converts a calIEvent to a string of xml data.
 *
 * @param aItem         The item to convert
 * @param aCalendar     The calendar to use, this must be a calIGoogleCalendar
 * @param aAuthorEmail  The email of the author of the event
 * @param aAuthorName   The full name of the author of the event
 * @return              The xml data of the item
 */
function ItemToXMLEntry(aItem, aCalendar, aAuthorEmail, aAuthorName) {
    let selfIsOrganizer = (!aItem.organizer ||
                            aItem.organizer.id == "mailto:" + aCalendar.googleCalendarName);

    function addExtendedProperty(aName, aValue) {
        if (!selfIsOrganizer || !aValue) {
            // We can't set extended properties if we are not the organizer,
            // discard. Also, if the value is null/false, we can delete the
            // extended property by not adding it.
            return;
        }
        let gdExtendedProp = document.createElementNS(gdNS, "extendedProperty");
        gdExtendedProp.setAttribute("name", aName);
        gdExtendedProp.setAttribute("value", aValue || "");
        entry.appendChild(gdExtendedProp);
    }

    if (!aItem) {
        throw new Components.Exception("", Components.results.NS_ERROR_INVALID_ARG);
    }

    const kEVENT_SCHEMA = "http://schemas.google.com/g/2005#event.";

    // Document creation
    let document = cal.xml.parseString('<entry xmlns="' + atomNS + '" xmlns:gd="' + gdNS + '" xmlns:gCal="' + gcalNS + '"/>');
    let entry = document.documentElement;

    // Helper functions
    function elemNS(ns, name) document.createElementNS(ns, name);
    function addElemNS(ns, name, parent) (parent || entry).appendChild(elemNS(ns, name));

    // Basic elements
    let kindElement = addElemNS(atomNS, "category");
    kindElement.setAttribute("scheme", "http://schemas.google.com/g/2005#kind");
    kindElement.setAttribute("term", "http://schemas.google.com/g/2005#event");

    let titleElement = addElemNS(atomNS, "title");
    titleElement.setAttribute("type", "text");
    titleElement.textContent = aItem.title;

    // atom:content
    let contentElement = addElemNS(atomNS, "content");
    contentElement.setAttribute("type", "text");
    contentElement.textContent = aItem.getProperty("DESCRIPTION") || "";

    // atom:author
    let authorElement = addElemNS(atomNS, "author");
    addElemNS(atomNS, "name", authorElement).textContent = aAuthorName || aAuthorEmail;
    addElemNS(atomNS, "email", authorElement).textContent = aAuthorEmail;

    // gd:transparency
    let transpElement = addElemNS(gdNS, "transparency");
    let transpValue = aItem.getProperty("TRANSP") || "opaque";
    transpElement.setAttribute("value", kEVENT_SCHEMA + transpValue.toLowerCase());

    // gd:eventStatus
    let status = aItem.status || "confirmed";
    if (status == "CANCELLED") {
        // If the status is canceled, then the event will be deleted. Since the
        // user didn't choose to delete the event, we will protect him and not
        // allow this status to be set
        throw new Components.Exception("",
                                       Components.results.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA);
    } else if (status == "NONE") {
        status = "CONFIRMED";
    }
    addElemNS(gdNS, "eventStatus").setAttribute("value", kEVENT_SCHEMA + status.toLowerCase());

    // gd:where
    addElemNS(gdNS, "where").setAttribute("valueString", aItem.getProperty("LOCATION") || "");

    // gd:who
    if (Preferences.get("calendar.google.enableAttendees", false)) {
        // XXX Only parse attendees if they are enabled, due to bug 407961

        let attendees = aItem.getAttendees({});
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

        for each (let attendee in attendees) {
            if (attendee.userType && attendee.userType != "INDIVIDUAL") {
                // We can only take care of individuals.
                continue;
            }

            let xmlAttendee = addElemNS(gdNS, "who");

            // Strip "mailto:" part
            xmlAttendee.setAttribute("email", attendee.id.replace(/^mailto:/, ""));

            if (attendee.isOrganizer) {
                xmlAttendee.setAttribute("rel", kEVENT_SCHEMA + "organizer");
            } else {
                xmlAttendee.setAttribute("rel", kEVENT_SCHEMA + "attendee");
            }

            if (attendee.commonName) {
                xmlAttendee.setAttribute("valueString", attendee.commonName);
            }

            if (attendeeStatusMap[attendee.role]) {
                let attendeeTypeElement = addElemNS(gdNS, "attendeeType", xmlAttendee);
                let attendeeTypeValue = kEVENT_SCHEMA + attendeeStatusMap[attendee.role];
                attendeeTypeElement.setAttribute("value", attendeeTypeValue);
            }

            if (attendeeStatusMap[attendee.participationStatus]) {
                let attendeeStatusElement = addElemNS(gdNS, "attendeeStatus", xmlAttendee);
                let attendeeStatusValue = kEVENT_SCHEMA + attendeeStatusMap[attendee.participationStatus];
                attendeeStatusElement.setAttribute("value", attendeeStatusValue);
            }
        }
    }

    // Don't notify attendees by default. Use a preference in case the user
    // wants this to be turned on.
    let notify = Preferences.get("calendar.google.sendEventNotifications", false);
    addElemNS(gcalNS, "sendEventNotifications").setAttribute("value", notify ? "true" : "false");

    // gd:when
    let duration = aItem.endDate.subtractDate(aItem.startDate);
    let whenElement;
    if (!aItem.recurrenceInfo) {
        // gd:when isn't allowed for recurring items where gd:recurrence is set
        whenElement = addElemNS(gdNS, "when");
        whenElement.setAttribute("startTime", cal.toRFC3339(aItem.startDate));
        whenElement.setAttribute("endTime", cal.toRFC3339(aItem.endDate));
    }

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
            let gdReminder;
            if (aItem.recurrenceInfo) {
                // On recurring items, set the reminder directly in the <entry> tag.
                gdReminder = addElemNS(gdNS, "reminder");
            } else {
                // Otherwise, its a child of the gd:when element
                gdReminder = addElemNS(gdNS, "reminder", whenElement);
            }
            if (alarm.related == alarm.ALARM_RELATED_ABSOLUTE) {
                // Setting an absolute date can be done directly. Google will take
                // care of calculating the offset.
                gdReminder.setAttribute("absoluteTime", cal.toRFC3339(alarm.alarmDate));
            } else {
                let alarmOffset = alarm.offset;
                if (alarm.related == alarm.ALARM_RELATED_END) {
                    // Google always uses an alarm offset related to the start time
                    // for relative alarms.
                    alarmOffset = alarmOffset.clone();
                    alarmOffset.addDuration(duration);
                }

                gdReminder.setAttribute("minutes", -alarmOffset.inSeconds / 60);
                gdReminder.setAttribute("method", actionMap[alarm.action] || "alert");
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
    let itemSnoozeTime = aItem.getProperty("X-MOZ-SNOOZE-TIME");
    let icalSnoozeTime = null;
    if (itemSnoozeTime) {
        // The propery is saved as a string, translate back to calIDateTime.
        icalSnoozeTime = cal.createDateTime();
        icalSnoozeTime.icalString = itemSnoozeTime;
    }
    addExtendedProperty("X-MOZ-SNOOZE-TIME", cal.toRFC3339(icalSnoozeTime));

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
        snoozeValue = JSON.stringify(snoozeObj);
    }
    // Now save the snooze object in source format as an extended property. Do
    // so always, since its currently impossible to unset extended properties.
    addExtendedProperty("X-GOOGLE-SNOOZE-RECUR", snoozeValue);

    // gd:visibility
    let privacy = aItem.privacy || "default";
    addElemNS(gdNS, "visibility").setAttribute("value", kEVENT_SCHEMA + privacy.toLowerCase());

    // categories
    // Google does not support categories natively, but allows us to store data
    // as an "extendedProperty", so we do here
    addExtendedProperty("X-MOZ-CATEGORIES",
                        categoriesArrayToString(aItem.getCategories({})));

    // gd:recurrence
    if (aItem.recurrenceInfo) {
        try {
            const kNEWLINE = "\r\n";
            let icalString;
            let recurrenceItems = aItem.recurrenceInfo.getRecurrenceItems({});

            // Dates of the master event
            let startTZID = aItem.startDate.timezone.tzid;
            let endTZID = aItem.endDate.timezone.tzid;
            icalString = "DTSTART;TZID=" + startTZID
                         + ":" + aItem.startDate.icalString + kNEWLINE
                         + "DTEND;TZID=" + endTZID
                         + ":"  + aItem.endDate.icalString + kNEWLINE;

            // Add all recurrence items to the ical string
            for each (let ritem in recurrenceItems) {
                let prop = ritem.icalProperty;
                let wrappedRItem = cal.wrapInstance(wrappedRItem, Components.interfaces.calIRecurrenceDate);
                if (wrappedRItem) {
                    // EXDATES require special casing, since they might contain
                    // a TZID. To avoid the need for conversion of TZID strings,
                    // convert to UTC before serialization.
                    prop.valueAsDatetime = wrappedRItem.date.getInTimezone(cal.UTC());
                }
                icalString += prop.icalString;
            }

            // Put the ical string in a <gd:recurrence> tag
            addElemNS(gdNS, "recurrence").textContent = icalString + kNEWLINE;
        } catch (e) {
            cal.ERROR("[calGoogleCalendar] Error: " + e);
        }
    }

    // gd:originalEvent
    if (aItem.recurrenceId) {
        let originalEvent = addElemNS(gdNS, "originalEvent");
        originalEvent.setAttribute("id", aItem.parentItem.id);

        let origWhen = addElemNS(gdNS, "when", originalEvent)
        origWhen.setAttribute("startTime", cal.toRFC3339(aItem.recurrenceId.getInTimezone(cal.UTC())));
    }

    // While it may sometimes not work out, we can always try to set the uid and
    // sequence properties
    let sequence = aItem.getProperty("SEQUENCE");
    if (sequence) {
        addElemNS(gcalNS, "sequence").setAttribute("value", sequence);
    }
    addElemNS(gcalNS, "uid").setAttribute("value", aItem.id || "");

    // XXX Google currently has no priority support. See
    // http://code.google.com/p/google-gdata/issues/detail?id=52
    // for details.

    return document;
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
        compareNotNull("alarmLastAck") ||
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
    let edituri = aItem.getProperty("X-GOOGLE-EDITURL");
    if (!edituri) {
        // If the item has no edit uri, it is read-only
        throw new Components.Exception("The item is readonly", Components.interfaces.calIErrors.CAL_IS_READONLY);
    }
    return edituri;
}

function getIdFromEntry(aXMLEntry) {
    let id = gdataXPathFirst(aXMLEntry, 'gCal:uid/@value');
    return id.replace(/@google.com/,"");
}

function getRecurrenceIdFromEntry(aXMLEntry, aTimezone) {
    let rId = gdataXPathFirst(aXMLEntry, 'gd:originalEvent/gd:when/@startTime');
    return (rId ? cal.fromRFC3339(rId.toString(), aTimezone) : null);
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

    function getExtendedProperty(x) gdataXPathFirst(aXMLEntry, 'gd:extendedProperty[@name="' + x + '"]/@value');

    if (!aXMLEntry) {
        throw new Components.Exception("", Components.results.NS_ERROR_FAILURE);
    } else if (typeof aXMLEntry == "string") {
        aXMLEntry = cal.xml.parseString(aXMLEntry);
    }

    let item = (aReferenceItem ? aReferenceItem.clone() : cal.createEvent());

    try {
        // id
        item.id = getIdFromEntry(aXMLEntry);

        // sequence
        item.setProperty("SEQUENCE", gdataXPathFirst(aXMLEntry, 'gCal:sequence/@value') || 0);

        // link (edit url)
        // Since Google doesn't set the edit url to be https if the request is
        // https, we need to work around this here.
        let editUrl = gdataXPathFirst(aXMLEntry, 'atom:link[@rel="edit"]/@href');
        if (aCalendar.uri.schemeIs("https")) {
            editUrl = editUrl.replace(/^http:/, "https:");
        }
        item.setProperty("X-GOOGLE-EDITURL", editUrl);

        // link (alternative representation, html)
        let htmlUrl = gdataXPathFirst(aXMLEntry, 'atom:link[@rel="alternate"]/@href');
        if (aCalendar.uri.schemeIs("https")) {
            htmlUrl = htmlUrl.replace(/^http:/, "https:");
        }
        item.setProperty("URL", htmlUrl);

        // title
        item.title = gdataXPathFirst(aXMLEntry, 'atom:title[@type="text"]/text()');

        // content
        item.setProperty("DESCRIPTION", gdataXPathFirst(aXMLEntry, 'atom:content[@type="text"]/text()'));

        // gd:transparency
        item.setProperty("TRANSP", gdataXPathFirst(aXMLEntry, 'gd:transparency/@value').substring(39).toUpperCase());

        // gd:eventStatus
        item.status = gdataXPathFirst(aXMLEntry, 'gd:eventStatus/@value').substring(39).toUpperCase();

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
            let organizerEmail = gdataXPathFirst(aXMLEntry, 'gd:who[@rel="http://schemas.google.com/g/2005#event.organizer"]/@email');
            if (organizerEmail != aCalendar.googleCalendarName) {
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
                alarm.action = actionMap[reminderTag.getAttribute("method")] || "DISPLAY";

                let absoluteTime = reminderTag.getAttribute("absoluteTime");
                if (absoluteTime) {
                    alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_ABSOLUTE;
                    alarm.alarmDate = cal.fromRFC3339(absoluteTime, aTimezone);
                } else {
                    alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_START;
                    let alarmOffset = cal.createDuration();
                    let days = reminderTag.getAttribute("days");
                    let hours = reminderTag.getAttribute("hours");
                    let minutes = reminderTag.getAttribute("minutes");

                    if (days) {
                        alarmOffset.days = -days;
                    } else if (hours) {
                        alarmOffset.hours = -hours;
                    } else if (minutes) {
                        alarmOffset.minutes = -minutes;
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
        let recurrenceInfo = gdataXPathFirst(aXMLEntry, 'gd:recurrence/text()');
        if (!recurrenceInfo || recurrenceInfo.length == 0) {
            // If no recurrence information is given, then there will only be
            // one gd:when tag. Otherwise, we will be parsing the startDate from
            // the recurrence information.
            item.startDate = cal.fromRFC3339(gdataXPathFirst(aXMLEntry, 'gd:when/@startTime'), aTimezone);
            item.endDate = cal.fromRFC3339(gdataXPathFirst(aXMLEntry, 'gd:when/@endTime'), aTimezone);

            if (!item.endDate) {
                // We have a zero-duration event
                item.endDate = item.startDate.clone();
            }

            // gd:reminder
            parseReminders(gdataXPath(aXMLEntry, 'gd:when/gd:reminder'));
        } else {
            if (!item.recurrenceInfo) {
                item.recurrenceInfo = cal.createRecurrenceInfo(item);
            } else {
                item.recurrenceInfo.clearRecurrenceItems();
            }

            // We don't really care about google's timezone info for
            // now. This may change when bug 314339 is fixed. Split out
            // the timezone information so we only have the first bit
            let vevent = recurrenceInfo;
            let splitpos = recurrenceInfo.indexOf("BEGIN:VTIMEZONE");
            if (splitpos > -1) {
                // Sometimes (i.e if only DATE values are specified), no
                // timezone info is contained. Only remove it if it shows up.
                vevent = recurrenceInfo.substring(0, splitpos);
            }

            vevent = "BEGIN:VEVENT\n" + vevent + "END:VEVENT";
            let icsService = cal.getIcsService();

            let rootComp = icsService.parseICS(vevent, gdataTimezoneService);
            let i = 0;
            let hasRecurringRules = false;
            for (let prop in cal.ical.propertyIterator(rootComp)) {
               switch (prop.propertyName) {
                    case "EXDATE":
                        let recItem = Components.classes["@mozilla.org/calendar/recurrence-date;1"]
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
            parseReminders(gdataXPath(aXMLEntry, 'gd:reminder'));
        }

        // gd:recurrenceException
        let exceptions = gdataXPath(aXMLEntry, 'gd:recurrenceException[@specialized="true"]/gd:entryLink/atom:entry');
        for each (let exception in exceptions) {
            // We only want specialized exceptions, mainly becuase I haven't
            // quite found out if a non-specialized exception also corresponds
            // to a normal exception as libical knows it.
            let excItem = XMLEntryToItem(exception, aTimezone, aCalendar);

            // Google uses the status field to reflect negative exceptions.
            if (excItem.status == "CANCELED") {
                item.recurrenceInfo.removeOccurrenceAt(excItem.recurrenceId);
            } else {
                excItem.calendar = aCalendar.superCalendar;
                item.recurrenceInfo.modifyException(excItem, true);
            }
        }

        // gd:extendedProperty (alarmLastAck)
        item.alarmLastAck = cal.fromRFC3339(getExtendedProperty("X-MOZ-LASTACK"), aTimezone);

        // gd:extendedProperty (snooze time)
        let dtSnoozeTime = cal.fromRFC3339(getExtendedProperty("X-MOZ-SNOOZE-TIME"), aTimezone);
        let snoozeProperty = (dtSnoozeTime ? dtSnoozeTime.icalString : null);
        item.setProperty("X-MOZ-SNOOZE-TIME", snoozeProperty);

        // gd:extendedProperty (snooze recurring alarms)
        if (item.recurrenceInfo) {
            // Transform back the string into our snooze properties
            let snoozeObj;
            try {
                let snoozeString = getExtendedProperty("X-GOOGLE-SNOOZE-RECUR");
                snoozeObj = JSON.parse(snoozeString);
            } catch (e) {
                // Just swallow parsing errors, not so important.
            }

            if (snoozeObj) {
                for (let rid in snoozeObj) {
                    item.setProperty("X-MOZ-SNOOZE-TIME-" + rid,
                                     snoozeObj[rid]);
                }
            }
        }

        // gd:where
        item.setProperty("LOCATION", gdataXPathFirst(aXMLEntry, 'gd:where/@valueString'));

        // gd:who
        if (Preferences.get("calendar.google.enableAttendees", false)) {
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
            for each (let who in gdataXPath(aXMLEntry, 'gd:who')) {
                let attendee = cal.createAttendee();
                let rel = who.getAttribute("rel").substring(33);
                let type = gdataXPathFirst(who, 'gd:attendeeType/@value').substring(33);
                let status = gdataXPathFirst(who, 'gd:attendeeStatus/@value').substring(33);

                attendee.id = "mailto:" + who.getAttribute("email")
                attendee.commonName = who.getAttribute("valueString");
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
        item.privacy = gdataXPathFirst(aXMLEntry, "gd:visibility/@value").substring(39).toUpperCase();

        // category
        // Google does not support categories natively, but allows us to store
        // data as an "extendedProperty", and here it's going to be retrieved
        // again
        let categories = cal.categoriesStringToArray(getExtendedProperty("X-MOZ-CATEGORIES"));
        item.setCategories(categories.length, categories);

        // published
        let createdText = gdataXPathFirst(aXMLEntry, 'atom:published/text()');
        item.setProperty("CREATED", cal.fromRFC3339(createdText, aTimezone).getInTimezone(cal.UTC()));

        // updated (This must be set last!)
        let lastmodText = gdataXPathFirst(aXMLEntry, 'atom:updated/text()');
        item.setProperty("LAST-MODIFIED", cal.fromRFC3339(lastmodText, aTimezone).getInTimezone(cal.UTC()));

        // XXX Google currently has no priority support. See
        // http://code.google.com/p/google-gdata/issues/detail?id=52
        // for details.
    } catch (e) {
        cal.ERROR("Error parsing XML stream" + e);
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
    let expandedItems;
    if (aOperation.itemFilter &
        Components.interfaces.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES) {
        expandedItems = aItem.getOccurrencesBetween(aOperation.itemRangeStart,
                                                    aOperation.itemRangeEnd,
                                                    {});
        cal.LOG("[calGoogleCalendar] Expanded item " + aItem.title + " to " +
                expandedItems.length + " items");
    }
    return expandedItems || [aItem];
}

/**
 * Returns true if the exception passed is one that should cause the cache
 * layer to retry the operation. This is usually a network error or other
 * temporary error
 *
 * @param e     The exception to check
 */
function isCacheException(e) {
    // Stolen from nserror.h
    const NS_ERROR_MODULE_NETWORK = 6;
    function NS_ERROR_GET_MODULE(code) {
        return (((code >> 16) - 0x45) & 0x1fff);
    }

    if (NS_ERROR_GET_MODULE(e.result) == NS_ERROR_MODULE_NETWORK &&
        !Components.isSuccessCode(e.result)) {
        // This is a network error, which most likely means we should
        // retry it some time.
        return true;
    }

    // Other potential errors we want to retry with
    switch (e.result) {
        case Components.results.NS_ERROR_NOT_AVAILABLE:
            return true;
        default:
            return false;
    }
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
 * Helper function to create a timer in a context where window.setTimeout is not
 * available
 *
 * @param aFunc     The function to call when the timer fires
 * @param aTimeout  The timeout in milliseconds.
 * @param aThis     (optional) The |this| object to call the function with.
 */
function setTimeout(aFunc, aTimeout, aThis) {
    let timerCallback = {
        notify: function setTimeout_notify() {
            aFunc.call(aThis);
        }
    };
    let timer = Components.classes["@mozilla.org/timer;1"]
                          .createInstance(Components.interfaces.nsITimer);
    timer.initWithCallback(timerCallback, aTimeout, timer.TYPE_ONE_SHOT);
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

    cal.LOG("[calGoogleCalendar] Logging calIEvent:" +
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

    cal.LOG("[calGoogleCalendar] Interval from " +
            aInterval.interval.start + " to " + aInterval.interval.end +
            " is " + type);
}
