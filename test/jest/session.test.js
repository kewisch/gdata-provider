import jestFetchMock from "jest-fetch-mock";
jestFetchMock.enableFetchMocks();

import sessions from "../../src/background/session";
import calGoogleRequest from "../../src/background/request";
import { jest } from "@jest/globals";
import createMessenger from "./helpers/webext-api.js";
import FetchMocks from "./helpers/fetch-mocks.js";

let session;

beforeEach(() => {
  global.messenger = global.browser = createMessenger();
  jest.spyOn(global.console, "log").mockImplementation(() => {});
  jest.spyOn(global.console, "error").mockImplementation(() => {});
  session = sessions.byId("sessionId", true);
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
  session.oauth.clientId = "test_id";
  session.oauth.clientSecret = "test_secret";

  jestFetchMock.doMock();
});
afterEach(() => {
  sessions.reset();
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

  calendar = { url: new URL("https://calendar.google.com/calendar/ical/user%40example.com/public/basic.ics") };
  let session7 = sessions.byCalendar(calendar, true);
  expect(session7.id).toEqual("user@example.com");
});

describe("backoff", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  afterAll(() => {
    jest.useRealTimers();
  });
  afterEach(() => {
    session.resetBackoff();
  });

  const flushPromises = () => new Promise(jest.requireActual("timers").setImmediate);

  test("no backoff", async () => {
    expect(jest.getTimerCount()).toEqual(0);
    await session.waitForBackoff();
    expect(jest.getTimerCount()).toEqual(0);
  });

  test("one backoff", async () => {
    expect(jest.getTimerCount()).toEqual(0);
    session.backoff();

    let completed = jest.fn();
    let waiting = session.waitForBackoff().then(completed);

    jest.advanceTimersByTime(1000);
    await flushPromises();
    expect(completed).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    await flushPromises();
    expect(completed).toHaveBeenCalled();
  });

  test("max backoff", async () => {
    expect(jest.getTimerCount()).toEqual(0);
    session.backoff();
    session.backoff();
    session.backoff();
    session.backoff();
    session.backoff();

    expect(session.isMaxBackoff).toBe(false);
    session.backoff();
    expect(session.isMaxBackoff).toBe(true);

    let completed = jest.fn();
    let waiting = session.waitForBackoff().then(completed);

    jest.advanceTimersByTime(8000);
    await flushPromises();
    expect(completed).not.toHaveBeenCalled();

    jest.advanceTimersByTime(57000);
    await flushPromises();
    expect(completed).toHaveBeenCalled();
  });
});

