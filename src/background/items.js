/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import {
  categoriesStringToArray,
  categoriesArrayToString,
  reverseObject,
  addVCalendar,
  stripFractional,
} from "./utils.js";

import ICAL from "./libs/ical.js";
import TimezoneService from "./timezone.js";

const ATTENDEE_STATUS_MAP = {
  needsAction: "NEEDS-ACTION",
  declined: "DECLINED",
  tentative: "TENTATIVE",
  accepted: "ACCEPTED",
};
const ALARM_ACTION_MAP = {
  email: "EMAIL",
  popup: "DISPLAY",
};
const ATTENDEE_STATUS_MAP_REV = reverseObject(ATTENDEE_STATUS_MAP);
const ALARM_ACTION_MAP_REV = reverseObject(ALARM_ACTION_MAP);

const FOUR_WEEKS_IN_MINUTES = 40320;

const CONTAINS_HTML_RE = /^<|&(lt|gt|amp);|<(br|p)>/;


export function findRelevantInstance(vcalendar, instance, type) {
  for (let comp of vcalendar.getAllSubcomponents(type)) {
    let recId = comp.getFirstPropertyValue("recurrence-id");
    if (!instance && !recId) {
      return comp;
    } else if (instance && recId?.convertToZone(ICAL.Timezone.utcTimezone).toString() == instance) {
      return comp;
    }
  }
  return null;
}

export function transformDateXprop(value) {
  if (!value || value[4] == "-") {
    // No value, or already a jCal/rfc3339 time
    return value;
  } else if (value instanceof ICAL.Time) {
    // Core needs to allow x-props with params, then this will simply be parsed an ICAL.Time
    return value.toString();
  } else if (value.length == 16 && value.endsWith("Z")) {
    // An ICAL string value like 20240102T030405Z
    return ICAL.design.icalendar.value["date-time"].fromICAL(value);
  }

  return null;
}
export function transformDateXpropICAL(value) {
  if (!value || (value.length == 16 && value.endsWith("Z"))) {
    // No value, or an ICAL string value like 20240102T030405Z
    return value;
  } else if (value instanceof ICAL.Time) {
    // Convert to an ICAL String
    return value.toICALString();
  } else if (value[4] == "-") {
    // A jCal/rfc3339 time
    return ICAL.design.icalendar.value["date-time"].toICAL(value);
  }

  return null;
}

export function itemToJson(item, calendar, isImport, isCreate) {
  if (item.type == "event") {
    return eventToJson(item, calendar, isImport, isCreate);
  } else if (item.type == "task") {
    return taskToJson(item, calendar, isImport, isCreate);
  } else {
    throw new Error("Unknown item type: " + item.type);
  }
}

function eventToJson(item, calendar, isImport, isCreate) {
  let veventprops = [];
  let oldItem = {
    format: "jcal",
    item: ["vcalendar", [], [["vevent", veventprops, []]]],
  };

  if (item.instance) {
    // patchEvent needs to find the relevant instance, which means we need the recurrence-id on the
    // old item.
    veventprops.push(
      ["recurrence-id", {}, item.instance.length == 10 ? "date" : "date-time", item.instance]
    );
  }

  let entry = patchEvent(item, oldItem, isImport, isCreate);
  if (item.id) {
    entry.iCalUID = item.id;
  }
  return entry;
}

function taskToJson(item, calendar, isImport, isCreate) {
  let oldItem = {
    format: "jcal",
    item: ["vcalendar", [], [["vtodo", [], []]]],
  };

  let entry = patchTask(item, oldItem, isImport, isCreate);
  if (item.id) {
    entry.id = item.id;
  }

  return entry;
}

export function jsonToItem(data) {
  if (data.entry?.kind == "tasks#task") {
    return jsonToTask(data);
  } else if (data.entry?.kind == "calendar#event") {
    return jsonToEvent(data);
  } else {
    data.calendar.console.error(`Invalid item type ${data.entry?.kind}`);
    return null;
  }
}

function jsonToTask({ entry, calendar }) {
  function setIf(prop, type, value, params = {}) {
    if (value) {
      vtodoprops.push([prop, params, type, value]);
    }
  }

  let vtodoprops = [];
  let vtodocomps = [];
  let vtodo = ["vtodo", vtodoprops, vtodocomps];

  setIf("uid", "text", entry.id);
  setIf("last-modified", "date-time", stripFractional(entry.updated));
  setIf("dtstamp", "date-time", stripFractional(entry.updated));

  setIf("summary", "text", entry.title);
  setIf("description", "text", entry.notes);
  setIf("url", "uri", entry.webViewLink);

  setIf("related-to", "text", entry.parent, { reltype: "PARENT" });
  setIf("x-google-sortkey", "integer", entry.position);

  let status;
  if (entry.deleted) {
    status = "CANCELLED";
  } else if (entry.status == "needsAction") {
    status = "NEEDS-ACTION";
  } else {
    status = "COMPLETED";
  }
  vtodoprops.push(["status", {}, "text", status]);
  if (status == "COMPLETED") {
    vtodoprops.push(["percent-complete", {}, "integer", 100]);
  }
  setIf("completed", "date-time", stripFractional(entry.completed));
  setIf("due", "date-time", stripFractional(entry.due));

  for (let link of entry.links || []) {
    vtodoprops.push([
      "attach",
      { filename: link.description, "x-google-type": link.type },
      "uri",
      link.link,
    ]);
  }

  return {
    id: entry.id,
    type: "task",
    metadata: {
      etag: entry.etag,
      path: entry.id,
    },
    format: "jcal",
    item: addVCalendar(vtodo)
  };
}

