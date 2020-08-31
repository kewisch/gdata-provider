/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { categoriesStringToArray, arrayToCategoriesString, reverseObject } from "./utils.js";
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
  function setIf(obj, prop, value) {
    if (value !== null && typeof value != "undefined") {
      obj[prop] = value;
    }
  }

  let vcalendar = new ICAL.Component(item.formats.jcal);
  let vevent = vcalendar.getFirstSubcomponent("vevent");
  if (!vevent) {
    throw new Error(`Missing vevent in toplevel component ${item.formats.jcal?.[0]}`);
  }
  let entry = { extendedProperties: { private: {}, shared: {} } };

  setIf(entry, "icalUID", item.id);
  setIf(entry, "summary", item.title);
  setIf(entry, "description", item.description);
  setIf(entry, "location", item.location);

  setIf(entry, "start", dateToJson(vevent.getFirstProperty("dtstart")));
  setIf(entry, "end", dateToJson(vevent.getFirstProperty("dtend"))); // TODO duration

  // TODO calendar.google.enableAttendees
  entry.attendees = convertAttendees(vevent);

  // TODO recurence
  // TODO recurring snooze
  setIf(entry, "originalStartTime", dateToJson(vevent.getFirstProperty("recurrence-id")));

  entry.reminders = { overrides: [], useDefault: false };
  for (let valarm of vevent.getAllSubcomponents("valarm")) {
    if (valarm.getFirstPropertyValue("x-default-alarm")) {
      // This is one of the Google default alarms on the calendar, it should therefore not be
      // serialized. We need to do this because Lightning does not have the concept of a default
      // alarm.
      entry.reminders.useDefault = true;
      continue;
    }
    if (entry.reminders.overrides.length == 5) {
      // Need to continue here, there may be x-default-alarms further on.
      continue;
    }

    let override = {};
    override.method = ALARM_ACTION_MAP_REV[valarm.getFirstPropertyValue("action")];
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
      let length = vevent
        .getFirstPropertyValue("dtend")
        .subtractDateTz(vevent.getFirstPropertyValue("dtstart"));
      override.minutes = -Math.floor(
        (trigger.getFirstValue().toSeconds() + length.toSeconds()) / 60
      );
    } else {
      override.minutes = -Math.floor(trigger.getFirstValue().toSeconds() / 60);
    }

    override.minutes = Math.min(Math.max(0, override.minutes), FOUR_WEEKS_IN_MINUTES);
    entry.reminders.overrides.push(override);
  }

  if (!entry.reminders.overrides.length && vevent.getFirstPropertyValue("x-default-alarm")) {
    delete entry.reminders.overrides;
    entry.reminders.useDefault = true;
  }

  setIf(
    entry.extendedProperties.private,
    "X-MOZ-LASTACK",
    vevent.getFirstPropertyValue("x-moz-lastack")?.toICALString()
  );
  setIf(
    entry.extendedProperties.private,
    "X-MOZ-SNOOZE-TIME",
    vevent.getFirstPropertyValue("x-moz-snooze-time")?.toICALString()
  );

  setIf(entry, "sequence", vevent.getFirstPropertyValue("sequence"));
  setIf(entry, "status", vevent.getFirstPropertyValue("status")?.toLowerCase());
  if (entry.status == "cancelled") {
    throw new Error("NS_ERROR_LOSS_OF_SIGNIFICANT_DATA");
  }
  if (entry.status == "none") {
    delete entry.status;
  }

  setIf(entry, "transparency", vevent.getFirstPropertyValue("transp")?.toLowerCase());
  setIf(entry, "visibility", vevent.getFirstPropertyValue("class")?.toLowerCase()); // TODO mapping

  setIf(
    entry.extendedProperties.shared,
    "X-MOZ-CATEGORIES",
    arrayToCategoriesString(item.categories)
  );

  return entry;
}

function taskToJson(item, calendar, isImport) {
  function setIf(obj, prop, value) {
    if (value !== null && typeof value != "undefined") {
      obj[prop] = value;
    }
  }

  let vcalendar = new ICAL.Component(item.formats.jcal);
  let vtodo = vcalendar.getFirstSubcomponent("vtodo");
  let entry = {};

  setIf(entry, "id", item.id);
  setIf(entry, "title", item.title);
  setIf(
    entry,
    "status",
    vtodo.getFirstPropertyValue("status") == "completed" ? "completed" : "needsAction"
  );
  setIf(entry, "notes", item.description);

  setIf(entry, "due", vtodo.getFirstPropertyValue("due")?.toString());
  setIf(entry, "completed", vtodo.getFirstPropertyValue("completed")?.toString());

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
    type: "todo",
    description: entry.notes,
    metadata: {
      etag: entry.etag,
      path: entry.id,
    },
    formats: { use: "jcal", jcal: vtodo },
  };
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

    attendees.push(att);
  }
  return attendees;
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
  function setIfFirstProperty(obj, prop, jprop, transform) {
    let oldValue = oldTask.getFirstPropertyValue(jprop || prop);
    let newValue = task.getFirstPropertyValue(jprop || prop);

    if (oldValue?.toString() !== newValue?.toString()) {
      obj[prop] = transform ? transform(newValue) : newValue;
    }
  }

  let entry = {};
  let task = new ICAL.Component(item.formats.jcal).getFirstSubcomponent("vtodo");
  let oldTask = new ICAL.Component(oldItem.formats.jcal).getFirstSubcomponent("vtodo");

  setIfFirstProperty(entry, "title", "summary");
  setIfFirstProperty(entry, "status");
  setIfFirstProperty(entry, "notes", "description");

  setIfFirstProperty(entry, "due", "due", dueDate => dueDate.toString());
  setIfFirstProperty(entry, "completed", "completed", completedDate => completedDate.toString());

  return entry;
}

