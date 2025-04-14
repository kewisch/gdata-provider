/**
 * @jest-environment jsdom
 */

import fs from "fs";
import { jest } from "@jest/globals";
import createMessenger from "./helpers/webext-api.js";
import { main as creationMain } from "../../src/content/calendar-creation.js";
import { initListeners } from "../../src/background/index.js";
import sessions from "../../src/background/session.js";

const html = fs.readFileSync(
  new URL("../../src/content/calendar-creation.html", import.meta.url),
  "utf-8"
);

function qs(id) {
  return document.querySelector(id);
}

beforeEach(async () => {
  jest.spyOn(global.console, "log").mockImplementation(() => {});
  document.documentElement.innerHTML = html;
  global.messenger = global.browser = createMessenger();
  await initListeners();
});

test("main", async () => {
  sessions.byId("sessionId@example.com", true);
  await creationMain();

  let sessionContainer = qs("#gdata-existing-sessions");
  expect(sessionContainer.children.length).toBe(1);

  expect(qs("#gdata-existing-sessions > label").textContent).toBe("sessionId@example.com");
  expect(qs("#gdata-existing-sessions > label > input").value).toBe("sessionId@example.com");
  expect(messenger.calendar.provider._advanceAction).toEqual({ forward: "authenticate", back: null, label: "Authenticate" });
});


test("clickNewSession", async () => {
  sessions.byId("sessionId@example.com", true);
  await creationMain();

  expect(qs("#gdata-existing-sessions input").checked).toBe(true);
  qs("#gdata-session-name").click();
  expect(qs("#gdata-existing-sessions input").checked).toBe(false);
});

describe("auth", () => {
  beforeEach(async () => {
    let session = sessions.byId("sessionId@example.com", true);
    session.oauth.accessToken = "accessToken";
    session.oauth.expires = new Date(new Date().getTime() + 10000);
    session.getCalendarList = jest.fn(async () => {
      return [{ id: "id1@calendar.google.com", summary: "calendar1" }];
    });
    session.getTasksList = jest.fn(async () => {
      return [{ id: "taskhash", title: "tasks1" }];
    });
    await creationMain();

    global.messenger.calendar.calendars._calendars = [
      { id: "id0", type: "ics", url: "https://example.com/feed.ics" },
      {
        id: "id1",
        cacheId: "cached-id1",
        type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
        url: "googleapi://sessionId@example.com/?calendar=id1%40calendar.google.com&tasks=taskhash",
      },
      {
        id: "id7",
        cacheId: "cached-id7",
        type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
        url: "googleapi://sessionId@example.com/?calendar=id7%40calendar.google.com",
      },
      {
        id: "id8",
        cacheId: "cached-id8",
        type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
        url: "googleapi://sessionId@example.com/?tasks=taskhash",
      },
    ];
  });


  test("new session", async () => {
    let origById = sessions.byId;
    let lastCreateArg;
    jest.spyOn(sessions, "byId").mockImplementation((id, create) => {
      lastCreateArg = [id, create];
      let session = origById.call(sessions, id, create);
      session.oauth.accessToken = "accessToken";
      session.oauth.expires = new Date(new Date().getTime() + 10000);
      session.getCalendarList = jest.fn(async () => {
        return [{ id: "id1@calendar.google.com", summary: "calendar1" }];
      });
      session.getTasksList = jest.fn(async () => {
        return [{ id: "taskhash", title: "tasks1" }];
      });
      return session;
    });
    qs("#gdata-new-session > input").checked = true;
    document.getElementById("gdata-session-name").value = "newSessionId@example.com";
    await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("authenticate");


    expect(lastCreateArg).toEqual(["newSessionId@example.com", true]);

    expect(qs("#calendar-list").children.length).toBe(1);
    expect(qs("#calendar-list > li > label").textContent).toBe("calendar1");
    expect(qs("#calendar-list > li > label > input").value).toBe("id1@calendar.google.com");
    expect(qs("#calendar-list > li > label > input").disabled).toBe(true);
    expect(qs("#calendar-list > li > label > input").checked).toBe(true);

    expect(qs("#tasklist-list").children.length).toBe(1);
    expect(qs("#tasklist-list > li > label").textContent).toBe("tasks1");
    expect(qs("#calendar-list > li > label > input").disabled).toBe(true);
    expect(qs("#calendar-list > li > label > input").checked).toBe(true);
  });

  test("existing session", async () => {
    qs("#gdata-existing-sessions input").checked = true;
    await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("authenticate");

    expect(qs("#calendar-list").children.length).toBe(1);
    expect(qs("#calendar-list > li > label").textContent).toBe("calendar1");
    expect(qs("#calendar-list > li > label > input").value).toBe("id1@calendar.google.com");
    expect(qs("#calendar-list > li > label > input").disabled).toBe(true);
    expect(qs("#calendar-list > li > label > input").checked).toBe(true);

    expect(qs("#tasklist-list").children.length).toBe(1);
    expect(qs("#tasklist-list > li > label").textContent).toBe("tasks1");
    expect(qs("#calendar-list > li > label > input").disabled).toBe(true);
    expect(qs("#calendar-list > li > label > input").checked).toBe(true);
  });
});

