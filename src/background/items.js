/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import {
  categoriesStringToArray,
  arrayToCategoriesString,
  reverseObject,
  addVCalendar,
} from "./utils.js";
import ICAL from "./libs/ical.js";

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

export function itemToJson(item, calendar, isImport) {
  if (item.type == "event") {
    return eventToJson(item, calendar, isImport);
  } else if (item.type == "task") {
    return taskToJson(item, calendar, isImport);
  } else {
    throw new Error("Unknown item type: " + item.type);
  }
}

function eventToJson(item, calendar, isImport) {
  let oldItem = {
    formats: {
      jcal: ["vcalendar", [], [["vevent", [], []]]],
    },
  };

  let entry = patchEvent(item, oldItem);
  if (item.id) {
    entry.icalUID = item.id;
  }
  return entry;
}

function taskToJson(item, calendar, isImport) {
  let oldItem = {
    formats: {
      jcal: ["vcalendar", [], [["vtodo", [], []]]],
    },
  };

  let entry = patchTask(item, oldItem);
  if (item.id) {
    entry.id = item.id;
  }

  return entry;
}

export function jsonToItem(entry, calendar, defaultReminders, referenceItem) {
  if (entry.kind == "tasks#task") {
    return jsonToTask(...arguments);
  } else if (entry.kind == "calendar#event") {
    return jsonToEvent(...arguments);
  } else {
    calendar.console.error(`Invalid item type ${entry?.kind}`);
    return null;
  }
}

function jsonToTask(entry, calendar, referenceItem) {
  function setIf(prop, type, value, params = {}) {
    if (value) {
      vtodoprops.push([prop, params, type, value]);
    }
  }

  let vtodoprops = [];
  let vtodocomps = [];
  let vtodo = ["vtodo", vtodoprops, vtodocomps];

  setIf("uid", "text", entry.id);
  setIf("last-modified", "date-time", entry.updated);
  setIf("dtstamp", "date-time", entry.updated);

  setIf("summary", "text", entry.title);
  setIf("description", "text", entry.notes);
  setIf("url", "text", entry.selfLink);

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
  setIf("completed", "date-time", entry.completed);
  setIf("due", "date-time", entry.due);

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
    title: entry.title,
    type: "task",
    description: entry.notes,
    metadata: {
      etag: entry.etag,
      path: entry.id,
    },
    formats: { use: "jcal", jcal: vtodo },
  };
}