function haveRemindersChanged(remindersEntry, oldRemindersEntry) {
  if (
    remindersEntry.useDefault != oldRemindersEntry.useDefault ||
    remindersEntry.overrides?.length != oldRemindersEntry.overrides?.length
  ) {
    return true;
  }

  let reminderMap = new Set(remindersEntry.overrides?.map(entry => entry.method + entry.minutes) ?? []);
  if (oldRemindersEntry.overrides?.some(entry => !reminderMap.has(entry.method + entry.minutes))) {
    return true;
  }

  return false;
}

function convertReminders(vevent) {
  // XXX While Google now supports multiple alarms and alarm values, we still need to fix bug 353492
  // first so we can better take care of finding out what alarm is used for snoozing.

  let reminders = { overrides: [], useDefault: false };
  for (let valarm of vevent.getAllSubcomponents("valarm")) {
    if (valarm.getFirstPropertyValue("x-default-alarm")) {
      // This is one of the Google default alarms on the calendar, it should therefore not be
      // serialized. We need to do this because Lightning does not have the concept of a default
      // alarm.
      reminders.useDefault = true;
      continue;
    }
    if (reminders.overrides.length == 5) {
      // Need to continue here, there may be x-default-alarms further on.
      continue;
    }

    let override = {};
    override.method = ALARM_ACTION_MAP_REV[valarm.getFirstPropertyValue("action")] || "popup";
    let trigger = valarm.getFirstProperty("trigger");
    let related = trigger.getParameter("related");
    if (trigger.type == "date-time") {
      override.minutes = Math.floor(
        vevent
          .getFirstPropertyValue("dtstart")
          .subtractDateTz(trigger.getFirstValue())
          .toSeconds() / 60
      );
    } else if (related == "END") {
      let dtend = vevent.getFirstPropertyValue("dtend");
      let length = dtend
        ? dtend.subtractDateTz(vevent.getFirstPropertyValue("dtstart")).toSeconds()
        : 0;
      override.minutes = -Math.floor((trigger.getFirstValue().toSeconds() + length) / 60);
    } else {
      override.minutes = -Math.floor(trigger.getFirstValue().toSeconds() / 60);
    }

    override.minutes = Math.min(Math.max(0, override.minutes), FOUR_WEEKS_IN_MINUTES);
    reminders.overrides.push(override);
  }

  if (!reminders.overrides.length && vevent.getFirstPropertyValue("x-default-alarm")) {
    delete reminders.overrides;
    reminders.useDefault = true;
  }

  return reminders;
}

function haveAttendeesChanged(event, oldEvent) {
  function attendeeChanged(oldAtt, newAtt) {
    return newAtt?.getParameter("cn") != oldAtt?.getParameter("cn") ||
      newAtt?.getParameter("role") != oldAtt?.getParameter("role") ||
      newAtt?.getParameter("cutype") != oldAtt?.getParameter("cutype") ||
      newAtt?.getParameter("partstat") != oldAtt?.getParameter("partstat");
  }

  let oldAttendees = new Map(
    oldEvent.getAllProperties("attendee").map(attendee => [attendee.getFirstValue(), attendee])
  );
  let newAttendees = event.getAllProperties("attendee");
  let needsAttendeeUpdate = newAttendees.length != oldAttendees.size;
  let newOrganizer = event.getFirstProperty("organizer");
  let newOrganizerId = newOrganizer?.getFirstParameter("partstat") ? newOrganizer?.getFirstValue() : null;
  let oldOrganizer = oldEvent.getFirstProperty("organizer");

  if (!needsAttendeeUpdate) {
    for (let attendee of newAttendees) {
      let attendeeId = attendee.getFirstValue();
      let oldAttendee = oldAttendees.get(attendeeId);
      if (!oldAttendee) {
        needsAttendeeUpdate = true;
        break;
      }

      if (attendeeId == newOrganizerId) {
        // Thunderbird sets the participation status on the organizer, not the attendee
        attendee = newOrganizer;
        oldAttendee = oldOrganizer;
      }

      if (attendeeChanged(attendee, oldAttendee)) {
        needsAttendeeUpdate = true;
        break;
      }
      oldAttendees.delete(attendeeId);
    }

    if (attendeeChanged(oldOrganizer, newOrganizer)) {
      // There are no new attendees, but the organizer changed participations status so we might
      // need to add it.
      needsAttendeeUpdate = true;
    }

    if (oldAttendees.size > 0) {
      needsAttendeeUpdate = true;
    }
  }

  return needsAttendeeUpdate;
}