describe("freebusy request", () => {
  const DEFAULT_RESPONSE = {
    id: "user@example.com",
    start: "2021-01-01T00:00:00",
    end: "2021-01-02T00:00:00",
    type: "busy"
  };

  test("just free intervals", async () => {
    let busy = await session.onFreeBusy(
      "user@example.com",
      "2021-01-01T00:00:00",
      "2021-01-02T00:00:00",
      ["free"]
    );

    expect(busy).toEqual([{
      ...DEFAULT_RESPONSE,
      type: "unknown",
    }]);
  });

  test("backoff enabled", async () => {
    session.backoff();
    try {
      let busy = await session.onFreeBusy(
        "user@example.com",
        "2021-01-01T00:00:00",
        "2021-01-02T00:00:00",
        ["busy"]
      );

      expect(busy).toEqual([{
        ...DEFAULT_RESPONSE,
        type: "unknown",
      }]);
    } finally {
      session.resetBackoff();
    }
  });

  test("result no email", async () => {
    let busy = await session.onFreeBusy(
      "urn:id:d35c674d-d677-4e41-81a8-de28fe0c6b64",
      "2021-01-01T00:00:00",
      "2021-01-02T00:00:00",
      ["busy"]
    );

    expect(busy).toEqual([{
      ...DEFAULT_RESPONSE,
      id: "urn:id:d35c674d-d677-4e41-81a8-de28fe0c6b64",
      type: "unknown",
    }]);
  });

  test("failed", async () => {
    fetch.mockResponseOnce("{}", { status: 500 });
    let busy = await session.onFreeBusy(
      "user@example.com",
      "2021-01-01T00:00:00",
      "2021-01-02T00:00:00",
      ["busy"]
    );

    expect(busy).toEqual([{
      ...DEFAULT_RESPONSE,
      type: "unknown",
    }]);
  });

  test("api error", async () => {
    fetch.mockResponseOnce(JSON.stringify({ error: { errors: [{ reason: "karma" }] } }), {
      headers: { "Content-Type": "application/json" },
    });
    let busy = await session.onFreeBusy(
      "user@example.com",
      "2021-01-01T00:00:00",
      "2021-01-02T00:00:00",
      ["busy"]
    );

    expect(busy).toEqual([{
      ...DEFAULT_RESPONSE,
      type: "unknown",
    }]);
  });

  test("calendar user not found error", async () => {
    fetch.mockResponseOnce(
      JSON.stringify({
        calendars: {
          "user@example.com": {
            busy: [],
            errors: [{
              reason: "notFound"
            }],
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    let busy = await session.onFreeBusy(
      "user@example.com",
      "2021-01-01T00:00:00",
      "2021-01-02T00:00:00",
      ["busy"]
    );

    expect(busy).toEqual([{
      ...DEFAULT_RESPONSE,
      type: "unknown",
    }]);
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
      "user@example.com",
      "2021-01-01T00:00:00",
      "2021-01-02T00:00:00",
      ["busy"]
    );

    expect(busy).toEqual([{
      ...DEFAULT_RESPONSE,
      type: "unknown",
    }]);
  });

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
      "user@example.com",
      "2021-01-01T00:00:00",
      "2021-01-02T00:00:00",
      ["busy"]
    );

    expect(busy).toEqual([DEFAULT_RESPONSE]);
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

  await session.refreshAccessToken();
  expect(session.oauth.ensureLogin).toHaveBeenCalledWith({
    titlePreface: "requestWindowTitle[sessionId] - ",
    loginHint: "sessionId",
  });
  expect(messenger.gdata.setOAuthToken).toHaveBeenCalledWith("sessionId", "refreshToken");
});


const REQUEST_LOGIN = {
  method: "POST",
  url: "https://oauth2.googleapis.com/token",
  headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
  body: {
    client_secret: "test_secret",
    client_id: "test_id",
    code: "authCode",
    grant_type: "authorization_code",
    redirect_uri: "http://localhost/"
  }
};

const REQUEST_REFRESH_TOKEN = {
  method: "POST",
  url: "https://oauth2.googleapis.com/token",
  headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
  body: {
    client_secret: "test_secret",
    client_id: "test_id",
    grant_type: "refresh_token",
    refresh_token: "refreshToken"
  }
};

const RESPONSE_LOGIN_SUCCESS = {
  status: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    access_token: "1/fFAGRNJru1FTz70BzhT3Zg",
    refresh_token: "refreshToken",
    expires_in: 300,
    scope: "https://www.googleapis.com/auth/calendar",
    token_type: "Bearer"
  }),
};
const RESPONSE_REFRESH_TOKEN_SUCCESS = {
  status: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    access_token: "1/fFAGRNJru1FTz70BzhT3Zg",
    expires_in: 300,
    scope: "https://www.googleapis.com/auth/calendar",
    token_type: "Bearer"
  }),
};

const RESPONSE_INVALID_ACCESS_TOKEN = {
  status: 401,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    error: {
      errors: [{
        reason: "unauthorized_client"
      }]
    }
  }),
};
const RESPONSE_INVALID_REFRESH_TOKEN = {
  status: 400,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    error: "invalid_grant",
    error_description: "The refresh token is invalid"
  }),
};
const RESPONSE_INVALID_CLIENT = {
  status: 400,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    error: "invalid_client",
    error_description: "The OAuth client was not found"
  }),
};
const RESPONSE_RATE_LIMIT = {
  status: 400,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    error: "userRateLimitExceeded",
    error_description: "The OAuth client was not found"
  }),
};
const RESPONSE_LOGIN_FAILED = {
  status: 400,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    error: "invalid_grant",
    error_description: "Malformed auth code"
  })
};


