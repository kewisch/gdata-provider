import jestFetchMock from "jest-fetch-mock";
jestFetchMock.enableFetchMocks();

import { jest } from "@jest/globals";

import createMessenger from "./webext-api";

import calGoogleCalendar from "../../src/background/calendar";
import sessions from "../../src/background/session";
import gcalItems from "./fixtures/gcalItems.json";
import jcalItems from "./fixtures/jcalItems.json";
import v8 from "v8";
import ICAL from "ical.js";

function authenticate(session) {
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
}

function mockCalendarRequest(req, props) {
  if (req.url.startsWith("https://www.googleapis.com/calendar/v3/calendars")) {
    return {
      headers: {
        Date: new Date(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        Object.assign(
          {
            kind: "calendar#events",
            etag: '"123123"',
            summary: "calendar1",
            description: "calendar1 descr",
            updated: new Date().toISOString(),
            timeZone: "Europe/Berlin",
            accessRole: "owner",
            defaultReminders: [{ method: "popup", minutes: 120 }],
            nextPageToken: null,
            nextSyncToken: "nextSyncToken",
            items: [],
          },
          props
        )
      ),
    };
  }
  return null;
}
function mockCalendarListRequest(req, props) {
  if (req.url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
    return {
      headers: {
        Date: new Date(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        Object.assign(
          {
            kind: "calendar#calendarListEntry",
            etag: '"123123"',
            id: "gid1",
            summary: "calendar1",
            summaryOverride: "calendar1override",
            description: "The calendar 1",
            location: "test",
            timeZone: "Europe/Berlin",
            colorId: 17,
            backgroundColor: "#000000",
            foregroundColor: "#FFFFFF",
            hidden: false,
            selected: false,
            accessRole: "owner",
            defaultReminders: [{ method: "popup", minutes: 120 }],
            notificationSettings: { notifications: [] },
            primary: true,
            deleted: false,
            conferenceProperties: { allowedConferenceSolutionTypes: [] },
          },
          props
        )
      ),
    };
  }
  return null;
}

function mockTaskRequest(req, props) {
  if (req.url.startsWith("https://www.googleapis.com/tasks/v1/lists/taskhash/tasks")) {
    return {
      headers: {
        Date: new Date(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        Object.assign(
          {
            kind: "tasks#tasks",
            etag: '"123123"',
            nextPageToken: null,
            items: [],
          },
          props
        )
      ),
    };
  }
  return null;
}

beforeEach(() => {
  jestFetchMock.doMock();
  global.messenger = createMessenger();
  global.messenger.calendar.calendars._calendars = [
    { id: "id0", type: "ics", url: "https://example.com/feed.ics" },
    {
      id: "id1",
      cacheId: "cached-id1",
      type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
      url: "googleapi://sessionId/?calendar=id1%40calendar.google.com&tasks=taskhash",
    },
    {
      id: "id2",
      cacheId: "cached-id2",
      type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
      url: "googleapi://sessionId/",
    },
    {
      id: "id3",
      cacheId: "cached-id3",
      type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
      url: "googleapi://sessionId@group.calendar.google.com/",
    },
    {
      id: "id4",
      cacheId: "cached-id4",
      type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
      url: "https://www.google.com/calendar/ical/sessionId/private/full",
    },
    {
      id: "id5",
      cacheId: "cached-id5",
      type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
      url: "https://www.google.com/calendar/feeds/user%40example.com/public/full",
    },
    {
      id: "id6",
      cacheId: "cached-id6",
      type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
      url: "wat://",
    },
  ];

  jest.spyOn(global.console, "log").mockImplementation(() => {});
  jest.spyOn(global.console, "error").mockImplementation(() => {});
});

test("static init", async () => {
  let gcal = await calGoogleCalendar.get("id1");

  expect(gcal.id).toBe("id1");
  expect(gcal.cacheId).toBe("cached-id1");

  let gcal2 = await calGoogleCalendar.get("id1");
  expect(gcal2).toBe(gcal);

  await expect(calGoogleCalendar.get("id0")).rejects.toThrow(/invalid calendar type/);
});

test("initListeners", async () => {
  function prepareMock(method, ...args) {}

  let rawId1 = await messenger.calendar.calendars.get("id1");
  let calendar = await calGoogleCalendar.get("id1");

  jest.spyOn(calendar, "onItemCreated").mockImplementation(() => {});
  jest.spyOn(calendar, "onItemUpdated").mockImplementation(() => {});
  jest.spyOn(calendar, "onItemRemoved").mockImplementation(() => {});
  jest.spyOn(calendar, "onInit").mockImplementation(() => {});
  jest.spyOn(calendar, "onSync").mockImplementation(() => {});
  jest.spyOn(calendar, "onResetSync").mockImplementation(() => {});
  jest.spyOn(calGoogleCalendar, "onDetectCalendars").mockImplementation(() => {});

  calGoogleCalendar.initListeners();

  expect(messenger.calendar.provider.onItemCreated.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onItemUpdated.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onItemRemoved.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onInit.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onSync.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onResetSync.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onDetectCalendars.addListener).toHaveBeenCalled();

  await messenger.calendar.provider.onItemCreated.mockResponse(rawId1, { id: "item" });
  expect(calendar.onItemCreated).toHaveBeenCalledWith({ id: "item" });

  await messenger.calendar.provider.onItemUpdated.mockResponse(
    rawId1,
    { id: "item", title: "new" },
    { id: "item", title: "old" }
  );
  expect(calendar.onItemUpdated).toHaveBeenCalledWith(
    { id: "item", title: "new" },
    { id: "item", title: "old" }
  );

  await messenger.calendar.provider.onItemRemoved.mockResponse(rawId1, { id: "item" });
  expect(calendar.onItemRemoved).toHaveBeenCalledWith({ id: "item" });

  await messenger.calendar.provider.onInit.mockResponse(rawId1);
  expect(calendar.onInit).toHaveBeenCalledWith();

  await messenger.calendar.provider.onSync.mockResponse(rawId1);
  expect(calendar.onSync).toHaveBeenCalledWith();

  await messenger.calendar.provider.onResetSync.mockResponse(rawId1);
  expect(calendar.onResetSync).toHaveBeenCalledWith();

  await messenger.calendar.provider.onDetectCalendars.mockResponse("user", "pass", "loc", true, {});
  expect(calGoogleCalendar.onDetectCalendars).toHaveBeenCalledWith("user", "pass", "loc", true, {});
});

test("onInit", async () => {
  let calendar = await calGoogleCalendar.get("id1");
  await calendar.onInit();

  expect(global.messenger.calendar.calendars.update).toHaveBeenLastCalledWith("id1", {
    capabilities: {
      organizer: "id1@calendar.google.com",
    },
  });

  expect(calendar.calendarName).toBe("id1@calendar.google.com");
  expect(calendar.tasklistName).toBe("taskhash");

  calendar = await calGoogleCalendar.get("id2");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("sessionId");
  expect(calendar.tasklistName).toBe("@default");

  calendar = await calGoogleCalendar.get("id3");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("sessionId@group.calendar.google.com");
  expect(calendar.tasklistName).toBeFalsy();

  calendar = await calGoogleCalendar.get("id4");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("sessionId");
  expect(calendar.tasklistName).toBeFalsy();

  await messenger.storage.local.set({ "googleUser.user@example.com": "user@example.com" });
  calendar = await calGoogleCalendar.get("id5");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("user@example.com");
  expect(calendar.tasklistName).toEqual("@default");

  calendar = await calGoogleCalendar.get("id6");
  await calendar.onInit();
  expect(calendar.calendarName).toBeFalsy();
  expect(calendar.tasklistName).toBeFalsy();
});

test("create uris", async () => {
  let calendar = await calGoogleCalendar.get("id6");
  expect(calendar.createEventsURI("part1")).toBe(null);
  expect(calendar.createTasksURI("part1")).toBe(null);

  calendar = await calGoogleCalendar.get("id1");
  expect(calendar.createEventsURI("part1", "part2")).toBe(
    "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/part1/part2"
  );
  expect(calendar.createTasksURI("part1", "part2")).toBe(
    "https://www.googleapis.com/tasks/v1/lists/taskhash/part1/part2"
  );

  expect(calendar.createUsersURI("part=1", "part2")).toBe(
    "https://www.googleapis.com/calendar/v3/users/me/part%3D1/part2"
  );
});

test("calendar prefs", async () => {
  let calendar = await calGoogleCalendar.get("id1");

  let pref = await calendar.getCalendarPref("foo", "default");
  expect(pref).toBe("default");
  pref = await calendar.getCalendarPref("foo");
  expect(pref).toBe(null);

  await calendar.setCalendarPref("foo", "bar");
  expect(await messenger.storage.local.get({ "calendars.id1.foo": null })).toEqual({
    "calendars.id1.foo": "bar",
  });
  expect(await calendar.getCalendarPref("foo", "default")).toBe("bar");
});

test("updated min", async () => {
  let calendar = await calGoogleCalendar.get("id1");

  expect(await calendar.getUpdatedMin()).toBeFalsy();

  let newUpdate = new Date();
  await calendar.setCalendarPref("tasksLastUpdated", newUpdate.toISOString());
  expect(await calendar.getUpdatedMin()).toEqual(newUpdate);

  newUpdate = new Date(new Date() - 86400 * 8 * 1000);
  await calendar.setCalendarPref("tasksLastUpdated", newUpdate.toISOString());
  expect(await calendar.getUpdatedMin()).toBe(null);
  expect(messenger.calendar.calendars.clear).toHaveBeenCalledWith("cached-id1");
});

describe("item functions", () => {
  let calendar;

  beforeEach(async () => {
    calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();
    authenticate(calendar.session);
  });
  describe("events", () => {
    test.each([false, true])("onItemCreated success sendUpdates=%s", async sendUpdates => {
      await messenger.storage.local.set({ "settings.sendEventNotifications": sendUpdates });

      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events"
          )
        ) {
          // remove alarms in response
          let gcalItemResponse = v8.deserialize(v8.serialize(gcalItems.simple_event));
          delete gcalItemResponse.reminders.overrides;

          return {
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(gcalItemResponse),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let newItem = v8.deserialize(v8.serialize(jcalItems.simple_event));
      let expected = v8.deserialize(v8.serialize(jcalItems.simple_event));

      // remove alarms
      new ICAL.Component(newItem.formats.jcal)
        .getFirstSubcomponent("vevent")
        .removeAllSubcomponents("valarm");
      new ICAL.Component(expected.formats.jcal)
        .getFirstSubcomponent("vevent")
        .removeAllSubcomponents("valarm");

      // vcalendar -> vevent
      expected.formats.jcal = expected.formats.jcal[2][0];

      let item = await calendar.onItemCreated(newItem);

      expect(item).toEqual(expected);
      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events" +
            (sendUpdates ? "?sendUpdates=all" : "")
        ),
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(messenger.calendar.calendars.update).toHaveBeenLastCalledWith("id1", {
        capabilities: {
          organizerName: "Eggs P. Seashell",
        },
      });
    });

    test.each([false, true])("onItemUpdated success sendUpdates=%s", async sendUpdates => {
      await messenger.storage.local.set({ "settings.sendEventNotifications": sendUpdates });

      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo"
          )
        ) {
          return {
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(gcalItems.simple_event),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let oldItem = v8.deserialize(v8.serialize(jcalItems.simple_event));
      let newItem = v8.deserialize(v8.serialize(jcalItems.simple_event));

      if (!sendUpdates) {
        // Using this condition also to check the branch without an etag
        delete oldItem.metadata.etag;
      }

      let vevent = new ICAL.Component(newItem.formats.jcal);
      vevent
        .getFirstSubcomponent("vevent")
        .getFirstProperty("summary")
        .setValue("changed");

      let result = await calendar.onItemUpdated(newItem, oldItem);

      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo" +
            (sendUpdates ? "?sendUpdates=all" : "")
        ),
        expect.objectContaining({
          method: "PATCH",
          body: '{"summary":"changed"}',
          headers: expect.objectContaining({
            "If-Match": sendUpdates ? '"2299601498276000"' : "*",
          }),
        })
      );
    });

    test.each([false, true])("onItemRemoved success sendUpdates=%s", async sendUpdates => {
      await messenger.storage.local.set({ "settings.sendEventNotifications": sendUpdates });

      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo"
          )
        ) {
          return {
            status: 204,
            headers: {
              "Content-Length": 0,
            },
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let removedItem = v8.deserialize(v8.serialize(jcalItems.simple_event));

      if (!sendUpdates) {
        // Using this also to check the branch without an etag
        delete removedItem.metadata.etag;
      }

      let item = await calendar.onItemRemoved(removedItem);

      // vcalendar -> vevent
      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo" +
            (sendUpdates ? "?sendUpdates=all" : "")
        ),
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "If-Match": sendUpdates ? '"2299601498276000"' : "*",
          }),
        })
      );
    });
  });

  describe("tasks", () => {
    test("onItemCreated", async () => {
      fetch.mockResponse(req => {
        if (req.url.startsWith("https://www.googleapis.com/tasks/v1/lists/taskhash/tasks")) {
          return {
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(gcalItems.simple_task),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      expect(jcalItems.simple_task.id).toBe("lqohjsbhqoztdkusnpruvooacn");

      let item = await calendar.onItemCreated(jcalItems.simple_task);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(jcal.name).toBe("vtodo");
      expect(item.metadata.etag).toBe('"2128312983238480"');
      expect(item.metadata.path).toBe("lqohjsbhqoztdkusnpruvooacn");
      expect(item.title).toBe("New Task");
      expect(jcal.getFirstPropertyValue("summary")).toBe("New Task");
      expect(jcal.getFirstPropertyValue("last-modified").toICALString()).toBe("20060608T210549"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("dtstamp").toICALString()).toBe("20060608T210549"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("url")).toBe(
        "https://example.com/calendar/task?eid=taskhash"
      );
      expect(jcal.getFirstPropertyValue("related-to")).toBe("parentId");
      expect(jcal.getFirstProperty("related-to").getParameter("reltype")).toBe("PARENT");
      expect(jcal.getFirstPropertyValue("x-google-sortkey")).toBe(12312);
      expect(jcal.getFirstPropertyValue("description")).toBe("description");
      expect(jcal.getFirstPropertyValue("status")).toBe("COMPLETED");
      expect(jcal.getFirstPropertyValue("due").toICALString()).toBe("20060610T180000"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("completed").toICALString()).toBe("20060611T180000"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("attach")).toBe("https://example.com/filename.pdf");
      expect(jcal.getFirstProperty("attach").getParameter("filename")).toBe("filename.pdf");
      expect(jcal.getFirstProperty("attach").getParameter("x-google-type")).toBe("href");
    });

    test("onItemUpdated", async () => {
      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
          )
        ) {
          return {
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(gcalItems.simple_event),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let oldItem = jcalItems.simple_task;
      let newItem = v8.deserialize(v8.serialize(jcalItems.simple_task));

      expect(oldItem.id).toBe("lqohjsbhqoztdkusnpruvooacn");

      let vcalendar = new ICAL.Component(newItem.formats.jcal);
      vcalendar
        .getFirstSubcomponent("vtodo")
        .getFirstProperty("summary")
        .setValue("changed");

      let result = await calendar.onItemUpdated(newItem, oldItem);

      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
        ),
        expect.objectContaining({
          method: "PATCH",
          body: '{"title":"changed"}',
        })
      );
    });
    test("onItemRemoved", async () => {
      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
          )
        ) {
          return {
            status: 204,
            headers: {
              "Content-Length": 0,
            },
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let item = await calendar.onItemRemoved(jcalItems.simple_task);

      // vcalendar -> vevent
      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
        ),
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  test("invalid", async () => {
    let newItem = v8.deserialize(v8.serialize(jcalItems.simple_event));
    newItem.type = "wat";
    await expect(calendar.onItemRemoved(newItem)).rejects.toThrow("Unknown item type: wat");
  });
});

describe("onSync", () => {
  test.each(["owner", "freeBusyReader"])("accessRole=%s", async accessRole => {
    let calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();

    messenger.idle._idleState = "inactive";
    await calendar.onSync();
    expect(console.log).toHaveBeenCalledWith(
      "[calGoogleCalendar]",
      "Skipping refresh since user is idle"
    );
    expect(fetch).not.toHaveBeenCalled();

    messenger.idle._idleState = "active";

    fetch.mockResponse(req => {
      let response;

      if ((response = mockCalendarRequest(req)) !== null) {
        return response;
      }
      if ((response = mockCalendarListRequest(req, { accessRole })) !== null) {
        return response;
      }
      if ((response = mockTaskRequest(req)) !== null) {
        return response;
      }

      throw new Error("Unhandled request " + req.url);
    });

    calendar.session.oauth.accessToken = "accessToken";
    calendar.session.oauth.expires = new Date(new Date().getTime() + 10000);
    await calendar.onSync();

    expect(await calendar.getCalendarPref("eventSyncToken")).toBe("nextSyncToken");
    expect(await calendar.getCalendarPref("settings.accessRole")).toBe(accessRole);
    expect(await calendar.getCalendarPref("settings.backgroundColor")).toBe("#000000");
    expect(await calendar.getCalendarPref("settings.foregroundColor")).toBe("#FFFFFF");
    expect(await calendar.getCalendarPref("settings.description")).toBe("The calendar 1");
    expect(await calendar.getCalendarPref("settings.location")).toBe("test");
    expect(await calendar.getCalendarPref("settings.primary")).toBe(true);
    expect(await calendar.getCalendarPref("settings.summary")).toBe("calendar1");
    expect(await calendar.getCalendarPref("settings.summaryOverride")).toBe("calendar1override");
    expect(await calendar.getCalendarPref("settings.timeZone")).toBe("Europe/Berlin");
    expect(await calendar.getCalendarPref("settings.defaultReminders")).toBe(
      '[{"method":"popup","minutes":120}]'
    );

    if (accessRole == "freeBusyReader") {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(messenger.calendar.calendars.update).toHaveBeenCalledWith("id1", { readOnly: true });
    }
  });

  test("reset sync", async () => {
    let calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();

    let hasCleared = false;
    let hasCalledTwice = false;
    fetch.mockResponse(req => {
      let response;

      if (req.url.startsWith("https://www.googleapis.com/calendar/v3/calendars")) {
        if (hasCleared) {
          hasCalledTwice = true;
          return mockCalendarRequest(req);
        } else {
          // RESOURCE_GONE
          hasCleared = true;
          return {
            headers: {
              "Content-Length": 0,
            },
            status: 410,
          };
        }
      }
      if ((response = mockCalendarListRequest(req)) !== null) {
        return response;
      }
      if ((response = mockTaskRequest(req)) !== null) {
        return response;
      }

      throw new Error("Unhandled request " + req.url);
    });

    authenticate(calendar.session);
    await calendar.onSync();

    expect(messenger.calendar.calendars.clear).toHaveBeenCalledTimes(1);
    expect(messenger.calendar.calendars.clear).toHaveBeenCalledWith("cached-id1");
    expect(hasCalledTwice).toBe(true);
  });

  test("resource gone twice", async () => {
    let calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();

    fetch.mockResponse(req => {
      let response;

      if (req.url.startsWith("https://www.googleapis.com/calendar/v3/calendars")) {
        // RESOURCE_GONE
        return {
          headers: {
            "Content-Length": 0,
          },
          status: 410,
        };
      }
      if ((response = mockCalendarListRequest(req)) !== null) {
        return response;
      }
      if ((response = mockTaskRequest(req)) !== null) {
        return response;
      }

      throw new Error("Unhandled request " + req.url);
    });

    jest.spyOn(calendar, "onSync");
    jest.spyOn(calendar, "onResetSync");

    authenticate(calendar.session);
    await expect(calendar.onSync()).rejects.toThrow("RESOURCE_GONE");

    expect(calendar.onSync).toHaveBeenCalledTimes(2);
    expect(calendar.onResetSync).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      "[calGoogleCalendar]",
      "Incremental update failed twice, not trying again"
    );
  });

  test("fail", async () => {
    let calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();

    fetch.mockResponse("blergh");

    authenticate(calendar.session);
    await expect(calendar.onSync()).rejects.toThrow("Received plain response: blergh...");

    expect(messenger.calendar.calendars.clear).not.toHaveBeenCalled();
  });
});

test("onDetectCalendars", async () => {
  fetch.mockResponse(req => {
    if (req.url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
      return {
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              id: "calid",
              summary: "calendar summary",
              accessRole: "owner",
              backgroundColor: "#FF0000",
            },
          ],
        }),
      };
    } else if (req.url.startsWith("https://www.googleapis.com/tasks/v1/users/@me/lists")) {
      return {
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              id: "taskid",
              title: "task summary",
            },
          ],
        }),
      };
    }
    return null;
  });

  let session = sessions.byId("username@example.com", true);
  authenticate(session);

  let calendars = await calGoogleCalendar.onDetectCalendars(
    "username@example.com",
    "password",
    "example.com",
    false,
    {}
  );
  expect(calendars).toEqual(
    expect.arrayContaining([
      {
        name: "calendar summary",
        type: "ext-" + messenger.runtime.id,
        url: "googleapi://username@example.com/?calendar=calid",
        readOnly: false,
        color: "#FF0000",
      },
      {
        name: "task summary",
        type: "ext-" + messenger.runtime.id,
        url: "googleapi://username@example.com/?tasks=taskid",
      },
    ])
  );
  expect(calendars.length).toBe(2);
});
