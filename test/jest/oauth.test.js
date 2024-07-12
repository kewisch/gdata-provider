import jestFetchMock from "jest-fetch-mock";
jestFetchMock.enableFetchMocks();

import OAuth2 from "../../src/background/oauth";
import { jest } from "@jest/globals";
import createMessenger from "./helpers/webext-api.js";
import FetchMocks from "./helpers/fetch-mocks.js";

var oauth;

beforeEach(() => {
  global.browser = createMessenger();
  jestFetchMock.doMock();
  oauth = new OAuth2({
    clientId: "clientId",
    clientSecret: "clientSecret",
    scope: "scope",
  });

  /* eslint-disable jest/no-standalone-expect */
  expect(oauth.expired).toBe(true);
  expect(oauth.accessToken).toBe(null);
  expect(oauth.refreshToken).toBe(null);
  /* eslint-enable jest/no-standalone-expect */

  jest.useFakeTimers("modern").setSystemTime(new Date("2021-01-01").getTime());
});

describe("oauth flow", () => {
  test("success", async () => {
    let fetchMocks = new FetchMocks([
      {
        request: {
          method: "POST",
          url: "https://oauth2.googleapis.com/token",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
          body: {
            client_secret: "clientSecret",
            client_id: "clientId",
            code: "authCode",
            grant_type: "authorization_code",
            redirect_uri: "http://localhost/"
          }
        },
        response: {
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: "accessToken",
            refresh_token: "refreshToken",
            scope: "scope",
            expires_in: 86400,
          })
        }
      }
    ]);

    global.browser.webRequest.onBeforeRequest.mockResponse({
      url: oauth.APPROVAL_URL + "?response=ok&code=authCode",
    });

    await oauth.login({
      titlePreface: "preface",
      loginHint: "hint",
    });

    expect(browser.webRequest.onBeforeRequest.addListener).toHaveBeenCalled();
    expect(browser.webRequest.onBeforeRequest.addListener.mock.calls[0][1]).toEqual({
      urls: [oauth.CALLBACK_URL + "*", oauth.APPROVAL_URL + "*"],
      windowId: "windowId",
    });

    expect(browser.windows.remove).toHaveBeenCalledWith("windowId");
    expect(browser.windows.create).toHaveBeenCalledWith({
      titlePreface: "preface",
      type: "popup",
      url:
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=clientId&scope=scope&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%2F&login_hint=hint&hl=klingon",
      width: oauth.WINDOW_WIDTH,
      height: oauth.WINDOW_HEIGHT,
    });

    expect(oauth.accessToken).toBe("accessToken");
    expect(oauth.refreshToken).toBe("refreshToken");
    expect(oauth.grantedScopes).toBe("scope");
    expect(oauth.expires).toEqual(
      new Date(new Date("2021-01-02") - 1000 * oauth.EXPIRE_GRACE_SECONDS)
    );

    fetchMocks.expectFetchCount();
  });

  test("cancel", async () => {
    global.browser.windows.onRemoved.mockResponse("wrongWindowId");
    global.browser.windows.onRemoved.mockResponse("windowId");

    await expect(
      oauth.login({
        titlePreface: "preface",
        loginHint: "hint",
      })
    ).rejects.toEqual({ error: "canceled" });
  });

  test("response error", async () => {
    global.browser.webRequest.onBeforeRequest.mockResponse({
      url: oauth.APPROVAL_URL + "?error=errorCode",
    });

    await expect(oauth.login({})).rejects.toThrow("oauth_error");

    expect(fetch).not.toHaveBeenCalled();

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe(null);
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);
  });

  test("fetch response error", async () => {
    fetch.mockResponseOnce(null, { status: 500 });

    global.browser.webRequest.onBeforeRequest.mockResponse({
      url: oauth.APPROVAL_URL + "?response=ok&approvalCode=approvalCode",
    });

    await expect(
      oauth.login({
        titlePreface: "preface",
        loginHint: "hint",
      })
    ).rejects.toThrow(expect.objectContaining({
      message: "request_error",
      error: { reason: "request_error", code: 500 }
    }));

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe(null);
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);
  });

  test("fetch response error json detail", async () => {
    fetch.mockResponseOnce(JSON.stringify({ error: "from_response", error_description: "From Response" }), { status: 500 });

    global.browser.webRequest.onBeforeRequest.mockResponse({
      url: oauth.APPROVAL_URL + "?response=ok&approvalCode=approvalCode",
    });

    await expect(
      oauth.login({
        titlePreface: "preface",
        loginHint: "hint",
      })
    ).rejects.toThrow(expect.objectContaining({
      message: "from_response",
      error: { reason: "from_response", "message": "From Response" },
    }));

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe(null);
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);
  });

  test("force refresh", async () => {
    oauth.refreshToken = "refreshToken";

    fetch.mockResponseOnce(
      JSON.stringify({
        access_token: "accessToken",
        expires_in: 86400,
        scope: "scope",
      })
    );

    await oauth.refresh(true);

    expect(oauth.accessToken).toBe("accessToken");
    expect(oauth.refreshToken).toBe("refreshToken");
    expect(oauth.grantedScopes).toBe("scope");
    expect(oauth.expires).toEqual(
      new Date(new Date("2021-01-02") - 1000 * oauth.EXPIRE_GRACE_SECONDS)
    );
  });

  test("force refresh response not ok", async () => {
    oauth.refreshToken = "refreshToken";

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe("refreshToken");
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);

    fetch.mockResponseOnce(JSON.stringify({ error: "error" }), { status: 500 });

    await expect(oauth.refresh(true)).rejects.toThrow(expect.objectContaining({
      message: "error"
    }));

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe("refreshToken");
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);
  });

  test("refresh not expired", async () => {
    oauth.refreshToken = "refreshToken";

    oauth.expires = new Date("2021-02-01");

    await oauth.refresh();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("force refresh response no json", async () => {
    oauth.refreshToken = "refreshToken";

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe("refreshToken");
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);

    fetch.mockResponseOnce(null, { status: 500 });

    await expect(oauth.refresh(true)).rejects.toThrow("request_error");

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe("refreshToken");
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);
  });
});