function convertAttendee(attendee, organizer, isOrganizer, isCreate) {
  function setIf(att, prop, value) {
    if (value) {
      att[prop] = value;
    }
  }

  let att = {};
  let attendeeId = attendee.getFirstValue();
  let organizerId = organizer?.getFirstValue();

  if (!isCreate && attendeeId == organizerId) {
    // On creation, the participation status is set on the attendee object. On participation
    // changes, it is wrongly set on the organizer, not the attendee.
    attendee = organizer;
  }

  att.email = attendeeId.startsWith("mailto:") ? attendeeId.substr(7) : null;
  let emailParam = attendee.getFirstParameter("email");
  if (!att.email && emailParam) {
    att.email = emailParam.startsWith("mailto:") ? emailParam.substr(7) : emailParam;
  }

  setIf(att, "displayName", attendee.getFirstParameter("cn"));

  if (!isOrganizer) {
    att.optional = attendee.getFirstParameter("role") == "OPT-PARTICIPANT";
    att.resource = attendee.getFirstParameter("cutype") == "RESOURCE";
    att.responseStatus =
      ATTENDEE_STATUS_MAP_REV[attendee.getFirstParameter("partstat")] || "needsAction";

    setIf(att, "comment", attendee.getFirstParameter("comment"));
    setIf(att, "additionalGuests", attendee.getFirstParameter("x-num-guests"));
  }

  return att;
}

function convertRecurrence(vevent) {
  let recrules = new Set();

  for (let rrule of vevent.getAllProperties("rrule")) {
    recrules.add(rrule.toICALString());
  }

  // EXDATEs and RDATEs require special casing, since they might contain a TZID. To avoid the need
  // for conversion of TZID strings, convert to UTC before serialization.
  for (let rdate of vevent.getAllProperties("rdate")) {
    rdate.setValue(rdate.getFirstValue().convertToZone(ICAL.Timezone.utcTimezone));
    rdate.removeParameter("tzid");
    recrules.add(rdate.toICALString());
  }
  for (let exdate of vevent.getAllProperties("exdate")) {
    exdate.setValue(exdate.getFirstValue().convertToZone(ICAL.Timezone.utcTimezone));
    exdate.removeParameter("tzid");
    recrules.add(exdate.toICALString());
  }

  return recrules;
}

function convertRecurringSnoozeTime(vevent) {
  // This is an evil workaround since we don't have a really good system to save the snooze time
  // for recurring alarms or even retrieve them from the event. This should change when we have
  // multiple alarms support.
  let snoozeObj = {};

  let lastAckString = transformDateXprop(vevent.getFirstPropertyValue("x-moz-lastack"));
  let lastAck = lastAckString ? ICAL.Time.fromDateTimeString(lastAckString) : null;

  for (let property of vevent.getAllProperties()) {
    if (property.name.startsWith("x-moz-snooze-time-")) {
      let snoozeDateString = transformDateXprop(property.getFirstValue());
      let snoozeDate = snoozeDateString ? ICAL.Time.fromDateTimeString(snoozeDateString) : null;

      if (snoozeDate && (!lastAck || snoozeDate.compare(lastAck) >= 0)) {
        snoozeObj[property.name.substr(18)] = transformDateXpropICAL(property.getFirstValue());
      }
    }
  }
  return Object.keys(snoozeObj).length ? JSON.stringify(snoozeObj) : null;
}

export function patchItem(item, oldItem, isImport, isCreate) {
  if (item.type == "event") {
    return patchEvent(...arguments);
  } else if (item.type == "task") {
    return patchTask(...arguments);
  } else {
    throw new Error("Unknown item type: " + item.type);
  }
}

function patchTask(item, oldItem, isImport, isCreate) {
  function setIfFirstProperty(obj, prop, jprop, transform = null) {
    let oldValue = oldTask.getFirstPropertyValue(jprop);
    let newValue = task.getFirstPropertyValue(jprop);

    if (oldValue?.toString() !== newValue?.toString()) {
      obj[prop] = transform ? transform(newValue) : newValue;
    }
  }

  let entry = {};
  let task = findRelevantInstance(new ICAL.Component(item.item), item.instance, "vtodo");
  let oldTask = findRelevantInstance(new ICAL.Component(oldItem.item), item.instance, "vtodo");

  setIfFirstProperty(entry, "title", "summary");
  setIfFirstProperty(entry, "status", "status", val => {
    return val == "COMPLETED" ? "completed" : "needsAction";
  });
  setIfFirstProperty(entry, "notes", "description");

  setIfFirstProperty(entry, "due", "due", dueDate => dueDate.toString());
  setIfFirstProperty(entry, "completed", "completed", completedDate => completedDate.toString());

  return entry;
}