describe("login paths", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  test("refresh expired access token", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    session.oauth.expires = new Date("2023-12-31T23:59:59Z");
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(true);
    expect(session.oauth.accessToken).toBe(null);

    let fetchMocks = new FetchMocks([{
      request: REQUEST_REFRESH_TOKEN,
      response: RESPONSE_REFRESH_TOKEN_SUCCESS
    }]);

    await session.ensureLogin();

    jest.setSystemTime(new Date("2024-01-01T00:03:00Z"));

    fetchMocks.expectFetchCount();
    expect(session.accessToken).toBe("1/fFAGRNJru1FTz70BzhT3Zg");
    expect(session.oauth.grantedScopes).toBe("https://www.googleapis.com/auth/calendar");

    // 5 Minutes, minus 60 seconds grace time
    expect(session.oauth.expires).toEqual(new Date("2024-01-01T00:04:00Z"));
  });

  test("expired access token and no refresh token", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    session.oauth.expires = new Date("2023-12-31T23:59:59Z");
    messenger.gdata.setOAuthToken(session.id, null);

    expect(session.oauth.expired).toBe(true);
    expect(session.oauth.accessToken).toBe(null);
    expect(session.oauth.refreshToken).toBe(null);

    let fetchMocks = new FetchMocks([{
      request: REQUEST_LOGIN,
      response: RESPONSE_LOGIN_SUCCESS
    }]);

    messenger.webRequest.onBeforeRequest.mockResponse({ url: "http://foo/?code=authCode" });

    await session.ensureLogin();

    fetchMocks.expectFetchCount();
    expect(session.accessToken).toBe("1/fFAGRNJru1FTz70BzhT3Zg");
    expect(session.refreshToken).toBe("refreshToken");
    expect(session.oauth.grantedScopes).toBe("https://www.googleapis.com/auth/calendar");

    // 5 Minutes, minus 60 seconds grace time
    expect(session.oauth.expires).toEqual(new Date("2024-01-01T00:04:00Z"));
  });


  test("unauthorized client on the access token, refresh succeeded", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });


    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN,
      },

      // Second request succeeds to refresh the access token
      {
        request: REQUEST_REFRESH_TOKEN,
        response: RESPONSE_REFRESH_TOKEN_SUCCESS
      },
      // Third request is the actual test GET request
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: {
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "response" }),
        }
      }
    ]);

    let response = await request.commit(session);

    fetchMocks.expectFetchCount();
    expect(response).toEqual({
      response: "response"
    });
  });

  test("unauthorized client on the access token, refresh failed, login succeeded", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request is the refresh which fails due to invalid refresh token
      {
        request: REQUEST_REFRESH_TOKEN,
        response: RESPONSE_INVALID_REFRESH_TOKEN
      },
      // Third request is the login which succeeds
      {
        request: REQUEST_LOGIN,
        response: RESPONSE_LOGIN_SUCCESS,
      },
      // Fourth request is the actual test GET request
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: {
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "response" }),
        }
      }
    ]);

    messenger.webRequest.onBeforeRequest.mockResponse({ url: "http://foo/?code=authCode" });

    let response = await request.commit(session);

    fetchMocks.expectFetchCount();
    expect(response).toEqual({
      response: "response"
    });
  });

  test("unauthorized client on the access token, refresh failed, login failed", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request succeeds to refresh the access token
      {
        request: REQUEST_REFRESH_TOKEN,
        response: RESPONSE_INVALID_REFRESH_TOKEN
      },
      // Third request is the login which fails
      {
        request: REQUEST_LOGIN,
        response: RESPONSE_LOGIN_FAILED
      }
    ]);

    messenger.webRequest.onBeforeRequest.mockResponse({ url: "http://foo/?code=authCode" });

    await expect(request.commit(session)).rejects.toThrow("TOKEN_FAILURE");
    fetchMocks.expectFetchCount();
  });

  test("unauthorized client on the access token, refresh failed, login wrong response", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request succeeds to refresh the access token
      {
        request: REQUEST_REFRESH_TOKEN,
        response: RESPONSE_INVALID_REFRESH_TOKEN
      },
      // Third request is the login which fails
      {
        request: REQUEST_LOGIN,
        response: {
          ...RESPONSE_LOGIN_FAILED,
          body: "{}"
        }
      }
    ]);

    messenger.webRequest.onBeforeRequest.mockResponse({ url: "http://foo/?code=authCode" });

    await expect(request.commit(session)).rejects.toThrow("request_error");
    fetchMocks.expectFetchCount();
  });

  test("unauthorized client on the access token, refresh invalid_client", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request is the refresh which fails with invalid_client
      {
        request: REQUEST_REFRESH_TOKEN,
        response: RESPONSE_INVALID_CLIENT
      },
    ]);


    await expect(request.commit(session)).rejects.toThrow("TOKEN_FAILURE");
    fetchMocks.expectFetchCount();
  });

  test("unauthorized client on the access token, refresh userRateLimitExceeded", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request is the refresh which fails with userRateLimitExceeded
      {
        request: REQUEST_REFRESH_TOKEN,
        response: RESPONSE_RATE_LIMIT
      },
    ]);


    await expect(request.commit(session)).rejects.toThrow("userRateLimitExceeded");
    fetchMocks.expectFetchCount();
  });

  test("unauthorized client on the access token, refresh error 503", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request is the refresh which we'll fail with a 503 error
      {
        request: REQUEST_REFRESH_TOKEN,
        response: {
          status: 503,
          body: "Internal Server Error"
        }
      },
    ]);


    await expect(request.commit(session)).rejects.toThrow("request_error");
    fetchMocks.expectFetchCount();
  });

  test("unauthorized client on the access token, error 503 with json", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request is the refresh which we'll fail with a 503 error
      {
        request: REQUEST_REFRESH_TOKEN,
        response: {
          status: 503,
          body: "{}"
        }
      },
    ]);


    await expect(request.commit(session)).rejects.toThrow("request_error");
    fetchMocks.expectFetchCount();
  });

  test("unauthorized client on the access token, login works, new token fails again", async () => {
    session.oauth.refreshToken = "refreshToken";
    messenger.gdata.setOAuthToken(session.id, "refreshToken");

    expect(session.oauth.expired).toBe(false);
    expect(session.oauth.accessToken).toBeTruthy();
    expect(session.oauth.refreshToken).toBeTruthy();

    let request = new calGoogleRequest({
      method: "GET",
      uri: "http://localhost/test"
    });

    let fetchMocks = new FetchMocks([
      // First request fails due to invalid access token
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
      // Second request is the refresh which we'll succeed
      {
        request: REQUEST_REFRESH_TOKEN,
        response: RESPONSE_REFRESH_TOKEN_SUCCESS
      },
      // Now we fail the access token again
      {
        request: {
          method: "GET",
          url: "http://localhost/test",
        },
        response: RESPONSE_INVALID_ACCESS_TOKEN
      },
    ]);


    await expect(request.commit(session)).rejects.toThrow("TOKEN_FAILURE");
    fetchMocks.expectFetchCount();
  });
});