test("create", async () => {
  await creationMain();
  let session = sessions.byId("sessionId@example.com", true);
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
  session.getCalendarList = jest.fn(async () => {
    return [{ id: "id1", summary: "calendar1" }];
  });
  session.getTasksList = jest.fn(async () => {
    return [{ id: "id2", summary: "tasks1" }];
  });

  qs("#gdata-new-session > input").checked = true;
  document.getElementById("gdata-session-name").value = "sessionId@example.com";
  await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("authenticate");

  expect(qs("#calendar-list").children.length).toBe(1);
  expect(qs("#tasklist-list").children.length).toBe(1);

  qs("#calendar-list > li > label > input").checked = true;

  await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("subscribe");

  expect(messenger.calendar.calendars.create).toHaveBeenCalledWith({
    name: "calendar1",
    type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
    url: "googleapi://sessionId@example.com/?calendar=id1",
    capabilities: {
      events: true,
      tasks: false
    }
  });
});

test("validate", async () => {
  let session = sessions.byId("sessionId@example.com", true);
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
  session.getCalendarList = jest.fn(async () => {
    return [{ id: "id1", summary: "calendar1" }];
  });
  session.getTasksList = jest.fn(async () => {
    return [{ id: "id2", summary: "tasks1" }];
  });
  await creationMain();

  await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("initial");
  expect(messenger.calendar.provider._advanceAction).toEqual({ forward: "authenticate", back: null, label: "Authenticate" });

  qs("#gdata-session-name").dispatchEvent(new InputEvent("input"));
  expect(messenger.calendar.provider._advanceAction).toEqual({ canForward: false, forward: "authenticate", back: null, label: "Authenticate" });

  messenger.calendar.provider._advanceAction = null;
  qs("#gdata-session-name").value = "valid@example.com";
  qs("#gdata-session-name").dispatchEvent(new InputEvent("input"));
  expect(messenger.calendar.provider._advanceAction).toEqual({ canForward: true, forward: "authenticate", back: null, label: "Authenticate" });

  messenger.calendar.provider._advanceAction = null;
  qs("#gdata-session-name").value = "invalid";
  qs("#gdata-session-name").dispatchEvent(new InputEvent("input"));
  expect(messenger.calendar.provider._advanceAction).toEqual({ canForward: false, forward: "authenticate", back: null, label: "Authenticate" });

  messenger.calendar.provider._advanceAction = null;
  qs("#gdata-existing-sessions input").checked = true;
  qs("#gdata-session").dispatchEvent(new Event("change"));
  expect(messenger.calendar.provider._advanceAction).toEqual({ canForward: true, forward: "authenticate", back: null, label: "Authenticate" });

  qs("#gdata-new-session input").checked = true;
  qs("#gdata-session").dispatchEvent(new Event("change"));
  expect(messenger.calendar.provider._advanceAction).toEqual({ canForward: false, forward: "authenticate", back: null, label: "Authenticate" });

  let result = await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("authenticate");
  expect(result).toBe(false);
  expect(qs("#gdata-calendars").hidden).toBe(true);
});

test("advanceNewCalendar", async () => {
  let session = sessions.byId("sessionId@example.com", true);
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
  session.getCalendarList = jest.fn(async () => {
    return [{ id: "id1", summary: "calendar1" }];
  });
  session.getTasksList = jest.fn(async () => {
    return [{ id: "id2", summary: "tasks1" }];
  });
  await creationMain();

  let result = await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("initial");
  expect(qs("#gdata-calendars").hidden).toBe(true);
  expect(qs("#gdata-session").hidden).toBe(false);
  expect(messenger.calendar.provider._advanceAction).toEqual({ forward: "authenticate", back: null, label: "Authenticate" });
  expect(result).toBe(false);

  result = await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("authenticate");
  expect(messenger.calendar.provider._advanceAction).toEqual({ forward: "subscribe", back: "initial", label: "Subscribe" });
  expect(result).toBe(false);

  result = await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("subscribe");
  expect(messenger.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: "createCalendars" }));
  expect(result).toBe(true);

  result = await messenger.calendar.provider.onAdvanceNewCalendar.mockResponse("invalid");
  expect(result).toBe(true);
});