function patchEvent(item, oldItem, isImport, isCreate) {
  function setIfFirstProperty(obj, prop, jprop = null, transform = null) {
    let oldValue = oldEvent.getFirstPropertyValue(jprop || prop);
    let newValue = event.getFirstPropertyValue(jprop || prop);

    if (oldValue?.toString() !== newValue?.toString()) {
      obj[prop] = transform ? transform(newValue) : newValue;
    }
  }

  function getActualEnd(endEvent) {
    let endProp = endEvent.getFirstProperty("dtend");
    let end = endProp?.getFirstValue("dtend");
    let duration = endEvent.getFirstPropertyValue("duration");
    if (!end && duration) {
      let startProp = endEvent.getFirstProperty("dtstart");
      let start = startProp.getFirstValue();
      end = start.clone();
      end.addDuration(duration);

      return new ICAL.Property(["dtend", startProp.jCal[1], startProp.jCal[2], end.toString()]);
    }
    return endProp;
  }

  function setIfDateChanged(obj, prop, jprop) {
    let oldProp = oldEvent.getFirstProperty(jprop);
    let newProp = event.getFirstProperty(jprop);

    let oldDate = oldProp?.getFirstValue();
    let newDate = newProp?.getFirstValue();

    let oldZone = oldProp?.getFirstParameter("tzid");
    let newZone = newProp?.getFirstParameter("tzid");

    if (oldZone != newZone || !oldDate ^ !newDate || (oldDate && newDate && oldDate.compare(newDate) != 0)) {
      obj[prop] = dateToJson(newProp);
    }
  }

  function setIfEndDateChanged(obj, prop) {
    let oldProp = getActualEnd(oldEvent);
    let newProp = getActualEnd(event);

    let oldDate = oldProp?.getFirstValue();
    let newDate = newProp?.getFirstValue();

    let oldZone = oldProp?.getFirstParameter("tzid");
    let newZone = newProp?.getFirstParameter("tzid");

    if (oldZone != newZone || !oldDate ^ !newDate || (oldDate && newDate && oldDate.compare(newDate) != 0)) {
      obj[prop] = dateToJson(newProp);
    }
  }

  let entry = { extendedProperties: { shared: {}, private: {} } };

  let event = findRelevantInstance(new ICAL.Component(item.item), item.instance, "vevent");
  let oldEvent = findRelevantInstance(new ICAL.Component(oldItem.item), item.instance, "vevent");

  if (!event) {
    throw new Error(`Missing vevent in toplevel component ${item.item?.[0]}`);
  }

  setIfFirstProperty(entry, "summary");
  setIfFirstProperty(entry, "location");

  let oldDesc = oldEvent?.getFirstProperty("description");
  let newDesc = event?.getFirstProperty("description");
  let newHTML = newDesc?.getParameter("altrep");

  if (
    oldDesc?.getFirstValue() != newDesc?.getFirstValue() ||
    oldDesc?.getParameter("altrep") != newHTML
  ) {
    if (newHTML?.startsWith("data:text/html,")) {
      entry.description = decodeURIComponent(newHTML.slice("data:text/html,".length));
    } else {
      entry.description = newDesc?.getFirstValue();
    }
  }

  setIfDateChanged(entry, "start", "dtstart");
  setIfEndDateChanged(entry, "end");

  if (entry.end === null) {
    delete entry.end;
    entry.endTimeUnspecified = true;
  }

  if (event.getFirstProperty("rrule") || event.getFirstProperty("rdate")) {
    let oldRecurSnooze = convertRecurringSnoozeTime(oldEvent);
    let newRecurSnooze = convertRecurringSnoozeTime(event);
    if (oldRecurSnooze != newRecurSnooze) {
      entry.extendedProperties.private["X-GOOGLE-SNOOZE-RECUR"] = newRecurSnooze;
    }
  }

  if (item.instance) {
    entry.recurringEventId = item.id.replace(/@google.com$/, "");
    entry.originalStartTime = dateToJson(event.getFirstProperty("recurrence-id"));
  } else {
    let oldRecurrenceSet = convertRecurrence(oldEvent);
    let newRecurrence = [...convertRecurrence(event)];
    if (
      oldRecurrenceSet.size != newRecurrence.length ||
      newRecurrence.some(elem => !oldRecurrenceSet.has(elem))
    ) {
      entry.recurrence = newRecurrence;
    }
  }

  setIfFirstProperty(entry, "sequence");
  setIfFirstProperty(entry, "transparency", "transp", transparency => transparency?.toLowerCase());

  if (!isImport) {
    // We won't let an invitation item set PUBLIC visiblity
    setIfFirstProperty(entry, "visibility", "class", visibility => visibility?.toLowerCase());
  }

  setIfFirstProperty(entry, "status", "status", status => status?.toLowerCase());
  if (entry.status == "cancelled") {
    throw new Error("NS_ERROR_LOSS_OF_SIGNIFICANT_DATA");
  }
  if (entry.status == "none") {
    delete entry.status;
  }

  // Organizer
  let organizer = event.getFirstProperty("organizer");
  let organizerId = organizer?.getFirstValue();
  let oldOrganizer = oldEvent.getFirstProperty("organizer");
  let oldOrganizerId = oldOrganizer?.getFirstValue();
  if (!oldOrganizerId && organizerId) {
    // This can be an import, add the organizer
    entry.organizer = convertAttendee(organizer, organizer, true, isCreate);
  } else if (oldOrganizerId && oldOrganizerId.toLowerCase() != organizerId?.toLowerCase()) {
    // Google requires a move() operation to do this, which is not yet implemented
    throw new Error(`[calGoogleCalendar(${entry.summary})] Changing organizer requires a move, which is not implemented (changing from ${oldOrganizerId} to ${organizerId})`);
  }

  // Attendees
  if (haveAttendeesChanged(event, oldEvent)) {
    let attendees = event.getAllProperties("attendee");
    entry.attendees = attendees.map(attendee => convertAttendee(attendee, organizer, false, isCreate));

    // The participations status changed on the organizer, which means the organizer is now
    // participating in some way. We need to make sure the organizer is an attendee.
    if (
      organizer && oldOrganizer &&
      organizer.getParameter("partstat") != oldOrganizer.getParameter("partstat") &&
      !attendees.some(attendee => attendee.getFirstValue() == organizerId)
    ) {
        entry.attendees.push(convertAttendee(organizer, organizer, false, isCreate));
    }
  }

  let oldReminders = convertReminders(oldEvent);
  let reminders = convertReminders(event);
  if (haveRemindersChanged(reminders, oldReminders)) {
    entry.reminders = reminders;
  }

  // Categories
  function getAllCategories(vevent) {
    return vevent.getAllProperties("categories").reduce((acc, comp) => acc.concat(comp.getValues()), []);
  }

  let oldCatSet = new Set(getAllCategories(oldEvent));
  let newCatArray = getAllCategories(event);
  let newCatSet = new Set(newCatArray);

  if (
    oldCatSet.size != newCatSet.size ||
    oldCatSet.difference(newCatSet).size != 0
  ) {
    entry.extendedProperties.shared["X-MOZ-CATEGORIES"] = categoriesArrayToString(newCatArray);
  }

  // Conference info - we only support create and delete
  let confnew = event.getFirstPropertyValue("x-google-confnew");
  let confdata = event.getFirstPropertyValue("x-google-confdata");
  let oldConfData = oldEvent.getFirstPropertyValue("x-google-confdata");

  if (oldConfData && !confdata) {
    entry.conferenceData = null;
  } else if (confnew) {
    entry.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: {
          type: confnew
        }
      }
    };
  }

  // Last ack and snooze time are always in UTC, when serialized they'll contain a Z
  setIfFirstProperty(
    entry.extendedProperties.private,
    "X-MOZ-LASTACK",
    "x-moz-lastack",
    transformDateXprop
  );
  setIfFirstProperty(
    entry.extendedProperties.private,
    "X-MOZ-SNOOZE-TIME",
    "x-moz-snooze-time",
    transformDateXprop
  );

  if (!Object.keys(entry.extendedProperties.shared).length) {
    delete entry.extendedProperties.shared;
  }
  if (!Object.keys(entry.extendedProperties.private).length) {
    delete entry.extendedProperties.private;
  }
  if (!Object.keys(entry.extendedProperties).length) {
    delete entry.extendedProperties;
  }

  setIfFirstProperty(entry, "colorId", "x-google-color-id");

  return entry;
}