function haveRemindersChanged(remindersEntry, oldRemindersEntry) {
  if (
    remindersEntry.useDefault != oldRemindersEntry.useDefault ||
    remindersEntry.overrides.length != oldRemindersEntry.overrides.length
  ) {
    return true;
  }

  let reminderMap = new Set(remindersEntry.overrides.map(entry => entry.method + entry.minutes));
  if (oldRemindersEntry.overrides.some(entry => !reminderMap.has(entry.method + entry.minutes))) {
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
  let oldAttendees = new Map(
    oldEvent.getAllProperties("attendee").map(attendee => [attendee.getFirstValue(), attendee])
  );
  let newAttendees = event.getAllProperties("attendee");
  let needsAttendeeUpdate = newAttendees.length != oldAttendees.size;

  if (!needsAttendeeUpdate) {
    for (let attendee of newAttendees) {
      let attendeeId = attendee.getFirstValue();
      let oldAttendee = oldAttendees.get(attendeeId);
      if (!oldAttendee) {
        needsAttendeeUpdate = true;
        break;
      }

      if (
        attendee.getParameter("cn") != oldAttendee.getParameter("cn") ||
        attendee.getParameter("role") != oldAttendee.getParameter("role") ||
        attendee.getParameter("cutype") != oldAttendee.getParameter("cutype") ||
        attendee.getParameter("partstat") != oldAttendee.getParameter("partstat")
      ) {
        needsAttendeeUpdate = true;
        break;
      }
      oldAttendees.delete(attendeeId);
    }
    if (oldAttendees.size > 0) {
      needsAttendeeUpdate = true;
    }
  }

  return needsAttendeeUpdate;
}

function convertAttendees(vevent) {
  function setIf(att, prop, value) {
    if (value) {
      att[prop] = value;
    }
  }

  let attendees = [];

  for (let attendee of vevent.getAllProperties("attendee")) {
    let att = {};
    let name = attendee.getFirstParameter("cn");
    if (name) {
      att.displayName = name;
    }

    let value = attendee.getFirstValue();
    att.email = value.startsWith("mailto:") ? value.substr(7) : attendee.getFirstParameter("email");

    att.optional = attendee.getFirstParameter("role") == "OPT-PARTICIPANT";
    att.resource = attendee.getFirstParameter("cutype") == "RESOURCE";
    att.responseStatus =
      ATTENDEE_STATUS_MAP_REV[attendee.getFirstParameter("partstat")] || "needsAction";

    setIf(att, "comment", attendee.getFirstParameter("comment"));
    setIf(att, "additionalGuests", attendee.getFirstParameter("x-num-guests"));
    setIf(att, "displayName", attendee.getFirstParameter("cn"));

    attendees.push(att);
  }
  return attendees;
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
  for (let property of vevent.getAllProperties()) {
    if (property.name.startsWith("x-moz-snooze-time-")) {
      snoozeObj[property.name.substr(18)] = property.getFirstValue()?.toICALString();
    }
  }
  return Object.keys(snoozeObj).length ? JSON.stringify(snoozeObj) : null;
}

export function patchItem(item, oldItem) {
  if (item.type == "event") {
    return patchEvent(...arguments);
  } else if (item.type == "task") {
    return patchTask(...arguments);
  } else {
    throw new Error("Unknown item type: " + item.type);
  }
}

function patchTask(item, oldItem) {
  function setIfFirstProperty(obj, prop, jprop, transform = null) {
    let oldValue = oldTask.getFirstPropertyValue(jprop);
    let newValue = task.getFirstPropertyValue(jprop);

    if (oldValue?.toString() !== newValue?.toString()) {
      obj[prop] = transform ? transform(newValue) : newValue;
    }
  }

  let entry = {};
  let task = new ICAL.Component(item.formats.jcal).getFirstSubcomponent("vtodo");
  let oldTask = new ICAL.Component(oldItem.formats.jcal).getFirstSubcomponent("vtodo");

  setIfFirstProperty(entry, "title", "summary");
  setIfFirstProperty(entry, "status", "status", val => {
    return val == "completed" ? "completed" : "needsAction";
  });
  setIfFirstProperty(entry, "notes", "description");

  setIfFirstProperty(entry, "due", "due", dueDate => dueDate.toString());
  setIfFirstProperty(entry, "completed", "completed", completedDate => completedDate.toString());

  return entry;
}

function patchEvent(item, oldItem) {
  function setIfFirstProperty(obj, prop, jprop = null, transform = null) {
    let oldValue = oldEvent.getFirstPropertyValue(jprop || prop);
    let newValue = event.getFirstPropertyValue(jprop || prop);

    if (oldValue?.toString() !== newValue?.toString()) {
      obj[prop] = transform ? transform(newValue) : newValue;
    }
  }

  function setIfDateChanged(obj, prop, jprop) {
    let oldProp = oldEvent.getFirstProperty(jprop);
    let newProp = event.getFirstProperty(jprop);

    let oldDate = oldProp?.getFirstValue();
    let newDate = newProp?.getFirstValue();

    if (!oldDate ^ !newDate || (oldDate && newDate && oldDate.compare(newDate) != 0)) {
      obj[prop] = dateToJson(newProp);
    }
  }

  let entry = { extendedProperties: { shared: {}, private: {} } };

  let event = new ICAL.Component(item.formats.jcal).getFirstSubcomponent("vevent");
  let oldEvent = new ICAL.Component(oldItem.formats.jcal).getFirstSubcomponent("vevent");

  if (!event) {
    throw new Error(`Missing vevent in toplevel component ${item.formats.jcal?.[0]}`);
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
      entry.description = newDesc.getFirstValue();
    }
  }

  setIfDateChanged(entry, "start", "dtstart");
  setIfDateChanged(entry, "end", "dtend"); // TODO duration instead of end
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

  let oldRecurrenceSet = convertRecurrence(oldEvent);
  let newRecurrence = [...convertRecurrence(event)];
  if (
    oldRecurrenceSet.size != newRecurrence.length ||
    newRecurrence.some(elem => !oldRecurrenceSet.has(elem))
  ) {
    entry.recurrence = newRecurrence;
  }

  setIfDateChanged(entry, "originalStartTime", "recurrence-id");
  // TODO
  //  setIf(entry, "recurringEventId", item.id.replace("@google.com", "")); // TODO parentMeta?.path || item.id.replace("@google.com", "");

  setIfFirstProperty(entry, "sequence");
  setIfFirstProperty(entry, "transparency", "transp", transparency => transparency?.toLowerCase());
  setIfFirstProperty(entry, "visibility", "class", visibility => visibility?.toLowerCase());

  setIfFirstProperty(entry, "status", "status", status => status?.toLowerCase());
  if (entry.status == "cancelled") {
    throw new Error("NS_ERROR_LOSS_OF_SIGNIFICANT_DATA");
  }
  if (entry.status == "none") {
    delete entry.status;
  }

  // Attendees
  // TODO if (Services.prefs.getBoolPref("calendar.google.enableAttendees", false)) {
  if (haveAttendeesChanged(event, oldEvent)) {
    entry.attendees = convertAttendees(event);
  }
  // }

  let oldReminders = convertReminders(oldEvent);
  let reminders = convertReminders(event);
  if (haveRemindersChanged(reminders, oldReminders)) {
    entry.reminders = reminders;
  }

  // Categories
  let oldCatSet = new Set(oldItem.categories || []);
  if (
    oldCatSet.size != (item.categories?.length ?? 0) ||
    item.categories?.some(itm => !oldCatSet.has(itm))
  ) {
    entry.extendedProperties.shared["X-MOZ-CATEGORIES"] = arrayToCategoriesString(item.categories);
  }

  setIfFirstProperty(
    entry.extendedProperties.private,
    "X-MOZ-LASTACK",
    "x-moz-lastack",
    ack => ack?.toICALString() // TODO this should be toRFC3339
  );
  setIfFirstProperty(
    entry.extendedProperties.private,
    "X-MOZ-SNOOZE-TIME",
    "x-moz-snooze-time",
    snooze => snooze?.toICALString() // TODO this should be toRFC3339
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

  return entry;
}

function jsonToDate(propName, dateobj) {
  let params = {};

  if (dateobj.timeZone) {
    params.tzid = dateobj.timeZone;
  }

  if (dateobj.date) {
    return [propName, params, "date", dateobj.date];
  } else {
    return [propName, params, "date-time", dateobj.dateTime.substr(0, dateobj.timeZone ? 19 : 20)];
  }
}

function dateToJson(property) {
  if (!property) {
    return null;
  }
  let dateobj = {};

  if (property.type == "date") {
    dateobj.date = property.getFirstValue().toString();
  } else {
    dateobj.dateTime = property.getFirstValue().toString();
    dateobj.timeZone = property.getFirstParameter("tzid");
  }

  return dateobj;
}

async function jsonToEvent(entry, calendar, defaultReminders, referenceItem) {
  function setIf(prop, type, value, params = {}) {
    if (value) {
      veventprops.push([prop, params, type, value]);
    }
  }

  let privateProps = entry.extendedProperties?.private || {};
  let sharedProps = entry.extendedProperties?.shared || {};

  let prefs = await messenger.storage.local.get({ "settings.accessRole": null });

  let veventprops = [];
  let veventcomps = [];
  let vevent = ["vevent", veventprops, veventcomps];

  let uid = entry.iCalUID || (entry.recurringEventId || entry.id) + "@google.com";

  // TODO json to date: start/end/recurrence-id - these use settings.timeZone as their default zone

  setIf("uid", "text", uid);
  setIf("created", "date-time", entry.created);
  setIf("last-modified", "date-time", entry.updated);
  setIf("dtstamp", "date-time", entry.updated);

  if (entry.description?.[0] == "<" || entry.description?.match(/&(lt|gt|amp);/)) {
    let altrep = "data:text/html," + encodeURIComponent(entry.description);
    let parser = new window.DOMParser();
    let plain = parser.parseFromString(entry.description, "text/html").documentElement.textContent;
    veventprops.push(["description", { altrep }, "text", plain]);
  } else {
    veventprops.push(["description", {}, "text", entry.description]);
  }

  setIf("location", "text", entry.location);
  setIf("status", "text", entry.status?.toUpperCase());

  if (entry.originalStartTime) {
    veventprops.push(jsonToDate("recurrence-id", entry.originalStartTime));
  }

  // TODO do something about originalStartTime
  // TODO entry.colorId
  let isFreeBusy = prefs["settings.accessRole"] == "freeBusyReader";
  let summary = isFreeBusy ? messenger.i18n.getMessage("busyTitle", calendar.name) : entry.summary;
  setIf("summary", "text", summary);
  setIf("class", "text", entry.visibility?.toUpperCase());
  setIf("sequence", "integer", entry.sequence);
  setIf("url", "text", entry.htmlLink);
  setIf("transp", "text", entry.transparency?.toUpperCase());

  /* Let's only support this when we can really do it in UI
  for (let entryPoint of (entry.conferenceData?.entryPoints || [])) {
    // TODO ignoring name, label, etc.
    setIf("attach", "text", entryPoint.uri);
  }
  */

  veventprops.push(jsonToDate("dtstart", entry.start));
  if (!entry.endTimeUnspecified) {
    veventprops.push(jsonToDate("dtend", entry.end));
  }

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

  if (entry.reminders) {
    if (entry.reminders.useDefault && defaultReminders?.length) {
      veventprops.push(["x-default-alarm", {}, "boolean", true]);
    }

    if (entry.reminders.overrides) {
      for (let reminderEntry of entry.reminders.overrides) {
        veventcomps.push(jsonToAlarm(reminderEntry));
      }
    }
  }

  // TODO reminders and default reminders
  setIf("x-moz-lastack", "date-time", privateProps["X-MOZ-LASTACK"]);
  setIf("x-moz-snooze-time", "date-time", privateProps["X-MOZ-SNOOZE-TIME"]);

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
  if (categories) {
    veventprops.push(["categories", {}, "text", ...categories]);
  }

  // TODO do we still need referenceItem?

  return {
    // TODO having both title and formats/jcal/summary kinda sucks. Maybe go with shell format instead
    id: uid,
    title: summary,
    type: "event",
    location: entry.location,
    description: entry.description,
    categories: categories,
    metadata: {
      etag: entry.etag,
      path: entry.id,
    },
    formats: { use: "jcal", jcal: vevent },
  };
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

    // TODO default reminders from stream
    // let defaultReminders = (aData.defaultReminders || []).map(reminder =>
    //   JSONToAlarm(reminder, true)
    // );

    // In the first pass, we go through the data and sort into parent items and exception items, as
    // the parent item might be after the exception in the stream.
    // TODO figure out if it is ok to throw here
    await Promise.all(
      data.items.map(async entry => {
        let item = await jsonToEvent(entry, this.calendar); // TODO pass in default reminders
        item.formats.jcal = addVCalendar(item.formats.jcal);

        if (entry.originalStartTime) {
          exceptionItems.push(item);
        } else {
          this.parentItems[item.id] = item;
          await this.commitItem(item);
        }
      })
    );

    // Not doing this in parallel in case multiple exceptions for a parent item confuse things.
    for (let exc of exceptionItems) {
      let item = this.parentItems[exc.id];

      if (item) {
        await this.processException(exc, item);
      } else {
        this.missingParents.push(exc);
      }
      // TODO are we saving the etag of the exception events for future use?
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
        let item = await jsonToTask(entry, this.calendar);
        item.formats.jcal = addVCalendar(item.formats.jcal);
        await this.commitItem(item);
      })
    );
  }

  async processException(exc, item) {
    let itemCalendar = new ICAL.Component(item.formats.jcal);
    let itemEvent = itemCalendar.getFirstSubcomponent("vevent");

    let exceptionCalendar = new ICAL.Component(exc.formats.jcal);
    let exceptionEvent = exceptionCalendar.getFirstSubcomponent("vevent");

    if (itemEvent.getFirstPropertyValue("status") == "CANCELLED") {
      // Cancelled parent items don't have the full amount of information, specifically no
      // recurrence info. Since they are cancelled anyway, we can just ignore processing this
      // exception.
      return;
    }

    if (exceptionEvent.getFirstPropertyValue("status") == "CANCELLED") {
      itemEvent.addPropertyWithValue(
        "exdate",
        exceptionEvent.getFirstPropertyValue("recurrence-id").clone()
      );
    } else {
      itemCalendar.addSubcomponent(exceptionEvent);
    }

    this.parentItems[item.id] = item;
    await this.commitItem(item);
  }

  async commitItem(item) {
    // This is a normal item. If it was canceled, then it should be deleted, otherwise it should be
    // either added or modified. The relaxed mode of the cache calendar takes care of the latter two
    // cases.
    let vcalendar = new ICAL.Component(item.formats.jcal);
    let vcomp = vcalendar.getFirstSubcomponent("vevent") || vcalendar.getFirstSubcomponent("vtodo");

    if (vcomp.getFirstPropertyValue("status") == "CANCELLED") {
      await messenger.calendar.items.remove(this.calendar.cacheId, item.id);
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
        let excCalendar = new ICAL.Component(exc.formats.jcal);
        let excEvent = excCalendar.getFirstSubcomponent("vevent");

        let item = await messenger.calendar.items.get(this.calendar.cacheId, exc.id, {
          returnFormat: "jcal",
        });
        if (item) {
          await this.processException(exc, item);
        } else if (excEvent.getFirstPropertyValue("status") != "CANCELLED") {
          // If the item could not be found, it could be that the user is invited to an instance of
          // a recurring event. Unless this is a cancelled exception, create a mock parent item with
          // one positive RDATE.
          let recId = excEvent.getFirstPropertyValue("recurrence-id");
          // TODO this was also in the old code, but what happens if someone is invited to an
          // exception of a recurring event that doesn't fall on the date of the recurrence-id?
          excEvent.updatePropertyWithValue("dtstart", recId.clone());
          excEvent.removeAllProperties("recurrence-id");
          excEvent.updatePropertyWithValue("x-moz-faked-master", "1");
          excEvent.updatePropertyWithValue("rdate", recId.clone());

          // By now, exc is the parent event
          await this.commitItem(exc);
        }
      })
    );

    this.missingParents = [];
  }
}
