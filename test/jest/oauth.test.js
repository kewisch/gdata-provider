import jestFetchMock from "jest-fetch-mock";
jestFetchMock.enableFetchMocks();

import OAuth2 from "../../src/background/oauth";
import { jest } from "@jest/globals";
import createMessenger from "./webext-api";

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
    fetch.mockResponseOnce(
      JSON.stringify({
        access_token: "accessToken",
        refresh_token: "refreshToken",
        scope: "scope",
        expires_in: 86400,
      })
    );

    global.browser.webRequest.onBeforeRequest.mockResponse({
      url: oauth.APPROVAL_URL + "?response=ok&approvalCode=approvalCode",
    });

    await oauth.login({
      titlePreface: "preface",
      loginHint: "hint",
    });

    expect(browser.webRequest.onBeforeRequest.addListener).toHaveBeenCalled();
    expect(browser.webRequest.onBeforeRequest.addListener.mock.calls[0][1]).toEqual({
      urls: [oauth.APPROVAL_URL + "*"],
      windowId: "windowId",
    });

    expect(browser.windows.remove).toHaveBeenCalledWith("windowId");
    expect(browser.windows.create).toHaveBeenCalledWith({
      titlePreface: "preface",
      type: "popup",
      url:
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=clientId&scope=scope&response_type=code&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob%3Aauto&login_hint=hint&hl=klingon",
      width: oauth.WINDOW_WIDTH,
      height: oauth.WINDOW_HEIGHT,
    });

    expect(oauth.accessToken).toBe("accessToken");
    expect(oauth.refreshToken).toBe("refreshToken");
    expect(oauth.grantedScopes).toBe("scope");
    expect(oauth.expires).toEqual(
      new Date(new Date("2021-01-02") - 1000 * oauth.EXPIRE_GRACE_SECONDS)
    );
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
      url: oauth.APPROVAL_URL + "?response=error%3DerrorCode",
    });

    await expect(oauth.login({})).rejects.toEqual({ error: "errorCode" });

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
    ).rejects.toEqual({ error: "request_error", code: 500 });

    expect(oauth.accessToken).toBe(null);
    expect(oauth.refreshToken).toBe(null);
    expect(oauth.grantedScopes).toBe(null);
    expect(oauth.expires).toBe(null);
  });

  test("fetch response error json detail", async () => {
    fetch.mockResponseOnce(JSON.stringify({ error: "from_response" }), { status: 500 });

    global.browser.webRequest.onBeforeRequest.mockResponse({
      url: oauth.APPROVAL_URL + "?response=ok&approvalCode=approvalCode",
    });

    await expect(
      oauth.login({
        titlePreface: "preface",
        loginHint: "hint",
      })
    ).rejects.toEqual({ error: "from_response" });

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

    await expect(oauth.refresh(true)).rejects.toEqual({ error: "error" });

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

    await expect(oauth.refresh(true)).rejects.toEqual({ error: "request_error", code: 500 });

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
    fetch.mockResponseOnce(null);

    await oauth.logout();

    expect(fetch).toHaveBeenCalled();
    expect(fetch.mock.calls[0][0]).toBe(oauth.LOGOUT_URL);
    expect(fetch.mock.calls[0][1].body.toString()).toEqual("token=refreshToken");
  });

  test("/w accessToken", async () => {
    oauth.accessToken = "accessToken";
    oauth.expires = new Date("2021-12-31");
    fetch.mockResponseOnce(null);

    await oauth.logout();

    expect(fetch).toHaveBeenCalled();
    expect(fetch.mock.calls[0][0]).toBe(oauth.LOGOUT_URL);
    expect(fetch.mock.calls[0][1].body.toString()).toEqual("token=accessToken");
  });
});