export function jsonToDate(propName, dateObj, defaultTimezone, requestedZone = null) {
  if (!dateObj) {
    return null;
  }

  let params = {};
  let targetZone = requestedZone || dateObj.timeZone;

  if (targetZone && targetZone != "UTC") {
    params.tzid = dateObj.timeZone;
  }

  if (dateObj.date) {
    return [propName, params, "date", dateObj.date];
  } else {
    let timeString = stripFractional(dateObj.dateTime);
    if (defaultTimezone && targetZone && targetZone != defaultTimezone.tzid) {
      let time = ICAL.Time.fromDateTimeString(timeString);
      time.zone = defaultTimezone;

      let zone = TimezoneService.get(targetZone);
      if (zone) {
        timeString = time.convertToZone(zone).toString();
      } else {
        throw new Error(`Could not find zone ${targetZone}`);
      }
    }

    return [propName, params, "date-time", timeString];
  }
}

export function dateToJson(property) {
  if (!property) {
    return null;
  }
  let dateobj = {};

  if (property.type == "date") {
    dateobj.date = property.getFirstValue().toString();
  } else {
    let dateTime = property.getFirstValue();
    dateobj.dateTime = dateTime.toString();

    let zone = TimezoneService.get(property.getFirstParameter("tzid"));
    if (zone) {
      dateobj.timeZone = zone.tzid;
    } else {
      let utcTime = dateTime.convertToZone(TimezoneService.get("UTC"));
      dateobj.dateTime = utcTime.toString();
    }
  }

  return dateobj;
}

