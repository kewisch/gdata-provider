/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

export default class OAuth2 {
  AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  APPROVAL_URL = "https://accounts.google.com/o/oauth2/approval/v2";
  TOKEN_URL = "https://oauth2.googleapis.com/token";
  LOGOUT_URL = "https://oauth2.googleapis.com/revoke";
  CALLBACK_URL = "http://localhost/";

  EXPIRE_GRACE_SECONDS = 60;
  WINDOW_WIDTH = 430;
  WINDOW_HEIGHT = 750;

  constructor({ clientId, clientSecret, scope, refreshToken = null, accessToken = null }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.scope = scope;
    this.refreshToken = refreshToken;
    this.accessToken = accessToken;
    this.expires = null;
    this.grantedScopes = null;
  }

  get expired() {
    return !this.expires || Date.now() > this.expires;
  }

  get accessToken() {
    if (this.expired) {
      this._accessToken = null;
    }

    return this._accessToken;
  }
  set accessToken(val) {
    this._accessToken = val;
  }

  /*
  async _approvalUrlViaTabs(wnd) {
    return new Promise((resolve, reject) => {
      let tabListener = (tabId, changeInfo) => {
        if (changeInfo.url) {
          browser.tabs.onUpdated.removeListener(tabListener);
          browser.windows.onRemoved.removeListener(windowListener);
          resolve(new URL(changeInfo.url));
        }
      };

      let windowListener = windowId => {
        if (windowId == wnd.id) {
          browser.tabs.onUpdated.removeListener(tabListener);
          browser.windows.onRemoved.removeListener(windowListener);
          reject({ error: "canceled" });
        }
      };

      browser.windows.onRemoved.addListener(windowListener);
      browser.tabs.onUpdated.addListener(tabListener, {
        urls: [this.APPROVAL_URL + "*"],
        windowId: wnd.id,
      });
    });
  }
  */

  async _approvalUrlViaWebRequest(wnd) {
    return new Promise((resolve, reject) => {
      let listener = details => {
        browser.webRequest.onBeforeRequest.removeListener(listener);
        browser.windows.onRemoved.removeListener(windowListener);
        resolve(new URL(details.url));
      };

      let windowListener = windowId => {
        if (windowId == wnd.id) {
          browser.webRequest.onBeforeRequest.removeListener(listener);
          browser.windows.onRemoved.removeListener(windowListener);
          reject({ error: "canceled" });
        }
      };

      browser.windows.onRemoved.addListener(windowListener);
      browser.webRequest.onBeforeRequest.addListener(listener, {
        urls: [this.CALLBACK_URL + "*", this.APPROVAL_URL + "*"],
        windowId: wnd.id,
      });
    });
  }

  async login({ titlePreface = "", loginHint = "" }) {
    // Create a window initiating the OAuth2 login process
    let params = new URLSearchParams({
      client_id: this.clientId,
      scope: this.scope,
      response_type: "code",
      redirect_uri: this.CALLBACK_URL,
      login_hint: loginHint,
      hl: browser.i18n.getUILanguage(), // eslint-disable-line id-length
    });

    let wnd = await browser.windows.create({
      titlePreface: titlePreface,
      type: "popup",
      url: this.AUTH_URL + "?" + params,
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT,
    });

    // Wait for the approval request to settle. There are two ways to do this: via the tabs
    // permission, or via webRequest. Use the method that uses the least amount of extra
    // permissions.
    let approvalUrl = await this._approvalUrlViaWebRequest(wnd);
    await browser.windows.remove(wnd.id);

    // Turn the approval code into the refresh and access tokens
    params = new URLSearchParams(approvalUrl.search);

    if (params.get("error")) {
      throw { error: params.get("error") };
    }

    let response = await fetch(this.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: params.get("code"),
        grant_type: "authorization_code",
        redirect_uri: this.CALLBACK_URL,
      }),
    });

    let details;

    try {
      details = await response.json();
    } catch (e) {
      throw { error: "request_error", code: response.status };
    }

    if (!response.ok) {
      throw details || { error: "request_error", code: response.status };
    }

    this.accessToken = details.access_token;
    this.refreshToken = details.refresh_token;
    this.grantedScopes = details.scope;
    this.expires = new Date(Date.now() + 1000 * (details.expires_in - this.EXPIRE_GRACE_SECONDS));
  }

  async refresh(force = false) {
    if (!force && !this.expired) {
      return;
    }

    let response = await fetch(this.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      }),
    });

    let details;

    try {
      details = await response.json();
    } catch (e) {
      throw { error: "request_error", code: response.status };
    }

    if (!response.ok) {
      throw details || { error: "request_error", code: response.status };
    }

    this.accessToken = details.access_token;
    this.expires = new Date(Date.now() + 1000 * (details.expires_in - this.EXPIRE_GRACE_SECONDS));
    this.grantedScopes = details.scope;
  }

  async ensureLogin(loginOptions) {
    if (this.expired && this.refreshToken) {
      await this.refresh();
    }

    if (!this.accessToken) {
      await this.login(loginOptions);
    }
  }

  invalidate() {
    this.accessToken = null;
    this.refreshToken = null;
    this.grantedScopes = null;
    this.expires = null;
  }

  async logout() {
    let token = this.expired ? this.refreshToken : this.accessToken;
    this.invalidate();

    let response = await fetch(this.LOGOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ token }),
    });

    return response.ok;
  }
}
