import gcalItems from "./fixtures/gcalItems.json";
import jcalItems from "./fixtures/jcalItems.json";

import { jsonToItem, itemToJson, patchItem, ItemSaver } from "../../src/background/items";
import calGoogleCalendar from "../../src/background/calendar";
import ICAL from "ical.js";
import v8 from "v8";
import createMessenger from "./webext-api";

import { jest } from "@jest/globals";

beforeEach(() => {
  global.messenger = createMessenger();
  jest.spyOn(global.console, "log").mockImplementation(() => {});

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

describe("jsonToItem", () => {
  let calendar = { console, name: "calendarName" };

  describe("events", () => {
    test("simple event", async () => {
      let defaultReminders = [{ method: "popup", minutes: 120 }];

      let item = await jsonToItem(gcalItems.simple_event, calendar, defaultReminders, null);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(item.metadata.etag).toBe('"2299601498276000"');
      expect(item.metadata.path).toBe("go6ijb0b46hlpbu4eeu92njevo");

      expect(jcal.getFirstPropertyValue("uid")).toBe("go6ijb0b46hlpbu4eeu92njevo@google.com");
      expect(jcal.getFirstPropertyValue("status")).toBe("CONFIRMED");
      expect(jcal.getFirstPropertyValue("url")).toBe(
        "https://example.com/calendar/event?eid=eventhash"
      );
      expect(jcal.getFirstPropertyValue("created").toICALString()).toBe("20060608T210452"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("last-modified").toICALString()).toBe("20060608T210549"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("dtstamp").toICALString()).toBe("20060608T210549"); // TODO this is floating, ical.js bug?
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
      expect(alarms.length).toBe(3);
      expect(alarms[0].getFirstPropertyValue("action")).toBe("EMAIL");
      expect(alarms[0].getFirstPropertyValue("trigger").toICALString()).toBe("-PT20M");
      expect(alarms[0].getFirstPropertyValue("x-default-alarm")).toBe(null);
      expect(alarms[1].getFirstPropertyValue("action")).toBe("DISPLAY");
      expect(alarms[1].getFirstPropertyValue("trigger").toICALString()).toBe("-PT5M");
      expect(alarms[1].getFirstPropertyValue("x-default-alarm")).toBe(null);
      expect(alarms[2].getFirstPropertyValue("action")).toBe("DISPLAY");
      expect(alarms[2].getFirstPropertyValue("trigger").toICALString()).toBe("-PT10M");
      expect(alarms[2].getFirstPropertyValue("x-default-alarm")).toBe(null);

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

      expect(jcal.getFirstProperty("categories").getValues()).toEqual(["foo", "bar"]);
      expect(jcal.getFirstPropertyValue("x-moz-lastack").toICALString()).toBe("20140101T010101Z");
      expect(jcal.getFirstPropertyValue("x-moz-snooze-time").toICALString()).toBe(
        "20140101T020202Z"
      );

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
        "categories",
        "x-moz-lastack",
        "x-moz-snooze-time",
        "x-default-alarm",
      ].forEach(prop => {
        jcal.removeAllProperties(prop);
      });
      let remaining = jcal.getAllProperties().map(prop => prop.name);
      if (remaining.length) {
        console.warn("Remaining props:", remaining);
      }
      expect(remaining.length).toBe(0);
    });

    test("valarm_default event", async () => {
      await messenger.storage.local.set({ "settings.accessRole": "freeBusyReader" });
      let item = await jsonToItem(gcalItems.valarm_default, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);
      await messenger.storage.local.set({ "settings.accessRole": null });

      expect(jcal.getFirstPropertyValue("uid")).toBe("swpefnfloqssxjdlbpyqlyqddb@google.com");
      expect(jcal.getFirstPropertyValue("summary")).toBe("busyTitle[calendarName]");
      expect(jcal.getFirstProperty("dtend")).toBe(null); // endTimeUnspecified
      expect(jcal.getFirstPropertyValue("organizer")).toBe(
        "urn:id:b4d9b3a9-b537-47bd-92a1-fb40c0c1c7fc"
      );
      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060610");
    });
    test("utc_event event", async () => {
      let item = await jsonToItem(gcalItems.utc_event, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(jcal.getFirstPropertyValue("uid")).toBe("uasfsingergnenedfwiefefgjk@google.com");
      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060610T010203Z");
    });
    test("recur rule", async () => {
      let item = await jsonToItem(gcalItems.recur_rrule, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);

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
      let item = await jsonToItem(gcalItems.recur_instance, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(jcal.getFirstPropertyValue("dtstart").toICALString()).toBe("20060626");
      expect(jcal.getFirstPropertyValue("recurrence-id").toICALString()).toBe("20060625");
    });

    test("html description", async () => {
      let item = await jsonToItem(gcalItems.html_descr, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);

      let descr = jcal.getFirstProperty("description");
      expect(descr.getParameter("altrep")).toBe("data:text/html,%3Cb%3EBold%3C%2Fb%3E");
      expect(descr.getFirstValue()).toBe("Bold");
    });
  });

  describe("tasks", () => {
    test("simple task", async () => {
      let item = await jsonToItem(gcalItems.simple_task, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(jcal.getFirstPropertyValue("uid")).toBe("lqohjsbhqoztdkusnpruvooacn");
      expect(jcal.getFirstPropertyValue("last-modified")?.toICALString()).toBe("20060608T210549");
      expect(jcal.getFirstPropertyValue("dtstamp")?.toICALString()).toBe("20060608T210549");
      expect(jcal.getFirstPropertyValue("description")).toBe("description");
      expect(jcal.getFirstPropertyValue("url")).toBe(
        "https://example.com/calendar/task?eid=taskhash"
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
      let item = await jsonToItem(gcalItems.deleted_task, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(jcal.getFirstPropertyValue("uid")).toBe("jidlfaenrgjklebrgjebuwdfer");
      expect(jcal.getFirstPropertyValue("status")).toBe("CANCELLED");
    });

    test("needsAction task", async () => {
      let item = await jsonToItem(gcalItems.needs_action, calendar, [], null);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(jcal.getFirstPropertyValue("uid")).toBe("jidlfaenrgjklebrgjebuwdfer");
      expect(jcal.getFirstPropertyValue("status")).toBe("NEEDS-ACTION");
    });
  });
});

test("invalid item type", () => {
  let consoleError = jest.fn(msg => {});

  let calendar = { console: { error: consoleError } };
  expect(jsonToItem({ kind: "invalid" }, calendar)).toBe(null);
  expect(consoleError.mock.calls.length).toBe(1);
});

describe("itemToJson", () => {
  let calendar = { console, name: "calendarName" };

  test("event 0", async () => {
    let data = itemToJson(jcalItems.simple_event, calendar, false);

    // TODO originalStartTime
    // TODO date value

    expect(data).toEqual({
      extendedProperties: {
        private: { "X-MOZ-LASTACK": "20140101T010101Z", "X-MOZ-SNOOZE-TIME": "20140101T020202Z" },
        shared: { "X-MOZ-CATEGORIES": "foo,bar" },
      },
      icalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
      summary: "New Event",
      description: "Description",
      location: "Hard Drive",
      start: { dateTime: "2006-06-10T18:00:00", timeZone: "Europe/Berlin" },
      end: { dateTime: "2006-06-10T20:00:00", timeZone: "Europe/Berlin" },
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
        private: { "X-MOZ-LASTACK": "20140101T010101Z", "X-MOZ-SNOOZE-TIME": "20140101T020202Z" },
        shared: { "X-MOZ-CATEGORIES": "foo,bar" },
      },
      icalUID: "swpefnfloqssxjdlbpyqlyqddb@google.com",
      summary: "busyTitle[calendarName]",
      description: "Description",
      location: "Hard Drive",
      start: { date: "2006-06-10" },
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

  test("event 2", async () => {
    let data = itemToJson(jcalItems.valarm_default, calendar, false);
    expect(data).toEqual({
      icalUID: "xkoaavctdghzjszjssqttcbhkv@google.com",
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
    let data = itemToJson(jcalItems.recur_rrule, calendar, false);
    expect(data).toEqual({
      icalUID: "osndfnwejrgnejnsdjfwegjdfr@google.com",
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
      icalUID: "osndfnwejrgnejnsdjfwegjdfr@google.com",
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
        { type: "event", formats: { jcal: ["x-wrong", [], [["x-notit", [], []]]] } },
        calendar,
        false
      );
    }).toThrow("Missing vevent in toplevel component x-wrong");
    expect(() => {
      itemToJson(
        {
          type: "event",
          formats: {
            jcal: ["vcalendar", [], [["vevent", [["status", {}, "text", "CANCELLED"]], []]]],
          },
        },
        calendar,
        false
      );
    }).toThrow("NS_ERROR_LOSS_OF_SIGNIFICANT_DATA");
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
    let item, oldItem, event, changes;

    describe("simple event", () => {
      beforeEach(() => {
        oldItem = jcalItems.simple_event;
        item = v8.deserialize(v8.serialize(oldItem));
        event = new ICAL.Component(item.formats.jcal).getFirstSubcomponent("vevent");
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
          "2006-06-10T19:00:00",
          { private: { "X-MOZ-LASTACK": "20060610T190000" } },
        ],
        [
          "x-moz-snooze-time",
          "extendedProperties",
          "2006-06-10T19:00:00",
          { private: { "X-MOZ-SNOOZE-TIME": "20060610T190000" } },
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
        if (jprop.startsWith("x-moz-snooze-time-")) {
          console.warn(event.jCal);
        }
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
        expect(changes).toEqual({ [prop]: changed, reminders: expect.anything() });
      });

      test("dtend unspecified", () => {
        event.removeProperty("dtend");
        changes = patchItem(item, oldItem);
        expect(changes).toEqual({ endTimeUnspecified: true, reminders: expect.anything() });
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
    });

    describe("reminders", () => {
      // Using a different event here, otherwise we hit the 5 alarms limit
      beforeEach(() => {
        oldItem = jcalItems.valarm_override;
        item = v8.deserialize(v8.serialize(oldItem));
        event = new ICAL.Component(item.formats.jcal).getFirstSubcomponent("vevent");
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
    });

    describe("recurrence", () => {
      beforeEach(() => {
        oldItem = jcalItems.recur_rrule;
        item = v8.deserialize(v8.serialize(oldItem));
        event = new ICAL.Component(item.formats.jcal).getFirstSubcomponent("vevent");
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
          expect.arrayContaining([prop.toUpperCase() + ":20070609T122334Z"])
        );
      });
    });
  });

  describe("patchTask", () => {
    let item, task, changes;
    let oldItem = jcalItems.simple_task;

    beforeEach(() => {
      item = v8.deserialize(v8.serialize(oldItem));
      task = new ICAL.Component(item.formats.jcal).getFirstSubcomponent("vtodo");
    });

    test.each([
      ["summary", "title", "changed"],
      ["description", "notes", "changed"],
      ["due", "due", "2008-01-01"],
      ["completed", "completed", "2008-01-01"],
      ["status", "status", "completed"],
    ])("prop %s", (jprop, prop, changed) => {
      task.updatePropertyWithValue(jprop, changed);
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
  let calendar = {
    console,
    id: "calendarId",
    cacheId: "calendarId#cache",
    setCalendarPref: jest.fn(),
  };

  beforeEach(() => {
    saver = new ItemSaver(calendar);
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

    test("Simple item", async () => {
      await saver.parseEventStream({
        items: [gcalItems.valarm_default],
      });
      expect(console.log).toHaveBeenCalledWith("Parsing 1 received events");

      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "swpefnfloqssxjdlbpyqlyqddb@google.com",
          formats: {
            use: "jcal",
            jcal: ["vcalendar", expect.anything(), expect.anything()],
          },
        })
      );
    });
    test("Master item removed", async () => {
      let gitem = v8.deserialize(v8.serialize(gcalItems.valarm_default));
      gitem.status = "cancelled";

      await saver.parseEventStream({
        items: [gitem],
      });
      expect(console.log).toHaveBeenCalledWith("Parsing 1 received events");

      expect(messenger.calendar.items.create).not.toHaveBeenCalled();
      expect(messenger.calendar.items.remove).toHaveBeenCalledWith(
        "calendarId#cache",
        "swpefnfloqssxjdlbpyqlyqddb@google.com"
      );
    });

    test("recurring event", async () => {
      await saver.parseEventStream({
        items: [gcalItems.recur_rrule, gcalItems.recur_instance],
      });
      expect(console.log).toHaveBeenCalledWith("Parsing 2 received events");
      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();
      expect(messenger.calendar.items.create).toHaveBeenCalledTimes(2);
      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
          formats: {
            use: "jcal",
            jcal: ["vcalendar", expect.anything(), expect.anything()],
          },
        })
      );
    });

    test("recurring event master cancelled", async () => {
      let gitem = v8.deserialize(v8.serialize(gcalItems.recur_rrule));
      gitem.status = "cancelled";

      await saver.parseEventStream({
        items: [gitem, gcalItems.recur_instance],
      });
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
      expect(messenger.calendar.items.remove).not.toHaveBeenCalled();

      await saver.complete();

      expect(messenger.calendar.items.create).toHaveBeenCalledWith(
        "calendarId#cache",
        expect.objectContaining({
          id: "osndfnwejrgnejnsdjfwegjdfr@google.com",
          formats: {
            use: "jcal",
            jcal: ["vcalendar", expect.anything(), expect.anything()],
          },
        })
      );

      let vcalendar = new ICAL.Component(
        messenger.calendar.items.create.mock.calls[0][1].formats.jcal
      );
      let vevent = vcalendar.getFirstSubcomponent("vevent");

      expect(vevent.getFirstProperty("recurrence-id")).toBe(null);
      expect(vevent.getFirstPropertyValue("dtstart")?.toICALString()).toBe("20060625");
      expect(vevent.getFirstPropertyValue("rdate")?.toICALString()).toBe("20060625");
      expect(vevent.getFirstPropertyValue("x-moz-faked-master")).toBe("1");
    });

    test("recurring event missing parent cancelled", async () => {
      let gitem = v8.deserialize(v8.serialize(gcalItems.recur_instance));
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
      let jitem = v8.deserialize(v8.serialize(jcalItems.recur_rrule));
      await messenger.calendar.items._create("calendarId#cache", jitem);

      let gitem = v8.deserialize(v8.serialize(gcalItems.recur_instance));
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
          formats: {
            use: "jcal",
            jcal: ["vcalendar", expect.anything(), expect.anything()],
          },
        })
      );

      let vcalendar = new ICAL.Component(
        messenger.calendar.items.create.mock.calls[0][1].formats.jcal
      );
      let vevent = vcalendar.getFirstSubcomponent("vevent");
      expect(
        vevent.getAllProperties("exdate")?.map(prop => prop.getFirstValue()?.toICALString())
      ).toEqual(expect.arrayContaining(["20060625", "20070609"]));
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
          formats: {
            use: "jcal",
            jcal: ["vcalendar", expect.anything(), expect.anything()],
          },
        })
      );
    });
  });
});