async function jsonToEvent({ entry, calendar, defaultReminders, defaultTimezone, accessRole, confSolutionCache }) {
  function setIf(prop, type, value, params = {}) {
    if (value) {
      veventprops.push([prop, params, type, value]);
    }
  }
  function pushPropIf(prop) {
    if (prop) {
      veventprops.push(prop);
    }
  }

  let privateProps = entry.extendedProperties?.private || {};
  let sharedProps = entry.extendedProperties?.shared || {};

  let veventprops = [];
  let veventcomps = [];
  let vevent = ["vevent", veventprops, veventcomps];

  let uid = entry.iCalUID || (entry.recurringEventId || entry.id) + "@google.com";

  setIf("uid", "text", uid);
  setIf("created", "date-time", stripFractional(entry.created));
  setIf("last-modified", "date-time", stripFractional(entry.updated));
  setIf("dtstamp", "date-time", stripFractional(entry.updated));

  // Not pretty, but Google doesn't have a straightforward way to differentiate. As of writing,
  // they even have bugs in their own UI about displaying the string properly.
  if (entry.description?.match(CONTAINS_HTML_RE)) {
    let altrep = "data:text/html," + encodeURIComponent(entry.description);
    let parser = new window.DOMParser();
    let plain = parser.parseFromString(entry.description, "text/html").documentElement.textContent;
    veventprops.push(["description", { altrep }, "text", plain]);
  } else {
    veventprops.push(["description", {}, "text", entry.description ?? ""]);
  }

  setIf("location", "text", entry.location);
  setIf("status", "text", entry.status?.toUpperCase());

  if (entry.originalStartTime) {
    veventprops.push(jsonToDate("recurrence-id", entry.originalStartTime, defaultTimezone));
  }

  let isFreeBusy = accessRole == "freeBusyReader";
  let summary = isFreeBusy ? messenger.i18n.getMessage("busyTitle", calendar.name) : entry.summary;
  setIf("summary", "text", summary);
  setIf("class", "text", entry.visibility?.toUpperCase());
  setIf("sequence", "integer", entry.sequence);
  setIf("url", "uri", entry.htmlLink);
  setIf("transp", "text", entry.transparency?.toUpperCase());

  if (entry.eventType != "default") {
    setIf("x-google-event-type", "text", entry.eventType);
  }

  setIf("x-google-color-id", "text", entry.colorId);
  setIf("x-google-confdata", "text", entry.conferenceData ? JSON.stringify(entry.conferenceData) : null);

  if (entry.conferenceData && confSolutionCache) {
    let solution = entry.conferenceData.conferenceSolution;
    confSolutionCache[solution.key.type] = solution;
  }

  pushPropIf(jsonToDate("dtstart", entry.start, defaultTimezone));
  if (!entry.endTimeUnspecified) {
    veventprops.push(jsonToDate("dtend", entry.end, defaultTimezone));
  }

  // Organizer
  if (entry.organizer) {
    let id = entry.organizer.email
      ? "mailto:" + entry.organizer.email
      : "urn:id:" + entry.organizer.id;

    let orgparams = {};
    if (entry.organizer.displayName) {
      // eslint-disable-next-line id-length
      orgparams.cn = entry.organizer.displayName;
    }
    veventprops.push(["organizer", orgparams, "uri", id]);
  }

  // Recurrence properties
  for (let recItem of entry.recurrence || []) {
    let prop = ICAL.Property.fromString(recItem);
    veventprops.push(prop.jCal);
  }

  for (let attendee of entry.attendees || []) {
    let id = "mailto:" + attendee.email;
    let params = {
      role: attendee.optional ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT",
      partstat: ATTENDEE_STATUS_MAP[attendee.responseStatus],
      cutype: attendee.resource ? "RESOURCE" : "INDIVIDUAL",
    };

    if (attendee.displayName) {
      // eslint-disable-next-line id-length
      params.cn = attendee.displayName;
    }

    veventprops.push(["attendee", params, "uri", id]);
  }

  // Reminders
  if (entry.reminders) {
    if (entry.reminders.useDefault) {
      veventcomps.push(...defaultReminders.map(alarmEntry => jsonToAlarm(alarmEntry, true)));

      if (!defaultReminders?.length) {
        // There are no default reminders, but we want to use the default in case the user changes
        // it in the future. Until we have VALARM extension which allow for a default settings, we
        // use an x-prop
        veventprops.push(["x-default-alarm", {}, "boolean", true]);
      }
    }

    if (entry.reminders.overrides) {
      for (let reminderEntry of entry.reminders.overrides) {
        veventcomps.push(jsonToAlarm(reminderEntry));
      }
    }
  }

  // We can set these directly as they are UTC RFC3339 timestamps, which works with jCal date-times
  setIf("x-moz-lastack", "date-time", transformDateXprop(stripFractional(privateProps["X-MOZ-LASTACK"])));
  setIf("x-moz-snooze-time", "date-time", transformDateXprop(stripFractional(privateProps["X-MOZ-SNOOZE-TIME"])));

  let snoozeObj;
  try {
    snoozeObj = JSON.parse(privateProps["X-GOOGLE-SNOOZE-RECUR"]);
  } catch (e) {
    // Ok to swallow
  }

  for (let [rid, value] of Object.entries(snoozeObj || {})) {
    setIf(
      "x-moz-snooze-time-" + rid,
      "date-time",
      ICAL.design.icalendar.value["date-time"].fromICAL(value)
    );
  }

  // Google does not support categories natively, but allows us to store data as an
  // "extendedProperty", and here it's going to be retrieved again
  let categories = categoriesStringToArray(sharedProps["X-MOZ-CATEGORIES"]);
  if (categories && categories.length) {
    veventprops.push(["categories", {}, "text", ...categories]);
  }

  // Attachments (read-only)
  for (let attach of (entry.attachments || [])) {
    let props = { "managed-id": attach.fileId, filename: attach.title };
    if (attach.mimeType) {
      props.fmttype = attach.mimeType;
    }

    veventprops.push(["attach", props, "uri", attach.fileUrl]);
  }

  let shell = {
    id: uid,
    type: "event",
    metadata: {
      etag: entry.etag,
      path: entry.id,
    },
    format: "jcal",
    item: addVCalendar(vevent)
  };

  return shell;
}

