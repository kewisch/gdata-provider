/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import Console from "./log.js";
import OAuth2 from "./oauth.js";
import calGoogleRequest from "./request.js";

import {
  isEmail,
  fromRFC3339,
  toRFC3339,
  sessionIdFromUrl,
  UTC,
  GCAL_PATH_RE,
  NOTIFY_TIMEOUT,
  API_BASE,
} from "./utils.js";

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
      url.host == "www.google.com" &&
      matchpath
    ) {
      // TODO we need some sort of session id here, this is used for migrating ics calendars
      // let googleCalendarName = aCalendar.getProperty("googleCalendarName");
      // let googleUser = Services.prefs.getStringPref(
      //  "calendar.google.calPrefs." + googleCalendarName + ".googleUser",
      //  null
      // );
      // sessionId = googleUser || googleCalendarName || cal.getUUID();
      sessionId = null;
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
};
export default sessions;

class calGoogleSession {
  constructor(id) {
    this.id = id;

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
    this.oauth = new OAuth2(Ⲟ);
    /* eslint-enable */

    messenger.calendar.provider.onFreeBusy.addListener(this.onFreeBusy.bind(this));
  }

  get accessToken() {
    return this.oauth.accessToken;
  }

  async onFreeBusy(user, rangeStart, rangeEnd, busyTypes) {
    // TODO what is busyTypes
    let mailtoUser = user.substr(7);
    if (!user.startsWith("mailto:") || !isEmail(mailtoUser)) {
      return [];
    }

    let request = new calGoogleRequest({
      uri: API_BASE.EVENTS + "freeBusy",
      method: "POST",
      reauthenticate: false,
      body: JSON.stringify({
        timeMin: toRFC3339(rangeStart),
        timeMax: toRFC3339(rangeEnd),
        items: [{ id: mailtoUser }],
      }),
    });

    try {
      await request.commit(this);
    } catch (e) {
      console.error("Failed freebusy request", e);
      return [];
    }

    if (request.firstError?.reason) {
      console.error(`Could not request freebusy for ${mailtoUser}: ${request.firstError?.reason}`);
      return [];
    }

    let caldata = request.json?.calendars?.[mailtoUser];
    if (!caldata) {
      console.error("Invalid freebusy response", request.json);
      return [];
    }

    return caldata.busy.map(entry => {
      return {
        id: mailtoUser,
        start: fromRFC3339(entry.start, UTC),
        end: fromRFC3339(entry.end, UTC),
        type: "BUSY",
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

  async ensureLogin() {
    if (this.oauth.accessToken) {
      return null;
    }

    if (!this._loggingIn) {
      this._loggingIn = this.login().finally(() => {
        this._loggingIn = null;
      });
    }

    return this._loggingIn;
  }

  async login() {
    this.oauth.accessToken = null;

    console.log(`No access token for ${this.id}, refreshing token`);

    this.oauth.refreshToken = await messenger.gdata.getOAuthToken(this.id);
    await this.oauth.ensureLogin({
      titlePreface: messenger.i18n.getMessage("requestWindowTitle", this.id) + " - ",
      loginHint: this.id,
    });
    await messenger.gdata.setOAuthToken(this.id, this.oauth.refreshToken);

    /* TODO doing this in request already, find a good spot
    } catch (e) {
      console.log("Failed to acquire a new OAuth token for", this.id, e);

      if (error == "invalid_client" || error == "http_401") {
        this.notifyOutdated();
      } else if (error == "unauthorized_client" || error == "invalid_grant") {
        console.error(`Token for ${this.id} is no longer authorized`);
        this.invalidate();
        await this.login();
        return;
      }

      throw e;
    }
    */
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
