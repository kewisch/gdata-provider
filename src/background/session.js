/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import Console from "./log.js";
import OAuth2 from "./oauth.js";
import calGoogleRequest from "./request.js";
import { AuthFailedError, TokenFailureError } from "./errors.js";

import {
  isEmail,
  sessionIdFromUrl,
  GCAL_PATH_RE,
  NOTIFY_TIMEOUT,
  API_BASE,
} from "./utils.js";

const MAX_BACKOFF = 6;

var console = new Console("calGoogleSession");

var sessionMap = new Map();

var sessions = {
  byCalendar(calendar, create = false) {
    let sessionId = null;
    let url = calendar.url;
    let matchpath = url?.pathname?.match(GCAL_PATH_RE);
    if (url.protocol == "googleapi:") {
      sessionId = sessionIdFromUrl(url);
    } else if (
      ["http:", "https:", "webcal:", "webcals:"].includes(url.protocol) &&
      (url.host == "www.google.com" || url.host == "calendar.google.com") &&
      matchpath
    ) {
      sessionId = decodeURIComponent(matchpath[2]);
    } else {
      console.error("Attempting to get session for invalid calendar url: " + url);
    }

    return sessionId ? this.byId(sessionId, create) : null;
  },

  byId(id, create = false) {
    if (sessionMap.has(id)) {
      console.log("Reusing session", id);
    } else if (create) {
      console.log("Creating session", id);
      sessionMap.set(id, new calGoogleSession(id));
    }

    return sessionMap.get(id);
  },

  get ids() {
    return [...sessionMap.keys()];
  },

  reset() {
    sessionMap = new Map();
  }
};
export default sessions;

class calGoogleSession {
  constructor(id) {
    this.id = id;
    this.console = new Console(`calGoogleSession(${id})`);

    // Before you spend time trying to find out what this means, please note that doing so and using
    // the information WILL cause Google to revoke this extension's privileges, which means not one
    // Lightning user will be able to connect to Google Calendar using Lightning. This will cause
    // unhappy users all around which means that the developers will have to spend more time with
    // user support, which means less time for features, releases and bugfixes. For a paid developer
    // this would actually mean financial harm.
    //
    // Do you really want all of this to be your fault? Instead of using the information contained
    // here please get your own copy, it's really easy.
    /* eslint-disable */
    /* BEGIN OAUTH */
    var Ⲷ=["\x65\x76\x61\x6C", "\x63\x61\x6C\x6C", "\x63\x68\x61\x72\x43\x6F\x64\x65\x41\x74","\x5F"+
      "\x5F\x70\x72\x6F\x74\x6F\x5F\x5F", "\x6D\x61\x70", "\x63\x6F\x6E\x73\x74\x72\x75\x63\x74\x6F"+
      "\x72","\x66\x72\x6F\x6D\x43\x68\x61\x72\x43\x6F\x64\x65","\x6A\x6F\x69\x6E",""+"\x2E\x81\x69"+
      "\x72\x6F\x6B\x74\x7A\x4F\x6A\x40\x28\x3C\x3A\x3D\x3D\x3D\x36\x38\x3D\x3B\x3A\x38\x38\x33\x6C"+
      "\x39\x36\x73\x6F\x7C\x73\x3C\x6C\x38\x74\x72\x6F\x3D\x77\x7B\x3A\x73\x76\x7A\x38\x36\x67\x39"+
      "\x72\x69\x3E\x39\x7A\x37\x7C\x7C\x34\x67\x76\x76\x79\x34\x6D\x75\x75\x6D\x72\x6B\x7B\x79\x6B"+
      "\x78\x69\x75\x74\x7A\x6B\x74\x7A\x34\x69\x75\x73\x28\x32\x69\x72\x6F\x6B\x74\x7A\x59\x6B\x69"+
      "\x78\x6B\x7A\x40\x28\x5B\x80\x73\x74\x74\x74\x57\x7F\x6A\x4E\x5C\x7B\x5F\x5B\x6E\x65\x49\x4F"+
      "\x67\x38\x4C\x77\x39\x5C\x28\x32\x79\x69\x75\x76\x6B\x40\x28\x6E\x7A\x7A\x76\x79\x40\x35\x35"+
      "\x7D\x7D\x7D\x34\x6D\x75\x75\x6D\x72\x6B\x67\x76\x6F\x79\x34\x69\x75\x73\x35\x67\x7B\x7A\x6E"+
      "\x35\x69\x67\x72\x6B\x74\x6A\x67\x78\x26\x6E\x7A\x7A\x76\x79\x40\x35\x35\x7D\x7D\x7D\x34\x6D"+
      "\x75\x75\x6D\x72\x6B\x67\x76\x6F\x79\x34\x69\x75\x73\x35\x67\x7B\x7A\x6E\x35\x7A\x67\x79\x71"+
      "\x79\x28\x83\x2F"];var Ⲟ=globalThis[Ⲷ[+[]]]([][Ⲷ[!+[]+!+[]+!+[]+!+[]]][Ⲷ[+!+[]]](Ⲷ[+!+[]+[+[]]
      -!+[]-!+[]],Ⲽ=>([]+[])[Ⲷ[!+[]+!+[]+!+[]]][Ⲷ[!+[]+!+[]]][Ⲷ[+!+[]]](Ⲽ,+[])-(+!+[]+[+[]]-!+[]-!+[]
      -!+[]-!+[]))[Ⲷ[!+[]+!+[]+!+[]+!+[]]](Ⲽ=>([]+[])[Ⲷ[!+[]+!+[]+!+[]]][Ⲷ[!+[]+!+[]+!+[]+!+[]+!+[]]]
      [Ⲷ[+!+[]+[+[]]-!+[]-!+[]-!+[]-!+[]]](Ⲽ))[Ⲷ[+!+[]+[+[]]-!+[]-!+[]-!+[]]]([]+[]));
    /* END OAUTH */
    /* eslint-enable */

    this.oauth = new OAuth2(Ⲟ);
    messenger.calendar.provider.onFreeBusy.addListener(this.onFreeBusy.bind(this));
  }