export function jsonToAlarm(entry, isDefault = false) {
  let valarmprops = [];
  let valarm = ["valarm", valarmprops, []];

  let dur = new ICAL.Duration({
    minutes: -entry.minutes,
  });
  dur.normalize();

  valarmprops.push(["action", {}, "text", ALARM_ACTION_MAP[entry.method]]);
  valarmprops.push(["description", {}, "text", "alarm"]);
  valarmprops.push(["trigger", {}, "duration", dur.toString()]);

  if (isDefault) {
    valarmprops.push(["x-default-alarm", {}, "boolean", true]);
  }
  return valarm;
}

export class ItemSaver {
  #confSolutionCache = {};

  missingParents = [];
  parentItems = Object.create(null);

  constructor(calendar) {
    this.calendar = calendar;
    this.console = calendar.console;
  }

  async parseItemStream(data) {
    if (data.kind == "calendar#events") {
      return this.parseEventStream(data);
    } else if (data.kind == "tasks#tasks") {
      return this.parseTaskStream(data);
    } else {
      throw new Error("Invalid stream type: " + (data?.kind || data?.status));
    }
  }

  async parseEventStream(data) {
    if (data.timeZone) {
      this.console.log("Timezone from event stream is " + data.timeZone);
      this.calendar.setCalendarPref("timeZone", data.timeZone);
    }

    if (data.items?.length) {
      this.console.log(`Parsing ${data.items.length} received events`);
    } else {
      this.console.log("No events have been changed");
      return;
    }

    let exceptionItems = [];

    let defaultTimezone = TimezoneService.get(data.timeZone);

    // In the first pass, we go through the data and sort into parent items and exception items, as
    // the parent item might be after the exception in the stream.
    await Promise.all(
      data.items.map(async entry => {
        let item = await jsonToEvent({
          entry,
          calendar: this.calendar,
          defaultReminders: data.defaultReminders || [],
          defaultTimezone,
          confSolutionCache: this.#confSolutionCache
        });
        item.item = addVCalendar(item.item);

        if (entry.originalStartTime) {
          exceptionItems.push(item);
        } else {
          this.parentItems[item.id] = item;
        }
      })
    );

    for (let exc of exceptionItems) {
      let item = this.parentItems[exc.id];

      if (item) {
        this.processException(exc, item);
      } else {
        this.missingParents.push(exc);
      }
    }
  }

  async parseTaskStream(data) {
    if (data.items?.length) {
      this.console.log(`Parsing ${data.items.length} received tasks`);
    } else {
      this.console.log("No tasks have been changed");
      return;
    }

    await Promise.all(
      data.items.map(async entry => {
        let item = await jsonToTask({ entry, calendar: this.calendar });
        item.item = addVCalendar(item.item);
        await this.commitItem(item);
      })
    );
  }