test("ensureLogin", async () => {
  let completeLogin = null;

  session.refreshAccessToken = jest.fn(() => {
    return new Promise(resolve => {
      completeLogin = resolve;
    });
  });

  await session.ensureLogin();
  expect(session.refreshAccessToken).not.toHaveBeenCalled();

  session.oauth.accessToken = null;
  let loginPromise = session.ensureLogin();
  expect(session.refreshAccessToken).toHaveBeenCalledTimes(1);

  let loginPromise2 = session.ensureLogin();
  expect(session.refreshAccessToken).toHaveBeenCalledTimes(1);

  completeLogin("loginResult");
  let result = await loginPromise;
  expect(result).toBe("loginResult");

  result = await loginPromise2;
  expect(result).toBe("loginResult");

  let loginPromise3 = session.ensureLogin();
  expect(session.refreshAccessToken).toHaveBeenCalledTimes(2);
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

describe("refreshAccessToken", () => {
  test.each(["unauthorized_client", "invalid_grant"])("attempts a refresh on '%s'", async (error) => {
    let fetchMocks = new FetchMocks([
      {
        request: REQUEST_REFRESH_TOKEN,
        response: {
          status: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error,
            error_description: "The refresh token is invalid"
          }),
        }
      },
    ]);

    await messenger.gdata.setOAuthToken(session.id, "refreshToken");
    session.oauth.login = jest.fn(async () => {});

    await session.refreshAccessToken(true);

    expect(session.oauth.login).toHaveBeenCalled();
    fetchMocks.expectFetchCount();
  });

  test.each([
    "invalid_request",
    "unsupported_grant_type",
    "invalid_scope"
  ])("attempts no refresh on '%s'", async (error) => {
    // These errors are likely unrecoverable. If this assumption is wrong, the code and test should be changed.
    let fetchMocks = new FetchMocks([
      {
        request: REQUEST_REFRESH_TOKEN,
        response: {
          status: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error,
            error_description: error
          }),
        }
      },
    ]);

    await messenger.gdata.setOAuthToken(session.id, "refreshToken");
    session.oauth.login = jest.fn(async () => {});

    await expect(session.refreshAccessToken(true)).rejects.toThrow("TOKEN_FAILURE");
    fetchMocks.expectFetchCount();
  });
});