describe("ensureLogin", () => {
  test("expired /w refreshToken", async () => {
    oauth.refreshToken = "refreshToken";

    oauth.expires = new Date("2020-12-31");

    jest.spyOn(oauth, "refresh").mockImplementation(async () => {
      oauth.accessToken = "accessToken";
      oauth.expires = new Date("2021-02-01");
    });
    jest.spyOn(oauth, "login").mockImplementation(async () => {});

    await oauth.ensureLogin();
    expect(oauth.accessToken).toBe("accessToken");

    expect(oauth.refresh).toHaveBeenCalled();
    expect(oauth.login).not.toHaveBeenCalled();
  });

  test("expired /w refreshToken and no access token", async () => {
    oauth.expires = new Date("2020-12-31");

    jest.spyOn(oauth, "refresh").mockImplementation(async () => {});
    jest.spyOn(oauth, "login").mockImplementation(async () => {});

    await oauth.ensureLogin({ param: 1 });

    expect(oauth.refresh).not.toHaveBeenCalled();
    expect(oauth.login).toHaveBeenCalledWith({ param: 1 });
  });
});

describe("logout", () => {
  test("/w refreshToken", async () => {
    oauth.refreshToken = "refreshToken";

    let fetchMocks = new FetchMocks([{
      request: {
        method: "POST",
        url: "https://oauth2.googleapis.com/revoke",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: {
          token: "refreshToken"
        }
      },
      response: {
        status: 200
      }
    }]);

    await expect(oauth.logout()).resolves.toEqual(true);
    expect(oauth.accessToken).toBeNull();
    expect(oauth.refreshToken).toBeNull();
    expect(oauth.grantedScopes).toBeNull();
    expect(oauth.expires).toBeNull();
    fetchMocks.expectFetchCount();
  });

  test("/w accessToken", async () => {
    oauth.accessToken = "accessToken";
    oauth.expires = new Date("2021-12-31");

    let fetchMocks = new FetchMocks([{
      request: {
        method: "POST",
        url: "https://oauth2.googleapis.com/revoke",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: {
          token: "accessToken"
        }
      },
      response: {
        status: 200
      }
    }]);

    await expect(oauth.logout()).resolves.toEqual(true);
    expect(oauth.accessToken).toBeNull();
    expect(oauth.refreshToken).toBeNull();
    expect(oauth.grantedScopes).toBeNull();
    expect(oauth.expires).toBeNull();
    fetchMocks.expectFetchCount();
  });

  test("error", async () => {
    let fetchMocks = new FetchMocks([{
      request: {
        method: "POST",
        url: "https://oauth2.googleapis.com/revoke",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: {
          token: "null"
        }
      },
      response: {
        status: 400
      }
    }]);

    await expect(oauth.logout()).resolves.toEqual(false);
    expect(oauth.accessToken).toBeNull();
    expect(oauth.refreshToken).toBeNull();
    expect(oauth.grantedScopes).toBeNull();
    expect(oauth.expires).toBeNull();
    fetchMocks.expectFetchCount();
  });
});