  processException(exc, item) {
    let itemCalendar = new ICAL.Component(item.item);
    let itemEvent = itemCalendar.getFirstSubcomponent("vevent");

    let exceptionCalendar = new ICAL.Component(exc.item);
    let exceptionEvent = exceptionCalendar.getFirstSubcomponent("vevent");

    if (itemEvent.getFirstPropertyValue("status") == "CANCELLED") {
      // Cancelled parent items don't have the full amount of information, specifically no
      // recurrence info. Since they are cancelled anyway, we can just ignore processing this
      // exception.
      return;
    }

    if (exceptionEvent.getFirstPropertyValue("status") == "CANCELLED") {
      let recId = exceptionEvent.getFirstProperty("recurrence-id");
      let exdate = itemEvent.addPropertyWithValue("exdate", recId.getFirstValue().clone());
      let recIdZone = recId.getParameter("tzid");
      if (recIdZone) {
        exdate.setParameter("tzid", recIdZone);
      }
    } else {
      itemCalendar.addSubcomponent(exceptionEvent);
    }

    this.parentItems[item.id] = item;
  }

  async commitItem(item) {
    // This is a normal item. If it was canceled, then it should be deleted, otherwise it should be
    // either added or modified. The relaxed mode of the cache calendar takes care of the latter two
    // cases.
    let vcalendar = new ICAL.Component(item.item);
    let vcomp = vcalendar.getFirstSubcomponent("vevent") || vcalendar.getFirstSubcomponent("vtodo");

    if (vcomp.getFirstPropertyValue("status") == "CANCELLED") {
      // Catch the error here if the event is already removed from the calendar
      await messenger.calendar.items.remove(this.calendar.cacheId, item.id).catch(e => {});
    } else {
      await messenger.calendar.items.create(this.calendar.cacheId, item);
    }
  }

  /**
   * Handle all remaining exceptions in the item saver. Ensures that any missing parent items are
   * searched for or created.
   */
  async complete() {
    await Promise.all(
      this.missingParents.map(async exc => {
        let excCalendar = new ICAL.Component(exc.item);
        let excEvent = excCalendar.getFirstSubcomponent("vevent");

        let item;
        if (exc.id in this.parentItems) {
          // Parent item could have been on a later page, check again
          item = this.parentItems[exc.id];
        } else {
          // Otherwise check if we happen to have it in the database
          item = await messenger.calendar.items.get(this.calendar.cacheId, exc.id, {
            returnFormat: "jcal",
          });
          if (item) {
            this.parentItems[exc.id] = item;
          }
        }

        if (item) {
          delete item.calendarId;
          this.processException(exc, item);
        } else if (excEvent.getFirstPropertyValue("status") != "CANCELLED") {
          // If the item could not be found, it could be that the user is invited to an instance of
          // a recurring event. Unless this is a cancelled exception, create a mock parent item with
          // one positive RDATE.

          // Copy dtstart and rdate, same timezone
          let recId = excEvent.getFirstProperty("recurrence-id");
          let dtStart = excEvent.updatePropertyWithValue("dtstart", recId.getFirstValue().clone());
          let rDate = excEvent.updatePropertyWithValue("rdate", recId.getFirstValue().clone());
          let recTzid = recId.getParameter("tzid");
          if (recTzid) {
            dtStart.setParameter("tzid", recTzid);
            rDate.setParameter("tzid", recTzid);
          }

          excEvent.removeAllProperties("recurrence-id");
          excEvent.updatePropertyWithValue("x-moz-faked-master", "1");

          // Promote the item to a parent item we'll commit later
          this.parentItems[exc.id] = exc;
        }
      })
    );
    this.missingParents = [];

    // Commit all parents, they have collected all the exceptions by now
    await Promise.all(
      Object.values(this.parentItems).map(parent => {
        return this.commitItem(parent);
      })
    );
    this.parentItems = Object.create(null);

    // Save the conference icon cache
    let conferenceSolutions = await this.calendar.getCalendarPref("conferenceSolutions") ?? {};

    await Promise.all(Object.entries(this.#confSolutionCache).map(async ([key, solution]) => {
      let savedSolution = conferenceSolutions[key];

      if (savedSolution && savedSolution.iconUri == solution.iconUri) {
        // The icon uri has not changed, take the icon from our cache
        solution.iconCache = savedSolution.iconCache;
      }

      if (!solution.iconCache) {
        try {
          solution.iconCache = Array.from(await fetch(solution.iconUri).then(resp => resp.bytes()));
        } catch (e) {
          // Ok to fail
        }
      }
    }));

    Object.assign(conferenceSolutions, this.#confSolutionCache);
    await this.calendar.setCalendarPref("conferenceSolutions", conferenceSolutions);
  }
}
