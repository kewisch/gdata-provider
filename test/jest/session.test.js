import jestFetchMock from "jest-fetch-mock";
jestFetchMock.enableFetchMocks();

import sessions from "../../src/background/session";
import calGoogleRequest from "../../src/background/request";
import { jest } from "@jest/globals";
import createMessenger from "./webext-api";

let session;

beforeEach(() => {
  global.messenger = createMessenger();
  jest.spyOn(global.console, "log").mockImplementation(() => {});
  jest.spyOn(global.console, "error").mockImplementation(() => {});
  session = sessions.byId("sessionId", true);
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);

  jestFetchMock.doMock();
});

test("get session ids", () => {
  let id = "get session id";

  expect(sessions.ids).toEqual(["sessionId"]);
  let session1 = sessions.byId(id, true);
  expect(sessions.ids).toEqual(["sessionId", "get session id"]);
});

test("get session by id", () => {
  let id = "otherSessionId";

  let session1 = sessions.byId(id);

  expect(session1).toBe(undefined);

  let session2 = sessions.byId(id, true);

  expect(console.log).toHaveBeenLastCalledWith("[calGoogleSession]", "Creating session", id);
  expect(session2.id).toBe(id);
  expect(global.messenger.calendar.provider.onFreeBusy.addListener).toHaveBeenCalled();

  let session3 = sessions.byId(id);
  expect(session3).toBe(session2);
  expect(console.log).toHaveBeenLastCalledWith("[calGoogleSession]", "Reusing session", id);

  let calendar = { url: new URL("googleapi://looks_like_email@otherSessionId/?calendar=foo") };
  let session4 = sessions.byCalendar(calendar);
  expect(session4).toBe(undefined);

  calendar = { url: new URL("googleapi://otherSessionId/?calendar=foo") };
  let session5 = sessions.byCalendar(calendar);
  expect(session5).toBe(session3);

  calendar = { url: new URL("wat://otherSessionId") };
  let session6 = sessions.byCalendar(calendar);
  expect(session6).toBe(null);
  expect(console.error).toHaveBeenCalledWith(
    "[calGoogleSession]",
    "Attempting to get session for invalid calendar url: wat://otherSessionId"
  );
});