function patchEvent(item, oldItem) {
  function setIfFirstProperty(obj, prop, jprop, transform) {
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

  setIfFirstProperty(entry, "summary");
  setIfFirstProperty(entry, "description");
  setIfFirstProperty(entry, "location");

  setIfDateChanged(entry, "start", "dtstart");
  setIfDateChanged(entry, "end", "dtend");

  // TODO recurence
  // TODO recurring snooze
  // TODO reminders

  setIfDateChanged(entry, "originalStartTime", "recurrence-id");

  setIfFirstProperty(entry, "sequence");
  setIfFirstProperty(entry, "status", "status", status => status?.toLowerCase());
  setIfFirstProperty(entry, "transparency", "transp", transparency => transparency?.toLowerCase());
  setIfFirstProperty(entry, "visibility", "class", visibility => visibility?.toLowerCase());

  // Attendees
  // TODO this doesn't take into account changes within an attendee
  if (haveAttendeesChanged(event, oldEvent)) {
    entry.attendees = convertAttendees(event);
  }

  // Categories
  let oldCatSet = new Set(oldItem.categories);
  if (
    oldCatSet.size != item.categories.length ||
    item.categories.some(itm => !oldCatSet.has(itm))
  ) {
    entry.extendedProperties.shared["X-MOZ-CATEGORIES"] = arrayToCategoriesString(item.categories);
  }

  setIfFirstProperty(entry.extendedProperties.private, "X-MOZ-LASTACK", "x-moz-lastack", ack =>
    ack?.toICALString()
  );
  setIfFirstProperty(
    entry.extendedProperties.private,
    "X-MOZ-SNOOZE-TIME",
    "x-moz-snooze-time",
    snooze => snooze?.toICALString()
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

  // TODO json to date: start/end/recurrence-id

  setIf("uid", "text", uid);
  setIf("created", "date-time", entry.created);
  setIf("last-modified", "date-time", entry.updated);
  setIf("dtstamp", "date-time", entry.updated);

  setIf("description", "text", entry.description);
  setIf("location", "text", entry.location);
  setIf("status", "text", entry.status);

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

    if (entry.organizer.self) {
      // TODO remember display name for scheduling, we found ourselves!
    }
  }

  // TODO setupRecurrence

  for (let attendee of entry.attendees || []) {
    let id = attendee.email ? "mailto:" + attendee.email : "urn:id:" + attendee.id;
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
    if (entry.reminders.useDefault && defaultReminders.length) {
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

  /* TODO this seems misplaced?
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

    for (let [rid, value] of Object.entries(snoozeObj || {})) {
      setIf("x-moz-snooze-time-" + rid, "date-time", value);
    }
  }
  */

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
  masterItems = Object.create(null);

  constructor(calendar) {
    this.calendar = calendar;
    this.console = calendar.console;
  }

  parseItemStream(data) {
    if (data.kind == "calendar#events") {
      return this.parseEventStream(data);
    } else if (data.kind == "tasks#tasks") {
      return this.parseTaskStream(data);
    } else {
      throw new Error("Invalid stream type: " + data?.kind);
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

    // In the first pass, we go through the data and sort into master items and exception items, as
    // the master item might be after the exception in the stream.
    await Promise.all(
      data.items.map(async entry => {
        let item = await jsonToEvent(entry, this.calendar);

        if (!entry.originalStartTime) {
          // TODO exceptions
          this.masterItems[item.id] = item;
          try {
            await this.commitItem(item);
          } catch (e) {
            console.error(e);
          }
        }
      })
    );
  }

  async parseTaskStream(data) {
    await Promise.all(
      data.items.map(async entry => {
        let item = await jsonToTask(entry, this.calendar);
        try {
          await this.commitItem(item);
        } catch (e) {
          console.error(e);
        }
      })
    );
  }

  async commitItem(item) {
    // This is a normal item. If it was canceled, then it should be deleted, otherwise it should be
    // either added or modified. The relaxed mode of the cache calendar takes care of the latter two
    // cases.
    let vevent = new ICAL.Component(item.formats.jcal);
    if (vevent.getFirstPropertyValue("status") == "cancelled") {
      await messenger.calendar.items.remove(this.calendar.cacheId, item.id);
    } else {
      await messenger.calendar.items.create(this.calendar.cacheId, item);
    }
  }

  async complete() {
    // TODO
  }
}