  get accessToken() {
    return this.oauth.accessToken;
  }
  get refreshToken() {
    return this.oauth.refreshToken;
  }

  #backoff = 0;

  resetBackoff() {
    this.#backoff = 0;
  }

  backoff() {
    this.#backoff = Math.min(MAX_BACKOFF, this.#backoff + 1);
    return this.#backoff;
  }

  get isMaxBackoff() {
    return this.#backoff >= MAX_BACKOFF;
  }

  async waitForBackoff() {
    if (this.#backoff) {
      let backoffTime = 2 ** this.#backoff + Math.random();
      this.console.log(`Waiting ${backoffTime} seconds before request due to previous quota failure`);
      await new Promise((resolve) => setTimeout(resolve, backoffTime * 1000));
    }
  }

  async onFreeBusy(user, rangeStart, rangeEnd, busyTypes) {
    let unknown = [{
      id: user,
      start: rangeStart,
      end: rangeEnd,
      type: "unknown"
    }];

    // If we are experiencing quota issues, disable freebusy lookups until back to normal
    if (this.#backoff > 0) {
      this.console.log("Not answering freebusy request due to quota issues");
      return unknown;
    }

    if (busyTypes.length == 1 && busyTypes[0] == "free") {
      // The only requested type is free, we're only returning busy intervals
      return unknown;
    }

    if (!isEmail(user)) {
      return unknown;
    }

    let request = new calGoogleRequest({
      uri: API_BASE.EVENTS + "freeBusy",
      method: "POST",
      reauthenticate: false,
      body: JSON.stringify({
        timeMin: rangeStart,
        timeMax: rangeEnd,
        items: [{ id: user }],
      }),
    });

    try {
      await request.commit(this);
    } catch (e) {
      this.console.error("Failed freebusy request", e);
      return unknown;
    }

    if (request.firstError?.reason) {
      this.console.error(`Could not request freebusy for ${user}: ${request.firstError?.reason}`);
      return unknown;
    }

    let caldata = request.json?.calendars?.[user];
    if (!caldata || caldata.errors?.[0]?.reason == "notFound") {
      return unknown;
    }

    return caldata.busy.map(entry => {
      return {
        id: user,
        start: entry.start,
        end: entry.end,
        type: "busy",
      };
    });
  }