describe("freebusy request", () => {
  test("success", async () => {
    fetch.mockResponseOnce(
      JSON.stringify({
        calendars: {
          "user@example.com": {
            busy: [{ start: "2021-01-01T00:00:00", end: "2021-01-02T00:00:00" }],
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    );

    let busy = await session.onFreeBusy(
      "mailto:user@example.com",
      "20210101T000000",
      "20210102T000000",
      null
    );

    expect(busy).toEqual([
      {
        id: "user@example.com",
        start: undefined,
        end: undefined,
        type: "BUSY",
      },
    ]);
  });

  test("result no email", async () => {
    let busy = await session.onFreeBusy(
      "urn:id:d35c674d-d677-4e41-81a8-de28fe0c6b64",
      "20210101T000000",
      "20210102T000000",
      null
    );
    expect(busy).toEqual([]);
  });

  test("failed", async () => {
    fetch.mockResponseOnce("{}", { status: 500 });
    let busy = await session.onFreeBusy(
      "mailto:user@example.com",
      "20210101T000000",
      "20210102T000000",
      null
    );
    expect(busy).toEqual([]);
  });

  test("api error", async () => {
    fetch.mockResponseOnce(JSON.stringify({ error: { errors: [{ reason: "karma" }] } }), {
      headers: { "Content-Type": "application/json" },
    });
    let busy = await session.onFreeBusy(
      "mailto:user@example.com",
      "20210101T000000",
      "20210102T000000",
      null
    );
    expect(busy).toEqual([]);
  });

  test("missing user", async () => {
    fetch.mockResponseOnce(
      JSON.stringify({
        calendars: {
          "user2@example.com": {
            busy: [{ start: "2021-01-01T00:00:00", end: "2021-01-02T00:00:00" }],
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    );

    let busy = await session.onFreeBusy(
      "mailto:user@example.com",
      "20210101T000000",
      "20210102T000000",
      null
    );
    expect(busy).toEqual([]);
  });
});

test("notifyOutdated", () => {
  session._lastNotified = null;
  session.notifyOutdated();
  expect(messenger.notifications.create).toHaveBeenCalledWith("providerOutdated", {
    title: "extensionName[]",
    message: "providerOutdated[sessionId]",
  });
  expect(messenger.notifications.create.mock.calls.length).toEqual(1);

  session.notifyOutdated();
  expect(messenger.notifications.create.mock.calls.length).toEqual(1);
});

test("notifyQuotaExceeded", () => {
  session._lastNotified = null;
  session.notifyQuotaExceeded();
  expect(messenger.notifications.create).toHaveBeenCalledWith("quotaExceeded", {
    title: "extensionName[]",
    message: "quotaExceeded[sessionId]",
  });
  expect(messenger.notifications.create.mock.calls.length).toEqual(1);

  session.notifyQuotaExceeded();
  expect(messenger.notifications.create.mock.calls.length).toEqual(1);
});

test("login", async () => {
  session.oauth.ensureLogin = jest.fn(async () => {
    session.oauth.refreshToken = "refreshToken";
  });

  await session.login();
  expect(session.oauth.ensureLogin).toHaveBeenCalledWith({
    titlePreface: "requestWindowTitle[sessionId] - ",
    loginHint: "sessionId",
  });
  expect(messenger.gdata.setOAuthToken).toHaveBeenCalledWith("sessionId", "refreshToken");
});

test("ensureLogin", async () => {
  let completeLogin = null;

  session.login = jest.fn(() => {
    return new Promise(resolve => {
      completeLogin = resolve;
    });
  });

  await session.ensureLogin();
  expect(session.login).not.toHaveBeenCalled();

  session.oauth.accessToken = null;
  let loginPromise = session.ensureLogin();
  expect(session.login).toHaveBeenCalledTimes(1);

  let loginPromise2 = session.ensureLogin();
  expect(session.login).toHaveBeenCalledTimes(1);

  completeLogin("loginResult");
  let result = await loginPromise;
  expect(result).toBe("loginResult");

  result = await loginPromise2;
  expect(result).toBe("loginResult");

  let loginPromise3 = session.ensureLogin();
  expect(session.login).toHaveBeenCalledTimes(2);
  completeLogin("loginResult2");
  result = await loginPromise3;
  expect(result).toBe("loginResult2");
});

describe("paginatedRequest", () => {
  test("success", async () => {
    let request = new calGoogleRequest({
      method: "GET",
      uri: new URL("https://localhost/test"),
    });

    let onFirst = jest.fn(async () => {});
    let onEach = jest.fn(async () => {});
    let onLast = jest.fn(async () => "lastdata");

    fetch.mockResponses(
      [JSON.stringify({ nextPageToken: 1 }), { headers: { "Content-Type": "application/json" } }],
      [JSON.stringify({ nextPageToken: 2 }), { headers: { "Content-Type": "application/json" } }],
      [JSON.stringify({ fin: true }), { headers: { "Content-Type": "application/json" } }]
    );

    let lastData = await session.paginatedRequest(request, onFirst, onEach, onLast);
    let expectMethod = expect.objectContaining({ method: "GET" });

    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onFirst).toHaveBeenCalledWith({ nextPageToken: 1 });
    expect(onEach).toHaveBeenCalledTimes(3);
    expect(onEach).toHaveBeenNthCalledWith(1, { nextPageToken: 1 });
    expect(onEach).toHaveBeenNthCalledWith(2, { nextPageToken: 2 });
    expect(onEach).toHaveBeenNthCalledWith(3, { fin: true });
    expect(onLast).toHaveBeenCalledTimes(1);
    expect(onLast).toHaveBeenCalledWith({ fin: true });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(1, new URL("https://localhost/test"), expectMethod);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      new URL("https://localhost/test?pageToken=1"),
      expectMethod
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      new URL("https://localhost/test?pageToken=2"),
      expectMethod
    );

    expect(lastData).toBe("lastdata");
  });

  test("no each or last", async () => {
    let request = new calGoogleRequest({
      method: "GET",
      uri: new URL("https://localhost/test"),
    });

    let onFirst = jest.fn(async () => {});

    fetch.mockResponses(
      [JSON.stringify({ nextPageToken: 1 }), { headers: { "Content-Type": "application/json" } }],
      [JSON.stringify({ nextPageToken: 2 }), { headers: { "Content-Type": "application/json" } }],
      [JSON.stringify({ fin: true }), { headers: { "Content-Type": "application/json" } }]
    );

    let lastData = await session.paginatedRequest(request, onFirst, null, null);

    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onFirst).toHaveBeenCalledWith({ nextPageToken: 1 });

    expect(lastData).toBe(null);
  });
});

test("getCalendarList", async () => {
  fetch.mockResponses(
    [
      JSON.stringify({ items: [1, 2, 3], nextPageToken: 1 }),
      { headers: { "Content-Type": "application/json" } },
    ],
    [
      JSON.stringify({ items: [4, 5, 6], nextPageToken: 2 }),
      { headers: { "Content-Type": "application/json" } },
    ],
    [JSON.stringify({ items: [7, 8, 9] }), { headers: { "Content-Type": "application/json" } }]
  );

  let expectMethod = expect.objectContaining({ method: "GET" });
  let items = await session.getCalendarList();
  expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

  expect(fetch).toHaveBeenNthCalledWith(
    1,
    new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList"),
    expectMethod
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList?pageToken=1"),
    expectMethod
  );
  expect(fetch).toHaveBeenNthCalledWith(
    3,
    new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList?pageToken=2"),
    expectMethod
  );
});

test("getTasksList", async () => {
  fetch.mockResponses(
    [
      JSON.stringify({ items: [1, 2, 3], nextPageToken: 1 }),
      { headers: { "Content-Type": "application/json" } },
    ],
    [
      JSON.stringify({ items: [4, 5, 6], nextPageToken: 2 }),
      { headers: { "Content-Type": "application/json" } },
    ],
    [JSON.stringify({ items: [7, 8, 9] }), { headers: { "Content-Type": "application/json" } }]
  );

  let expectMethod = expect.objectContaining({ method: "GET" });
  let items = await session.getTasksList();
  expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

  expect(fetch).toHaveBeenNthCalledWith(
    1,
    new URL("https://www.googleapis.com/tasks/v1/users/@me/lists"),
    expectMethod
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    new URL("https://www.googleapis.com/tasks/v1/users/@me/lists?pageToken=1"),
    expectMethod
  );
  expect(fetch).toHaveBeenNthCalledWith(
    3,
    new URL("https://www.googleapis.com/tasks/v1/users/@me/lists?pageToken=2"),
    expectMethod
  );
});

test("invalidate", async () => {
  session.oauth.refreshToken = "refreshToken";
  session.oauth.invalidate = jest.fn();

  await session.invalidate();

  expect(session.oauth.invalidate).toHaveBeenCalled();
  expect(messenger.gdata.setOAuthToken).toHaveBeenCalledWith("sessionId", "refreshToken");
});
