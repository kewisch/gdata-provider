import gcalItems from "./fixtures/gcalItems.json";
import jcalItems from "./fixtures/jcalItems.json";

import { findRelevantInstance, transformDateXprop, jsonToItem, jsonToDate, itemToJson, patchItem, ItemSaver } from "../../src/background/items";
import calGoogleCalendar from "../../src/background/calendar";
import ICAL from "../../src/background/libs/ical.js";
import TimezoneService from "../../src/background/timezone.js";
import createMessenger from "./helpers/webext-api.js";
import { deepFreeze, copy } from "./helpers/util.js";

import { jest } from "@jest/globals";

deepFreeze(gcalItems);
deepFreeze(jcalItems);

var defaultTimezone;

beforeEach(() => {
  global.messenger = createMessenger();
  defaultTimezone = TimezoneService.get("Europe/Berlin");

  jest.spyOn(global.console, "log").mockImplementation(() => {});
  jest.spyOn(global.console, "warn").mockImplementation(() => {});
  jest.spyOn(global.console, "error").mockImplementation(() => {});
  TimezoneService.init();

  global.window = {
    DOMParser: class {
      parseFromString(html, type) {
        return {
          documentElement: {
            textContent: html.replace(/<[^>]*>/g, ""),
          },
        };
      }
    },
  };
});

// TODO test recurrence-id/ost, recurringEventId
// TODO conferenceData

test("findRelevantInstance", () => {
  let vcalendar = new ICAL.Component(jcalItems.simple_event.item);
  let vevent = vcalendar.getFirstSubcomponent("vevent");
  expect(findRelevantInstance(vcalendar, false, "vevent")).toBe(vevent);
  expect(findRelevantInstance(vcalendar, "2024-01-01", "vevent")).toBeNull();

  vcalendar = new ICAL.Component(jcalItems.recur_instance.item);
  vevent = vcalendar.getFirstSubcomponent("vevent");
  expect(findRelevantInstance(vcalendar, false, "vevent")).toBeNull();
  expect(findRelevantInstance(vcalendar, "2006-06-25", "vevent")).toBe(vevent);
});

test("transformDateXprop", () => {
  expect(transformDateXprop(null)).toBeNull();
  expect(transformDateXprop("2024-01-01T01:02:03Z")).toBe("2024-01-01T01:02:03Z");
  expect(transformDateXprop(ICAL.Time.fromString("2024-01-01T01:02:03Z"))).toBe("2024-01-01T01:02:03Z");
  expect(transformDateXprop("20240101T010203Z")).toBe("2024-01-01T01:02:03Z");
  expect(transformDateXprop("2024aaaa0101T010203Z")).toBe(null);
});