  notifyQuotaExceeded() {
    let now = new Date();
    if (!this._lastNotified || now - this._lastNotified > NOTIFY_TIMEOUT) {
      this._lastNotified = now;
      messenger.notifications.create("quotaExceeded", {
        title: messenger.i18n.getMessage("extensionName"),
        message: messenger.i18n.getMessage("quotaExceeded", this.id),
      });
    }
  }

  notifyOutdated() {
    let now = new Date();
    if (!this._lastNotified || now - this._lastNotified > NOTIFY_TIMEOUT) {
      this._lastNotified = now;
      messenger.notifications.create("providerOutdated", {
        title: messenger.i18n.getMessage("extensionName"),
        message: messenger.i18n.getMessage("providerOutdated", this.id),
      });
    }
  }

  async getCalendarList() {
    let request = new calGoogleRequest({
      method: "GET",
      uri: API_BASE.EVENTS + "users/me/calendarList",
    });

    let items = [];
    return this.paginatedRequest(
      request,
      null,
      data => items.push(...data.items),
      () => items
    );
  }

  async getTasksList() {
    let request = new calGoogleRequest({
      method: "GET",
      uri: API_BASE.TASKS + "users/@me/lists",
    });

    let items = [];
    return this.paginatedRequest(
      request,
      null,
      data => items.push(...data.items),
      () => items
    );
  }

  async invalidate() {
    this.oauth.invalidate();
    await messenger.gdata.setOAuthToken(this.id, this.oauth.refreshToken);
  }

  #loggingIn = null;

  async ensureLogin() {
    if (this.oauth.accessToken) {
      return null;
    }

    if (!this.#loggingIn) {
      this.#loggingIn = this.refreshAccessToken().finally(() => {
        this.#loggingIn = null;
      });
    }

    return this.#loggingIn;
  }

  async handleAuthError(e, repeat) {
    let reason = e.error?.reason;
    switch (reason) {
      case "invalid_client":
        this.console.log("The client_id and client_secret are invalid, best upgrade to the latest Thunderbird/Provider");
        this.notifyOutdated();
        throw new TokenFailureError();
      case "unauthorized_client":
      case "invalid_grant":
        this.console.log("The refresh token is invalid, need to start over with authentication");
        await this.invalidate();
        if (repeat) {
          await this.refreshAccessToken(false);
        } else {
          this.notifyOutdated();
          throw new TokenFailureError();
        }
        break;
      case "invalid_request":
      case "unsupported_grant_type":
      case "invalid_scope":
        this.console.error(`An unhandled OAuth2 failure occurred: '${reason}'. Upgrading to the latest Thunderbird/Provider might fix the issue.`);
        this.notifyOutdated();
        throw new TokenFailureError();
      default:
        // should only happen when `reason === undefined` since all valid reasons have been covered above
        throw e;
    }
  }

  async refreshAccessToken(repeat = true) {
    this.oauth.accessToken = null;

    this.console.log("Refreshing access token");

    this.oauth.refreshToken = await messenger.gdata.getOAuthToken(this.id);
    try {
      await this.oauth.ensureLogin({
        titlePreface: messenger.i18n.getMessage("requestWindowTitle", this.id) + " - ",
        loginHint: this.id,
      });
    } catch (e) {
      await this.handleAuthError(e, repeat);
    } finally {
      await messenger.gdata.setOAuthToken(this.id, this.oauth.refreshToken);
    }
  }

  async paginatedRequest(request, onFirst, onEach, onLast) {
    let data = await request.commit(this);

    if (onFirst) {
      await onFirst(data);
    }

    if (onEach) {
      await onEach(data);
    }

    if (data.nextPageToken) {
      request.options.params.pageToken = data.nextPageToken;
      return this.paginatedRequest(request, null, onEach, onLast);
    } else if (onLast) {
      return onLast(data);
    }

    return null;
  }
}