describe("jsonToItem", () => {
  let calendar = { console, name: "calendarName" };

  describe("events", () => {
    test("simple event", async () => {
      let defaultReminders = [{ method: "popup", minutes: 120 }];

      let item = await jsonToItem({
        entry: gcalItems.simple_event,
        calendar,
        defaultReminders,
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(item.metadata.etag).toBe('"2299601498276000"');
      expect(item.metadata.path).toBe("go6ijb0b46hlpbu4eeu92njevo");

      expect(jcal.getFirstPropertyValue("uid")).toBe("go6ijb0b46hlpbu4eeu92njevo@google.com");
      expect(jcal.getFirstPropertyValue("status")).toBe("CONFIRMED");
      expect(jcal.getFirstPropertyValue("url")).toBe(
        "https://example.com/calendar/event?eid=eventhash"
      );
      expect(jcal.getFirstPropertyValue("created").toICALString()).toBe("20060608T210452Z");
      expect(jcal.getFirstPropertyValue("last-modified").toICALString()).toBe("20060608T210549Z");
      expect(jcal.getFirstPropertyValue("dtstamp").toICALString()).toBe("20060608T210549Z");
      expect(jcal.getFirstPropertyValue("summary")).toBe("New Event");
      expect(jcal.getFirstPropertyValue("description")).toBe("Description");
      expect(jcal.getFirstPropertyValue("location")).toBe("Hard Drive");
      expect(jcal.getFirstPropertyValue("transp")).toBe("TRANSPARENT");
      expect(jcal.getFirstPropertyValue("class")).toBe("PRIVATE");
      expect(jcal.getFirstPropertyValue("sequence")).toBe(1);

      expect(jcal.getFirstPropertyValue("organizer")).toBe("mailto:organizer@example.com");
      expect(jcal.getFirstProperty("organizer").getParameter("cn")).toBe("Eggs P. Seashell");

      // TODO timezones are a bit wonky. Probably need a test where there is just an offset but no zone
      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060610T180000");
      expect(jcal.getFirstProperty("dtstart").getParameter("tzid")).toBe("Europe/Berlin");

      expect(jcal.getFirstPropertyValue("dtend").toICALString()).toBe("20060610T200000");
      expect(jcal.getFirstProperty("dtend").getParameter("tzid")).toBe("Europe/Berlin");

      let alarms = jcal.getAllSubcomponents("valarm");
      expect(alarms.length).toBe(4);

      let alarminfo = alarms.map(alarm => {
        return {
          action: alarm.getFirstPropertyValue("action"),
          trigger: alarm.getFirstPropertyValue("trigger").toICALString(),
          "x-default-alarm": alarm.getFirstPropertyValue("x-default-alarm")
        };
      });
      expect(alarminfo).toEqual(expect.arrayContaining([
        {
          action: "EMAIL",
          trigger: "-PT20M",
          "x-default-alarm": null,
        },
        {
          action: "DISPLAY",
          trigger: "-PT5M",
          "x-default-alarm": null,
        },
        {
          action: "DISPLAY",
          trigger: "-PT10M",
          "x-default-alarm": null,
        },
        {
          action: "DISPLAY",
          trigger: "-PT2H",
          "x-default-alarm": true,
        }
      ]));

      let attendees = jcal.getAllProperties("attendee");
      expect(attendees.length).toBe(2);
      expect(attendees[0].getFirstValue()).toBe("mailto:attendee@example.com");
      expect(attendees[0].getParameter("cn")).toBe("attendee name");
      expect(attendees[0].getParameter("role")).toBe("OPT-PARTICIPANT");
      expect(attendees[0].getParameter("partstat")).toBe("TENTATIVE");
      expect(attendees[0].getParameter("cutype")).toBe("INDIVIDUAL");

      expect(attendees[1].getFirstValue()).toBe("mailto:attendee2@example.com");
      expect(attendees[1].getParameter("role")).toBe("REQ-PARTICIPANT");
      expect(attendees[1].getParameter("partstat")).toBe("TENTATIVE");
      expect(attendees[1].getParameter("cutype")).toBe("RESOURCE");

      let attachments = jcal.getAllProperties("attach");
      expect(attachments.length).toBe(1);
      expect(attachments[0].getParameter("fmttype")).toBe("text/plain");
      expect(attachments[0].getParameter("managed-id")).toBe("97e46c33-3fc7-4fb8-93d9-5e0f532d972f");
      expect(attachments[0].getParameter("filename")).toBe("Attachment");

      expect(jcal.getFirstProperty("categories").getValues()).toEqual(["foo", "bar"]);
      expect(jcal.getFirstPropertyValue("x-moz-lastack").toString()).toBe("2014-01-01T01:01:01Z");
      expect(jcal.getFirstPropertyValue("x-moz-snooze-time").toString()).toBe(
        "2014-01-01T02:02:02Z"
      );
      expect(jcal.getFirstPropertyValue("x-google-color-id")).toBe("17");

      // Remove the properties we consumed and see if we forgot anything
      [
        "uid",
        "status",
        "url",
        "created",
        "last-modified",
        "dtstamp",
        "summary",
        "description",
        "location",
        "transp",
        "class",
        "sequence",
        "organizer",
        "dtstart",
        "dtend",
        "attendee",
        "attach",
        "categories",
        "x-moz-lastack",
        "x-moz-snooze-time",
        "x-google-color-id",
        "x-default-alarm"
      ].forEach(prop => {
        jcal.removeAllProperties(prop);
      });
      let remaining = jcal.getAllProperties().map(prop => prop.name);
      if (remaining.length) {
        console.debug("Remaining props:", remaining);
      }
      expect(remaining.length).toBe(0);
    });

    test("simple event no cn", async () => {
      let defaultReminders = [{ method: "popup", minutes: 120 }];
      let gcalItem = copy(gcalItems.simple_event);
      delete gcalItem.organizer.displayName;

      let item = await jsonToItem({
        entry: gcalItem,
        calendar,
        defaultReminders,
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(jcal.getFirstPropertyValue("organizer")).toBe("mailto:organizer@example.com");
      expect(jcal.getFirstProperty("organizer").getParameter("cn")).toBe(undefined);
    });

    test("simple event ical lastack", async () => {
      let defaultReminders = [{ method: "popup", minutes: 120 }];
      let gcalItem = copy(gcalItems.simple_event);
      gcalItem.extendedProperties.private["X-MOZ-LASTACK"] = "20140202T020202Z";

      let item = await jsonToItem({
        entry: gcalItem,
        calendar,
        defaultReminders,
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(jcal.getFirstPropertyValue("x-moz-lastack").toString()).toBe("2014-02-02T02:02:02Z");
    });

    test("valarm_no_default_override event", async () => {
      let defaultReminders = [{ method: "popup", minutes: 120 }];
      let item = await jsonToItem({
        entry: gcalItems.valarm_no_default_override,
        calendar,
        accessRole: "freeBusyReader",
        defaultReminders,
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(jcal.getFirstPropertyValue("uid")).toBe("swpefnfloqssxjdlbpyqlyqddb@google.com");
      expect(jcal.getFirstPropertyValue("summary")).toBe("busyTitle[calendarName]");
      expect(jcal.getFirstProperty("dtend")).toBe(null); // endTimeUnspecified
      expect(jcal.getFirstPropertyValue("organizer")).toBe(
        "urn:id:b4d9b3a9-b537-47bd-92a1-fb40c0c1c7fc"
      );
      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060610");

      let alarms = jcal.getAllSubcomponents("valarm");
      expect(alarms?.length).toBe(1);
      expect(alarms[0].getFirstPropertyValue("trigger").toICALString()).toBe("-PT20M");
    });

    test("valarm_default_override event", async () => {
      let defaultReminders = [{ method: "popup", minutes: 120 }];
      let item = await jsonToItem({
        entry: gcalItems.valarm_default_override,
        calendar,
        accessRole: "freeBusyReader",
        defaultReminders,
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(jcal.getFirstPropertyValue("uid")).toBe("swpefnfloqssxjdlbpyqlyqddb@google.com");
      expect(jcal.getFirstPropertyValue("summary")).toBe("busyTitle[calendarName]");
      expect(jcal.getFirstProperty("dtend")).toBe(null); // endTimeUnspecified
      expect(jcal.getFirstPropertyValue("organizer")).toBe(
        "urn:id:b4d9b3a9-b537-47bd-92a1-fb40c0c1c7fc"
      );
      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060610");

      let alarms = jcal.getAllSubcomponents("valarm");
      expect(alarms?.length).toBe(2);
      let triggers = alarms.map(alarm => alarm.getFirstPropertyValue("trigger").toICALString());
      expect(triggers).toEqual(expect.arrayContaining(["-PT20M", "-PT2H"]));
    });
    test("utc_event event", async () => {
      let item = await jsonToItem({
        entry: gcalItems.utc_event,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(jcal.getFirstPropertyValue("uid")).toBe("uasfsingergnenedfwiefefgjk@google.com");
      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060610T010203Z");
    });

    test("recur rule", async () => {
      let item = await jsonToItem({
        entry: gcalItems.recur_rrule,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(jcal.getFirstPropertyValue("exdate")?.toICALString()).toBe("20070609");
      expect(jcal.getFirstPropertyValue("rdate")?.toICALString()).toBe("20060812");

      // 1155340800000000 == 2006-08-12 00:00:00 UTC
      expect(jcal.getFirstPropertyValue("x-moz-snooze-time-1155340800000000")?.toICALString()).toBe(
        "20211012T123456Z"
      );

      let recur = jcal.getFirstPropertyValue("rrule");
      expect(recur).toBeTruthy();
      expect(recur.freq).toBe("YEARLY");
      expect(recur.count).toBe(5);
      expect(recur.parts.BYDAY).toEqual(["-1SU", "2SA"]);
      expect(recur.parts.BYMONTH).toEqual([6]);
    });

    test("recur instance", async () => {
      let item = await jsonToItem({
        entry: gcalItems.recur_instance,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060626");
      expect(jcal.getFirstPropertyValue("recurrence-id").toICALString()).toBe("20060625");
    });

    test("html description", async () => {
      let item = await jsonToItem({
        entry: gcalItems.html_descr,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      let descr = jcal.getFirstProperty("description");
      expect(descr.getParameter("altrep")).toBe("data:text/html,%3Cb%3EBold%3C%2Fb%3E");
      expect(descr.getFirstValue()).toBe("Bold");
    });

    test("non-standard event types", async () => {
      let item = await jsonToItem({
        entry: gcalItems.ooo_event,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");
      expect(jcal.getFirstPropertyValue("x-google-event-type")).toBe("outOfOffice");

      item = await jsonToItem({
        entry: gcalItems.focus_event,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      jcal = new ICAL.Component(item.item).getFirstSubcomponent("vevent");
      expect(jcal.getFirstPropertyValue("x-google-event-type")).toBe("focusTime");
    });
  });

  describe("tasks", () => {
    test("simple task", async () => {
      let item = await jsonToItem({
        entry: gcalItems.simple_task,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item);
      jcal = jcal.getFirstSubcomponent("vtodo");

      expect(jcal.getFirstPropertyValue("uid")).toBe("lqohjsbhqoztdkusnpruvooacn");
      expect(jcal.getFirstPropertyValue("last-modified")?.toICALString()).toBe("20060608T210549Z");
      expect(jcal.getFirstPropertyValue("dtstamp")?.toICALString()).toBe("20060608T210549Z");
      expect(jcal.getFirstPropertyValue("description")).toBe("description");
      expect(jcal.getFirstPropertyValue("url")).toBe(
        "https://example.com/calendar/view/task?eid=taskhash"
      );
      expect(jcal.getFirstProperty("related-to")?.jCal).toEqual([
        "related-to",
        { reltype: "PARENT" },
        "text",
        "parentId",
      ]);
      expect(jcal.getFirstPropertyValue("x-google-sortkey")).toBe(12312);
      expect(jcal.getFirstPropertyValue("status")).toBe("COMPLETED");
      expect(jcal.getFirstPropertyValue("completed")?.toICALString()).toBe("20060611T180000");
      expect(jcal.getFirstPropertyValue("due")?.toICALString()).toBe("20060610T180000");

      let links = jcal.getAllProperties("attach");
      expect(links.length).toBe(1);
      expect(links[0].getParameter("filename")).toBe("filename.pdf");
      expect(links[0].getParameter("x-google-type")).toBe("href");
      expect(links[0].getFirstValue()).toBe("https://example.com/filename.pdf");
    });

    test("deleted task", async () => {
      let item = await jsonToItem({
        entry: gcalItems.deleted_task,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item);
      jcal = jcal.getFirstSubcomponent("vtodo");

      expect(jcal.getFirstPropertyValue("uid")).toBe("jidlfaenrgjklebrgjebuwdfer");
      expect(jcal.getFirstPropertyValue("status")).toBe("CANCELLED");
    });

    test("needsAction task", async () => {
      let item = await jsonToItem({
        entry: gcalItems.needs_action,
        calendar,
        defaultReminders: [],
        defaultTimezone
      });
      let jcal = new ICAL.Component(item.item);
      jcal = jcal.getFirstSubcomponent("vtodo");

      expect(jcal.getFirstPropertyValue("uid")).toBe("jidlfaenrgjklebrgjebuwdfer");
      expect(jcal.getFirstPropertyValue("status")).toBe("NEEDS-ACTION");
    });
  });
  test("invalid item type", () => {
    expect(jsonToItem({ entry: { kind: "invalid" }, calendar })).toBe(null);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("jsonToDate", () => {
  let cases = [
    [
      null, null
    ],
    [
      { date: "2024-01-01" },
      ["dtstart", {}, "date", "2024-01-01"]
    ],
    [
      { dateTime: "2024-01-01T01:02:03.456Z" },
      ["dtstart", {}, "date-time", "2024-01-01T01:02:03Z"]
    ],
    [
      { dateTime: "2024-01-01T01:02:03.456+01:00", timeZone: "Europe/Berlin" },
      ["dtstart", { tzid: "Europe/Berlin" }, "date-time", "2024-01-01T01:02:03"]
    ],
    [
      { dateTime: "2024-01-01T17:02:03.456+01:00", timeZone: "America/Los_Angeles" },
      ["dtstart", { tzid: "America/Los_Angeles" }, "date-time", "2024-01-01T08:02:03"]
    ]
  ];


  test.each(cases)("convert %s", (gcalDate, jcalDate) => {
    let berlin = TimezoneService.get("Europe/Berlin");
    expect(jsonToDate("dtstart", gcalDate, berlin)).toEqual(jcalDate);
  });

  test("invalid zone", () => {
    let berlin = TimezoneService.get("Europe/Berlin");
    expect(() => {
      jsonToDate("dtstart", { dateTime: "2024-01-01T01:02:03.456+01:00", timeZone: "Murica" }, berlin);
    }).toThrow("Could not find zone Murica");
  });
});

describe("itemToJson", () => {
  let calendar = { console, name: "calendarName" };

  test("simple_event", async () => {
    let data = itemToJson(jcalItems.simple_event, calendar, false, true);

    // TODO originalStartTime
    // TODO date value

    expect(data).toEqual({
      extendedProperties: {
        private: { "X-MOZ-LASTACK": "2014-01-01T01:01:01Z", "X-MOZ-SNOOZE-TIME": "2014-01-01T02:02:02Z" },
        shared: { "X-MOZ-CATEGORIES": "foo,bar" },
      },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
      summary: "New Event",
      description: "Description",
      location: "Hard Drive",
      start: { dateTime: "2006-06-10T18:00:00", timeZone: "Europe/Berlin" },
      end: { dateTime: "2006-06-10T20:00:00", timeZone: "Europe/Berlin" },
      organizer: {
        "displayName": "Eggs P. Seashell",
        "email": "organizer@example.com"
      },
      colorId: "17",
      attendees: [
        {
          displayName: "attendee name",
          email: "attendee@example.com",
          optional: true,
          resource: false,
          responseStatus: "tentative",
        },
        {
          email: "attendee2@example.com",
          optional: false,
          resource: true,
          responseStatus: "tentative",
        },
      ],
      reminders: {
        useDefault: true,
        overrides: [
          { method: "email", minutes: 20 },
          { method: "popup", minutes: 5 },
          { method: "popup", minutes: 10 },
          { method: "popup", minutes: 30 },
          { method: "popup", minutes: 35 },
        ],
      },
      sequence: 1,
      status: "confirmed",
      transparency: "transparent",
      visibility: "private",
    });
  });

  test("event 1", async () => {
    let data = itemToJson(jcalItems.valarm_override, calendar, false);
    expect(data).toEqual({
      extendedProperties: {
        private: { "X-MOZ-LASTACK": "2014-01-01T01:01:01Z", "X-MOZ-SNOOZE-TIME": "2014-01-01T02:02:02Z" },
        shared: { "X-MOZ-CATEGORIES": "foo,bar" },
      },
      iCalUID: "swpefnfloqssxjdlbpyqlyqddb@google.com",
      summary: "busyTitle[calendarName]",
      description: "Description",
      location: "Hard Drive",
      start: { date: "2006-06-10" },
      organizer: {
        "displayName": "Eggs P. Seashell",
        "email": "organizer@example.com"
      },
      attendees: [
        {
          displayName: "attendee name",
          email: "attendee@example.com",
          optional: true,
          resource: false,
          responseStatus: "tentative",
        },
      ],
      reminders: {
        useDefault: false,
        overrides: [{ method: "email", minutes: 20 }],
      },
      sequence: 1,
      status: "confirmed",
      transparency: "transparent",
      visibility: "private",
    });
  });

  test("valarm_no_default_override", async () => {
    let data = itemToJson(jcalItems.valarm_no_default_override, calendar, false);
    expect(data).toEqual({
      iCalUID: "xkoaavctdghzjszjssqttcbhkv@google.com",
      reminders: {
        useDefault: true,
      },
      start: {
        date: "2006-06-10",
      },
      end: {
        date: "2006-06-11",
      },
      summary: "New Event",
    });
  });

  test("recurring event rrule", () => {
    let item = copy(jcalItems.recur_rrule);
    let data = itemToJson(item, calendar, false);
    expect(data).toEqual({
      iCalUID: "osndfnwejrgnejnsdjfwegjdfr@google.com",
      start: {
        date: "2006-06-10",
      },
      end: {
        date: "2006-06-11",
      },
      summary: "New Event",
      recurrence: expect.arrayContaining([
        "RRULE:FREQ=YEARLY;COUNT=5;BYDAY=-1SU,2SA;BYMONTH=6",
        "RDATE;VALUE=DATE:20060812",
        "EXDATE;VALUE=DATE:20070609",
      ]),
    });
  });

  test("recurring event instance", () => {
    let data = itemToJson(jcalItems.recur_instance, calendar, false);
    expect(data).toEqual({
      iCalUID: "osndfnwejrgnejnsdjfwegjdfr@google.com",
      recurringEventId: "osndfnwejrgnejnsdjfwegjdfr",
      start: {
        date: "2006-06-26",
      },
      end: {
        date: "2006-06-27",
      },
      originalStartTime: {
        date: "2006-06-25",
      },
      summary: "New Event",
    });
  });

  test("event failures", () => {
    expect(() => {
      itemToJson(
        { type: "event", format: "jcal", item: ["x-wrong", [], [["x-notit", [], []]]] },
        calendar,
        false
      );
    }).toThrow("Missing vevent in toplevel component x-wrong");
    expect(() => {
      itemToJson(
        {
          type: "event",
          format: "jcal",
          item: ["vcalendar", [], [["vevent", [["status", {}, "text", "CANCELLED"]], []]]],
        },
        calendar,
        false
      );
    }).toThrow("NS_ERROR_LOSS_OF_SIGNIFICANT_DATA");
  });

  test("no ids", () => {
    let data = itemToJson(jcalItems.missing_id, calendar, false);
    expect(data).toEqual({
      summary: "New Event",
    });

    data = itemToJson(jcalItems.missing_id_task, calendar, false);
    expect(data).toEqual({
      title: "New Task",
    });
  });

  test("tasks", async () => {
    let data = itemToJson(jcalItems.simple_task, calendar, false);
    expect(data).toEqual({
      due: "2006-06-10",
      completed: "2006-06-11",
      id: "lqohjsbhqoztdkusnpruvooacn",
      status: "needsAction",
      title: "New Task",
    });
  });

  test("unknown", async () => {
    expect(() => {
      itemToJson({ type: "journal" }, calendar, false);
    }).toThrow("Unknown item type: journal");
  });
});

describe("patchItem", () => {
  describe("patchEvent", () => {
    let item, oldItem, event, oldEvent, changes;

    describe("simple event", () => {
      beforeEach(() => {
        oldItem = copy(jcalItems.simple_event);
        item = copy(jcalItems.simple_event);
        event = new ICAL.Component(item.item).getFirstSubcomponent("vevent");
        oldEvent = new ICAL.Component(oldItem.item).getFirstSubcomponent("vevent");
      });

      test("no changes", () => {
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({});
      });

      test("html description", () => {
        event
          .getFirstProperty("description")
          .setParameter("altrep", "data:text/html,<i>changed</i>");

        changes = patchItem(item, oldItem);
        expect(changes).toEqual({ description: "<i>changed</i>" });
      });

      test.each([
        ["summary", "summary", "changed", "changed"],
        ["description", "description", "changed", "changed"],
        ["location", "location", "changed", "changed"],
        ["sequence", "sequence", 2, 2],
        ["status", "status", "TENTATIVE", "tentative"],
        ["transp", "transparency", "OPAQUE", "opaque"],
        ["class", "visibility", "PUBLIC", "public"],
        [
          "x-moz-lastack",
          "extendedProperties",
          "2006-06-10T19:00:00Z",
          { private: { "X-MOZ-LASTACK": "2006-06-10T19:00:00Z" } },
        ],
        [
          "x-moz-snooze-time",
          "extendedProperties",
          "2006-06-10T19:00:00Z",
          { private: { "X-MOZ-SNOOZE-TIME": "2006-06-10T19:00:00Z" } },
        ],
        [
          "attendee",
          "attendees",
          "mailto:attendee3@example.com",
          expect.arrayContaining([
            {
              email: "attendee2@example.com",
              optional: false,
              resource: true,
              responseStatus: "tentative",
            },
            {
              displayName: "attendee name",
              email: "attendee3@example.com",
              optional: true,
              resource: false,
              responseStatus: "tentative",
            },
          ]),
        ],
      ])("prop %s", (jprop, prop, jchanged, changed) => {
        event.updatePropertyWithValue(jprop, jchanged);
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({ [prop]: changed });
      });

      test.each([
        [
          "dtstart",
          "start",
          ICAL.Time.fromString("2006-06-10T19:00:00"),
          { dateTime: "2006-06-10T19:00:00", timeZone: "Europe/Berlin" },
        ],
        [
          "dtend",
          "end",
          ICAL.Time.fromString("2006-06-10T19:00:00"),
          { dateTime: "2006-06-10T19:00:00", timeZone: "Europe/Berlin" },
        ],
      ])("date prop %s", (jprop, prop, jchanged, changed) => {
        event.updatePropertyWithValue(jprop, jchanged);
        changes = patchItem(item, oldItem);
        // TODO why are we expecting reminders to change here?
        expect(changes).toEqual({ [prop]: changed, reminders: expect.anything() });
      });

      test.each([
        [
          "dtstart",
          "start",
          { dateTime: "2006-06-10T18:00:00", timeZone: "America/Los_Angeles" },
        ],
        [
          "dtend",
          "end",
          { dateTime: "2006-06-10T20:00:00", timeZone: "America/Los_Angeles" },
        ],
      ])("date prop %s timezone change", (jprop, prop, changed) => {
        event.getFirstProperty(jprop).setParameter("tzid", "America/Los_Angeles");
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({ [prop]: changed, reminders: expect.anything() });
      });

      test("dtend unspecified", () => {
        event.removeProperty("dtend");
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({ endTimeUnspecified: true, reminders: expect.anything() });
      });

      test("duration instead of dtend", () => {
        event.removeProperty("dtend");
        event.addPropertyWithValue("duration", ICAL.Duration.fromSeconds(1));
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({
          end: {
            "dateTime": "2006-06-10T18:00:01",
            "timeZone": "Europe/Berlin"
          },
          reminders: expect.anything()
        });
      });

      test.each([
        ["cn", "displayName", "changed", "changed"],
        ["role", "optional", "REQ-PARTICIPANT", false],
        ["cutype", "resource", "RESOURCE", true],
        ["partstat", "responseStatus", "ACCEPTED", "accepted"],
      ])("attendee %s", (jprop, prop, jchanged, changed) => {
        event.getFirstProperty("attendee").setParameter(jprop, jchanged);
        changes = patchItem(item, oldItem);

        let attendee = Object.assign(
          {
            displayName: "attendee name",
            email: "attendee@example.com",
            optional: true,
            resource: false,
            responseStatus: "tentative",
          },
          { [prop]: changed }
        );

        expect(changes).toEqual({ attendees: expect.arrayContaining([attendee]) });
      });

      test("attendee removed", () => {
        event.removeAllProperties("attendee");
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({ attendees: [] });
      });

      test("attendee added", () => {
        event.addProperty(
          new ICAL.Property([
            "attendee",
            { email: "attendee3@example.com" },
            "uri",
            "urn:id:b5122b37-1aa7-4af1-a3dc-a54605d58a3d",
          ])
        );
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({
          attendees: expect.arrayContaining([
            {
              displayName: "attendee name",
              email: "attendee@example.com",
              optional: true,
              resource: false,
              responseStatus: "tentative",
            },
            {
              email: "attendee2@example.com",
              optional: false,
              resource: true,
              responseStatus: "tentative",
            },
            {
              email: "attendee3@example.com",
              optional: false,
              resource: false,
              responseStatus: "needsAction",
            },
          ]),
        });
      });

      test("categories", () => {
        event.getFirstProperty("categories").setValues(["foo", "bar", "baz"]);
        item.categories = ["foo", "bar", "baz"];
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({
          extendedProperties: { shared: { "X-MOZ-CATEGORIES": "foo,bar,baz" } },
        });
      });

      test("Conference data removed", () => {
        oldEvent.addPropertyWithValue("x-google-confdata", JSON.stringify({ data: true }));
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({ conferenceData: null });
      });

      test("New conference", () => {
        const UUID_REGEX = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/;
        event.addPropertyWithValue("x-google-confnew", "hangoutsMeet");
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({
          conferenceData: {
            createRequest: {
              requestId: expect.stringMatching(UUID_REGEX),
              conferenceSolutionKey: {
                type: "hangoutsMeet"
              }
            }
          }
        });
      });
    });

    test("organizer partstat change", () => {
      item = copy(jcalItems.organizer_partstat);
      oldItem = copy(item);

      oldEvent = new ICAL.Component(oldItem.item).getFirstSubcomponent("vevent");
      event = new ICAL.Component(item.item).getFirstSubcomponent("vevent");
      event.getFirstProperty("organizer").setParameter("partstat", "ACCEPTED");

      // Ensure organizer partstat is propagated to attendee (to work around a Thunderbird bug)
      changes = patchItem(item, oldItem);
      expect(changes).toEqual({
        "attendees": [
          {
            "displayName": "Eggs P. Seashell",
            "email": "organizer@example.com",
            "optional": false,
            "resource": false,
            "responseStatus": "accepted",
          },
          {
            "displayName": "Eggs P. Seashell Jr.",
            "email": "attendee@example.com",
            "optional": false,
            "resource": false,
            "responseStatus": "accepted",
          }
        ],
      });


      // Ensure organizer is added as attendee if partstat changes
      let attendees = event.getAllProperties("attendee");
      let attendee = attendees.find(att => att.getFirstValue() == "mailto:organizer@example.com");
      expect(attendee).not.toBe(null);

      event.removeProperty(attendee);

      changes = patchItem(item, oldItem);
      expect(changes).toEqual({
        "attendees": [
          {
            "displayName": "Eggs P. Seashell Jr.",
            "email": "attendee@example.com",
            "optional": false,
            "resource": false,
            "responseStatus": "accepted",
          },
          {
            "displayName": "Eggs P. Seashell",
            "email": "organizer@example.com",
            "optional": false,
            "resource": false,
            "responseStatus": "accepted",
          }
        ],
      });
    });

    test("organizer change", () => {
      item = copy(jcalItems.organizer_partstat);
      oldItem = copy(item);

      oldEvent = new ICAL.Component(oldItem.item).getFirstSubcomponent("vevent");
      event = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

      // Shouldn't be able to change organizer if there was one set before
      event.getFirstProperty("organizer").setValue("mailto:organizer2@example.com");
      expect(() => patchItem(item, oldItem)).toThrow("Changing organizer requires a move");

      // But should be able to if there was not one before
      oldEvent.removeProperty("organizer");
      changes = patchItem(item, oldItem, false);
      expect(changes).toEqual({
        organizer: {
          displayName: "Eggs P. Seashell",
          email: "organizer2@example.com",
        },
        attendees: [
          {
            "displayName": "Eggs P. Seashell",
            "email": "organizer@example.com",
            "optional": false,
            "resource": false,
            "responseStatus": "needsAction",
          },
          {
            "displayName": "Eggs P. Seashell Jr.",
            "email": "attendee@example.com",
            "optional": false,
            "resource": false,
            "responseStatus": "accepted",
          }

        ]
      });
    });

    describe("reminders", () => {
      // Using a different event here, otherwise we hit the 5 alarms limit
      beforeEach(() => {
        oldItem = jcalItems.valarm_override;
        item = copy(oldItem);
        event = new ICAL.Component(item.item).getFirstSubcomponent("vevent");
      });

      test("action changed", () => {
        let valarm = event.getFirstSubcomponent("valarm");
        expect(valarm.getFirstPropertyValue("action")).toBe("EMAIL");
        valarm.updatePropertyWithValue("action", "x-changed");
        changes = patchItem(item, oldItem);

        // x-changed is invalid, so it will default to "popup"
        expect(changes).toEqual({
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: 20 }],
          },
        });
      });

      test("override added", () => {
        let valarm = new ICAL.Component("valarm");
        valarm.updatePropertyWithValue("action", "EMAIL");
        valarm.updatePropertyWithValue("description", "alarm");
        valarm.updatePropertyWithValue("trigger", ICAL.Duration.fromSeconds(-120));
        event.addSubcomponent(valarm);
        changes = patchItem(item, oldItem);

        expect(changes).toEqual({
          reminders: {
            useDefault: false,
            overrides: expect.arrayContaining([
              { method: "email", minutes: 20 },
              { method: "email", minutes: 2 },
            ]),
          },
        });
      });
      test("override removed", () => {
        event.removeSubcomponent("valarm");
        changes = patchItem(item, oldItem);

        expect(changes).toEqual({
          reminders: {
            useDefault: false,
            overrides: [],
          },
        });
      });

      test("exceed property limit length", () => {
        oldItem = copy(jcalItems.recur_rrule);
        item = copy(oldItem);
        event = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

        event.addPropertyWithValue("x-moz-lastack", "20250715T000000Z"); // 20250614T000000

        // Instance on 20250614T000000 snoozed after the lastack. This one should be included
        event.addPropertyWithValue("x-moz-snooze-time-174985200000000", "20250716T000000Z");

        // Instance on 20250629T000000 snoozed before the lastack. This one should not be included.
        event.addPropertyWithValue("x-moz-snooze-time-175114800000000", "20250701T000000Z");

        changes = patchItem(item, oldItem);

        expect(changes).toEqual({
          extendedProperties: {
            "private": {
              "X-GOOGLE-SNOOZE-RECUR": JSON.stringify({
                "174985200000000": "20250716T000000Z"
              }),
              "X-MOZ-LASTACK": "2025-07-15T00:00:00Z"
            }
          }
        });
      });

      test("invalid lastack", () => {
        oldItem = copy(jcalItems.recur_rrule);
        item = copy(oldItem);
        event = new ICAL.Component(item.item).getFirstSubcomponent("vevent");

        event.addPropertyWithValue("x-moz-lastack", "bananaphone");
        event.addPropertyWithValue("x-moz-snooze-time-174985200000000", "dup dup dup dup dup");

        changes = patchItem(item, oldItem);

        expect(changes).toEqual({
          extendedProperties: {
            "private": {
              "X-MOZ-LASTACK": null
            }
          }
        });
      });
    });

    describe("recurrence", () => {
      beforeEach(() => {
        oldItem = copy(jcalItems.recur_rrule);
        item = copy(jcalItems.recur_rrule);
        event = new ICAL.Component(item.item).getFirstSubcomponent("vevent");
      });

      test("recurring snooze", () => {
        event.updatePropertyWithValue(
          "x-moz-snooze-time-20060610T190000",
          ICAL.Time.fromString("2021-01-01T01:01:01")
        );
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({
          extendedProperties: {
            private: { "X-GOOGLE-SNOOZE-RECUR": '{"20060610T190000":"20210101T010101"}' },
          },
        });
      });

      test.each(["exdate", "rdate"])("%s utc", prop => {
        event.removeAllProperties(prop);
        let rprop = new ICAL.Property(prop);
        rprop.setValue(ICAL.Time.fromString("2007-06-09T12:23:34"));
        rprop.setParameter("tzid", "Europe/Berlin");
        event.addProperty(rprop);

        changes = patchItem(item, oldItem);
        expect(changes.recurrence).toEqual(
          expect.arrayContaining([prop.toUpperCase() + ":20070609T102334Z"])
        );
      });
    });
  });

  describe("patchTask", () => {
    let item, task, changes;
    let oldItem = jcalItems.simple_task;

    beforeEach(() => {
      item = copy(oldItem);
      task = new ICAL.Component(item.item).getFirstSubcomponent("vtodo");
    });

    test.each([
      ["summary", "title", "changed", "changed"],
      ["description", "notes", "changed", "changed"],
      ["due", "due", "2008-01-01", "2008-01-01"],
      ["completed", "completed", "2008-01-01", "2008-01-01"],
      ["status", "status", "COMPLETED", "completed"],
    ])("prop %s", (jprop, prop, jchanged, changed) => {
      task.updatePropertyWithValue(jprop, jchanged);
      changes = patchItem(item, oldItem);
      expect(changes).toEqual({ [prop]: changed });
    });
  });

  test("invalid", () => {
    expect(() => {
      patchItem({ type: "wat" }, { typ: "wat" });
    }).toThrow("Unknown item type: wat");
  });
});

describe("ItemSaver", () => {
  let saver;
  let prefs;
  let calendar = {
    console,
    id: "calendarId",
    cacheId: "calendarId#cache",
    setCalendarPref: jest.fn(),
    getCalendarPref: jest.fn()
  };

  beforeEach(() => {
    prefs = {};
    saver = new ItemSaver(calendar);

    calendar.setCalendarPref = jest.fn(async (name, value) => {
      prefs[name] = value;
    });
    calendar.getCalendarPref = jest.fn(async (name, defaultValue) => {
      return prefs[name] || defaultValue;
    });
  });
  afterEach(() => {
    // eslint-disable-next-line jest/no-standalone-expect
    expect(saver.missingParents.length).toBe(0);
  });

  test("Invalid items", async () => {
    await expect(() => {
      return saver.parseItemStream({
        kind: "wat#tf",
      });
    }).rejects.toThrow("Invalid stream type: wat#tf");

    await expect(() => {
      return saver.parseItemStream({
        status: "fail",
      });
    }).rejects.toThrow("Invalid stream type: fail");
  });

  test("No timezone", async () => {
    await saver.parseItemStream({
      kind: "calendar#events",
    });

    expect(calendar.setCalendarPref).not.toHaveBeenCalled();
  });

  describe("parseEventStream", () => {
    test("No items", async () => {
      await saver.parseEventStream({
        items: [],
      });

      expect(console.log).toHaveBeenCalledWith("No events have been changed");
    });

    test("Single item (valarm_no_default_override)", async () => {
      await saver.parseEventStream({
        items: [gcalItems.valarm_no_default_override],
      });
      await saver.complete();
      expect(console.log).toHaveBeenCalledWith("Parsing 1 received events");

      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "swpefnfloqssxjdlbpyqlyqddb@google.com",
          format: "jcal",
          item: ["vcalendar", expect.anything(), expect.anything()],
        })
      );
    });

    test("Master item removed", async () => {
      let gitem = copy(gcalItems.valarm_no_default_override);
      gitem.status = "cancelled";

      await saver.parseEventStream({
        items: [gitem],
      });
      await saver.complete();
      expect(console.log).toHaveBeenCalledWith("Parsing 1 received events");

      expect(messenger.calendar.items.create).not.toHaveBeenCalled();
      expect(messenger.calendar.items.remove).toHaveBeenCalledWith(
        "calendarId#cache",
        "swpefnfloqssxjdlbpyqlyqddb@google.com"
      );
    });

    test("Parent item on separate page", async () => {
      await saver.parseEventStream({
        items: [gcalItems.recur_instance],
      });
      expect(saver.missingParents.length).toBe(1);

      await saver.parseEventStream({
        items: [gcalItems.recur_rrule],
      });

      await saver.complete();

      // Don't retrieve from cache, it should be in the stream
      expect(messenger.calendar.items.get).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledTimes(1);
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
        })
      );

      let parentItem = await messenger.calendar.items.get("calendarId#cache", "osndfnwejrgnejnsdjfwegjdfr@google.com");
      expect(parentItem).not.toBeNull();

      let vcalendar = new ICAL.Component(parentItem.item);
      let vevent = vcalendar.getFirstSubcomponent("vevent");

      expect(vevent.getFirstProperty("x-moz-faked-master")).toBeNull();
    });

    test("Parent item from database", async () => {
      let item = copy(jcalItems.recur_rrule);
      await messenger.calendar.items.create("calendarId#cache", item);
      messenger.calendar.items.create.mockClear();

      await saver.parseEventStream({
        items: [gcalItems.recur_instance],
      });
      expect(saver.missingParents.length).toBe(1);

      await saver.complete();

      expect(messenger.calendar.items.get).toHaveBeenCalledWith(
        "calendarId#cache",
        "osndfnwejrgnejnsdjfwegjdfr@google.com",
        { returnFormat: "jcal" }
      );

      expect(messenger.calendar.items.create).toHaveBeenCalledTimes(1);
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
        })
      );

      let parentItem = await messenger.calendar.items.get("calendarId#cache", "osndfnwejrgnejnsdjfwegjdfr@google.com");
      expect(parentItem).not.toBeNull();

      let vcalendar = new ICAL.Component(parentItem.item);
      let vevents = vcalendar.getAllSubcomponents("vevent");

      expect(vevents.length).toBe(2);
      expect(vevents[0].getFirstProperty("x-moz-faked-master")).toBeNull();
      expect(vevents[0].getFirstProperty("recurrence-id")).toBeNull();
      expect(vevents[1].getFirstProperty("recurrence-id").jCal).toEqual(["recurrence-id", {}, "date", "2006-06-25"]);
    });

    test("recurring event", async () => {
      await saver.parseEventStream({
        items: [gcalItems.recur_rrule, gcalItems.recur_instance],
      });
      await saver.complete();
      expect(console.log).toHaveBeenCalledWith("Parsing 2 received events");
      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledTimes(1);
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
          format: "jcal",
          item: ["vcalendar", expect.anything(), [
            ["vevent",
              expect.arrayContaining([
                ["uid", {}, "text", "osndfnwejrgnejnsdjfwegjdfr@google.com"],
                ["rrule", {}, "recur", expect.anything()]
              ]), expect.anything()
            ],
            ["vevent",
              expect.arrayContaining([
                ["uid", {}, "text", "osndfnwejrgnejnsdjfwegjdfr@google.com"],
                ["recurrence-id", {}, "date", expect.anything()]
              ]), expect.anything()
            ]
          ]]
        })
      );
    });

    test("recurring event master cancelled", async () => {
      let gitem = copy(gcalItems.recur_rrule);
      gitem.status = "cancelled";

      await saver.parseEventStream({
        items: [gitem, gcalItems.recur_instance],
      });
      await saver.complete();
      expect(console.log).toHaveBeenCalledWith("Parsing 2 received events");
      expect(messenger.calendar.items.remove).toHaveBeenCalledWith(
        "calendarId#cache",
        "osndfnwejrgnejnsdjfwegjdfr@google.com"
      );
      expect(messenger.calendar.items.remove).toHaveBeenCalledTimes(1);
      expect(messenger.calendar.items.create).not.toHaveBeenCalled();
    });

    test("recurring event missing parent", async () => {
      await saver.parseEventStream({
        items: [gcalItems.recur_instance],
      });
      expect(console.log).toHaveBeenCalledWith("Parsing 1 received events");

      await saver.complete();

      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
          format: "jcal",
          item: ["vcalendar", expect.anything(), expect.anything()],
        })
      );

      let vcalendar = new ICAL.Component(
        messenger.calendar.items.create.mock.calls[0][1].item
      );
      let vevent = vcalendar.getFirstSubcomponent("vevent");

      expect(vevent.getFirstProperty("recurrence-id")).toBe(null);
      expect(vevent.getFirstPropertyValue("dtstart")?.toICALString()).toBe("20060625");
      expect(vevent.getFirstPropertyValue("rdate")?.toICALString()).toBe("20060625");
      expect(vevent.getFirstPropertyValue("x-moz-faked-master")).toBe("1");
    });

    test("recurring event missing parent with timezone recid", async () => {
      let gitem = copy(gcalItems.recur_instance);
      gitem.start = { dateTime: "2006-06-25T01:02:03", timeZone: "Europe/Berlin" };
      gitem.end = { dateTime: "2006-06-25T02:03:04", timeZone: "Europe/Berlin" };
      gitem.originalStartTime = { dateTime: "2006-06-25T05:06:07", timeZone: "Europe/Berlin" };

      await saver.parseEventStream({
        items: [gitem],
        timeZone: "America/Los_Angeles"
      });
      await saver.complete();

      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
          format: "jcal",
          item: ["vcalendar", expect.anything(), expect.anything()],
        })
      );

      let vcalendar = new ICAL.Component(
        messenger.calendar.items.create.mock.calls[0][1].item
      );
      let vevent = vcalendar.getFirstSubcomponent("vevent");

      expect(vevent.getFirstProperty("recurrence-id")).toBe(null);
      expect(vevent.getFirstProperty("dtstart")?.getParameter("tzid")).toBe("Europe/Berlin");
      expect(vevent.getFirstProperty("rdate")?.getParameter("tzid")).toBe("Europe/Berlin");
      expect(vevent.getFirstPropertyValue("dtstart")?.toICALString()).toBe("20060625T140607");
      expect(vevent.getFirstPropertyValue("rdate")?.toICALString()).toBe("20060625T140607");
      expect(vevent.getFirstPropertyValue("x-moz-faked-master")).toBe("1");
    });

    test("recurring event missing parent cancelled", async () => {
      let gitem = copy(gcalItems.recur_instance);
      gitem.status = "cancelled";

      await saver.parseEventStream({
        items: [gitem],
      });
      expect(console.log).toHaveBeenCalledWith("Parsing 1 received events");
      await saver.complete();

      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).not.toHaveBeenCalled();
    });
    test("recurring event missing parent found in storage", async () => {
      let jitem = copy(jcalItems.recur_rrule);
      await messenger.calendar.items._create("calendarId#cache", jitem);

      let gitem = copy(gcalItems.recur_instance);
      gitem.status = "cancelled";

      await saver.parseEventStream({
        items: [gitem],
      });
      expect(console.log).toHaveBeenCalledWith("Parsing 1 received events");
      expect(messenger.calendar.items.create).not.toHaveBeenCalled();

      await saver.complete();

      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.get).toHaveBeenCalledWith(
        "calendarId#cache",
        "osndfnwejrgnejnsdjfwegjdfr@google.com",
        { returnFormat: "jcal" }
      );
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
          format: "jcal",
          item: ["vcalendar", expect.anything(), expect.anything()],
        })
      );

      let vcalendar = new ICAL.Component(
        messenger.calendar.items.create.mock.calls[0][1].item
      );
      let vevent = vcalendar.getFirstSubcomponent("vevent");
      expect(
        vevent.getAllProperties("exdate")?.map(prop => prop.getFirstValue()?.toICALString())
      ).toEqual(expect.arrayContaining(["20060625", "20070609"]));
    });

    const ORANGE_PIXEL_CACHE = [
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8,
      6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 91, 99, 248, 191, 148,
      225, 63, 0, 6, 239, 2, 164, 151, 4, 63, 111, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96,
      130
    ];
    const ORANGE_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4v5ThPwAG7wKklwQ/bwAAAABJRU5ErkJggg==";

    const BLUE_PIXEL_CACHE = [
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8,
      6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 91, 99, 96, 96, 248, 255,
      31, 0, 3, 2, 1, 255, 120, 191, 70, 181, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ];
    const BLUE_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==";

    test("Conference providers", async () => {
      let solutions = {
        "hangoutsMeet": {
          "iconCache": ORANGE_PIXEL_CACHE,
          "iconUri": ORANGE_PIXEL,
          "key": { "type": "hangoutsMeet" },
          "name": "Hangouts"
        }
      };

      await calendar.setCalendarPref("conferenceSolutions", solutions);

      let item1 = copy(gcalItems.valarm_no_default_override);
      let item2 = copy(gcalItems.valarm_no_default_override);

      item2.conferenceData.conferenceSolution.key.type = "zoom";
      item2.conferenceData.conferenceSolution.name = "Zoom";
      item2.conferenceData.conferenceSolution.iconUri = BLUE_PIXEL;

      const fetchSpy = jest.spyOn(global, "fetch");

      await saver.parseEventStream({
        items: [item1, item2]
      });
      await saver.complete();

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      solutions = await calendar.getCalendarPref("conferenceSolutions", {});

      expect(solutions).toEqual({
        "hangoutsMeet": {
          "iconCache": ORANGE_PIXEL_CACHE,
          "iconUri": ORANGE_PIXEL,
          "key": { "type": "hangoutsMeet" },
          "name": "Hangouts"
        },
        "zoom": {
          "iconCache": BLUE_PIXEL_CACHE,
          "iconUri": BLUE_PIXEL,
          "key": { "type": "zoom" },
          "name": "Zoom",
        }
      });
    });
  });

  describe("parseTaskStream", () => {
    test("task", async () => {
      await saver.parseTaskStream({
        items: [gcalItems.simple_task],
      });

      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "lqohjsbhqoztdkusnpruvooacn",
          format: "jcal",
          item: ["vcalendar", expect.anything(), expect.anything()],
        })
      );
    });
  });
});
