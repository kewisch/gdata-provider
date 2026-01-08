/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals OAUTH_BASE_URI, OAUTH_SCOPE, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET */

var { defineGdataModuleGetters } = ChromeUtils.importESModule(
  "resource://gdata-provider/legacy/modules/gdataUI.sys.mjs?bump=3"
);

var lazy = {};

/* global calGoogleRequest, API_BASE, cal, LOGinterval, OAuth2 */
ChromeUtils.defineESModuleGetters(lazy, {
  cal: "resource:///modules/calendar/calUtils.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

defineGdataModuleGetters(lazy, {
  calGoogleRequest: "resource://gdata-provider/legacy/modules/old/gdataRequest.sys.mjs",
  API_BASE: "resource://gdata-provider/legacy/modules/old/gdataRequest.sys.mjs",
  LOG: "resource://gdata-provider/legacy/modules/old/gdataLogging.sys.mjs",
  LOGerror: "resource://gdata-provider/legacy/modules/old/gdataLogging.sys.mjs",
  LOGinterval: "resource://gdata-provider/legacy/modules/old/gdataLogging.sys.mjs",
  getMessenger: "resource://gdata-provider/legacy/modules/old/gdataUtils.sys.mjs",
  OAuth2: "resource://gdata-provider/legacy/modules/old/OAuth2.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "messenger", () => {
  return lazy.getMessenger();
});

var NOTIFY_TIMEOUT = 60 * 1000;

var gdataSessionMap = new Map();
var calGoogleSessionManager = {
  /**
   * Get a Session object for the specified calendar. If aCreate is false,
   * null will be returned if the session doesn't exist. Otherwise, the
   * session will be created.
   *
   * @param aCalendar  The calendar to get the session for.
   * @param aCreate    If true, the session will be created prior to returning.
   * @return           The initialized session object.
   */
  getSessionByCalendar: function(aCalendar, aCreate) {
    let id = null;
    let uri = aCalendar.uri;
    let host = (function() {
      try {
        return uri.host;
      } catch (e) {
        return null;
      }
    })();
    const protocols = ["http", "https", "webcal", "webcals"];

    if (aCalendar.type != "gdata") {
      return null;
    }

    if (uri.schemeIs("googleapi")) {
      let fullUser, path;
      if (uri.pathQueryRef.substr(0, 2) == "//") {
        // TB128 COMPAT
        [fullUser, path] = uri.pathQueryRef.substr(2).split("/", 2);
      } else {
        [, fullUser] = uri.prePath.split("//", 2);
        path = uri.pathQueryRef.substr(1);
      }

      id = fullUser || lazy.cal.getUUID();
    } else if (
      host == "www.google.com" &&
      uri.pathQueryRef.startsWith("/calendar/feeds") &&
      protocols.some(scheme => uri.schemeIs(scheme))
    ) {
      let googleCalendarName = aCalendar.getProperty("googleCalendarName");
      let googleUser = Services.prefs.getStringPref(
        "calendar.google.calPrefs." + googleCalendarName + ".googleUser",
        null
      );
      id = googleUser || googleCalendarName || lazy.cal.getUUID();
    }

    return id ? this.getSessionById(id, aCreate) : null;
  },

  getSessionById: function(aSessionId, aCreate) {
    // Check if the session exists
    if (gdataSessionMap.has(aSessionId)) {
      lazy.LOG("[calGoogleSessionManager] Reusing session " + aSessionId);
    } else if (aCreate) {
      lazy.LOG("[calGoogleSessionManager] Creating session " + aSessionId);
      gdataSessionMap.set(aSessionId, new calGoogleSession(aSessionId));
    }

    return gdataSessionMap.get(aSessionId);
  },
};
export function getGoogleSessionManager() {
  return calGoogleSessionManager;
}

/**
 * calGoogleSession
 * This Implements a Session object to communicate with google
 *
 * @constructor
 * @class
 * @param aId       The ID for the new session.
 */
function calGoogleSession(aId) {
  this.mId = aId;
  this.wrappedJSObject = this;

  this.setupOAuth();

  // Register a freebusy provider for this session
  lazy.cal.freeBusyService.addProvider(this);
}

calGoogleSession.prototype = {
  mId: null,
  mSessionID: null,
  mLoginPromise: null,

  QueryInterface: ChromeUtils.generateQI(["calIFreeBusyProvider"]),

  get id() {
    return this.mId;
  },

  notifyQuotaExceeded: function() {
    let now = new Date();
    if (!this.mLastNotified || now - this.mLastNotified > NOTIFY_TIMEOUT) {
      this.mLastNotified = now;
      let title = lazy.messenger.i18n.getMessage("extensionName");
      let quotaString = lazy.messenger.i18n.getMessage("quotaExceeded", this.id);
      Services.prompt.alert(lazy.cal.window.getCalendarWindow(), title, quotaString);
    } else {
      lazy.LOG(
        "[calGoogleCalendar] Throttling quota notification, last was " +
          (now - this.mLastNotified) +
          " ms ago"
      );
    }
  },

  notifyOutdated: function() {
    let now = new Date();
    if (!this.mLastNotified || now - this.mLastNotified > NOTIFY_TIMEOUT) {
      this.mLastNotified = now;
      let title = lazy.messenger.i18n.getMessage("extensionName");
      let outdatedString = lazy.messenger.i18n.getMessage("providerOutdated");
      Services.prompt.alert(lazy.cal.window.getCalendarWindow(), title, outdatedString);
    } else {
      lazy.LOG(
        "[calGoogleCalendar] Throttling outdated notification, last was " +
          (now - this.mLastNotified) +
          " ms ago"
      );
    }
  },

  setupOAuth: function() {
    let sessionId = this.mId;
    let authDescr = lazy.messenger.i18n.getMessage("requestWindowDescription", sessionId);
    let authTitle = lazy.messenger.i18n.getMessage("requestWindowTitle", sessionId);
    let locale =
      typeof Services.locale.requestedLocale === "undefined"
        ? Services.locale.getRequestedLocale()
        : Services.locale.requestedLocale;

    // Before you spend time trying to find out what this means, please note that
    // doing so and using the information WILL cause Google to revoke this
    // extension's privileges, which means not one Thunderbird user will be able to
    // connect to Google Calendar using this extension. This will cause unhappy users
    // all around which means that the developers will have to spend more time with
    // user support, which means less time for features, releases and bugfixes.
    // For a paid developer this would actually mean financial harm.
    //
    // Do you really want all of this to be your fault? Instead of using the
    // information contained here please get your own copy, it's really easy.
    /* eslint-disable */
    /* BEGIN OAUTH */
    var Ⲷ=["\x65\x76\x61\x6C","\x63\x61\x6C\x6C","\x63\x68\x61\x72\x43\x6F\x64\x65\x41\x74","\x5F"+
      "\x5F\x70\x72\x6F\x74\x6F\x5F\x5F","\x6D\x61\x70","\x63\x6F\x6E\x73\x74\x72\x75\x63\x74\x6F"+
      "\x72","\x66\x72\x6F\x6D\x43\x68\x61\x72\x43\x6F\x64\x65","\x6A\x6F\x69\x6E"];var Ⲟ=globalThis
      [Ⲷ[0]]([][Ⲷ[!+[]+!+[]+!+[]+!+[]]][Ⲷ[+!+[]]]("\x2E\x81\x69\x72\x6F\x6B\x74\x7A\x4F\x6A\x40\x28"+
      "\x3C\x3A\x3D\x3D\x3D\x36\x38\x3D\x3B\x3A\x38\x38\x33\x6C\x39\x36\x73\x6F\x7C\x73\x3C\x6C\x38"+
      "\x74\x72\x6F\x3D\x77\x7B\x3A\x73\x76\x7A\x38\x36\x67\x39\x72\x69\x3E\x39\x7A\x37\x7C\x7C\x34"+
      "\x67\x76\x76\x79\x34\x6D\x75\x75\x6D\x72\x6B\x7B\x79\x6B\x78\x69\x75\x74\x7A\x6B\x74\x7A\x34"+
      "\x69\x75\x73\x28\x32\x69\x72\x6F\x6B\x74\x7A\x59\x6B\x69\x78\x6B\x7A\x40\x28\x5B\x80\x73\x74"+
      "\x74\x74\x57\x7F\x6A\x4E\x5C\x7B\x5F\x5B\x6E\x65\x49\x4F\x67\x38\x4C\x77\x39\x5C\x28\x32\x79"+
      "\x69\x75\x76\x6B\x40\x28\x6E\x7A\x7A\x76\x79\x40\x35\x35\x7D\x7D\x7D\x34\x6D\x75\x75\x6D\x72"+
      "\x6B\x67\x76\x6F\x79\x34\x69\x75\x73\x35\x67\x7B\x7A\x6E\x35\x69\x67\x72\x6B\x74\x6A\x67\x78"+
      "\x26\x6E\x7A\x7A\x76\x79\x40\x35\x35\x7D\x7D\x7D\x34\x6D\x75\x75\x6D\x72\x6B\x67\x76\x6F\x79"+
      "\x34\x69\x75\x73\x35\x67\x7B\x7A\x6E\x35\x7A\x67\x79\x71\x79\x28\x83\x2F",Ⲽ=>([]+[])[Ⲷ[!+[]+!+
      []+!+[]]][Ⲷ[!+[]+!+[]]][Ⲷ[+!+[]]](Ⲽ,+[])-(+!+[]+[+[]]-!+[]-!+[]-!+[]-!+[]))[Ⲷ[!+[]+!+[]+!+[]+!+
      []]](Ⲽ=>([]+[])[Ⲷ[!+[]+!+[]+!+[]]][Ⲷ[!+[]+!+[]+!+[]+!+[]+!+[]]][Ⲷ[+!+[]+[+[]]-!+[]-!+[]-!+[]-!+
      []]](Ⲽ))[Ⲷ[+!+[]+[+[]]-!+[]-!+[]-!+[]]]([]+[]))
    /* END OAUTH */
    /* eslint-enable */

    this.oauth = new lazy.OAuth2(Ⲟ);
    this.oauth.extraAuthParams = [
      ["login_hint", sessionId],
      // Use application locale for login dialog
      ["hl", locale],
    ];
    this.oauth.requestWindowURI = "chrome://gdata-provider/content/old/browserRequest.xhtml";
    this.oauth.requestWindowFeatures = "chrome,private,centerscreen,width=430,height=750";
    this.oauth.requestWindowTitle = authTitle;
    this.oauth.requestWindowDescription = authDescr;

    // Overwrite the refreshToken attribute, since we want to save it in
    // the password manager
    let pwMgrId = "Google Calendar OAuth Token";
    Object.defineProperty(this.oauth, "refreshToken", {
      get: function() {
        if (!this.mRefreshToken) {
          let pass = { value: null };
          try {
            let origin = "oauth:" + sessionId;
            lazy.cal.auth.passwordManagerGet(sessionId, pass, origin, pwMgrId);
          } catch (e) {
            // User might have cancelled the master password prompt, that's ok
            if (e.result != Cr.NS_ERROR_ABORT) {
              throw e;
            }
          }
          this.mRefreshToken = pass.value;
        }
        return this.mRefreshToken;
      },
      set: function(val) {
        try {
          let origin = "oauth:" + sessionId;
          if (val) {
            lazy.cal.auth.passwordManagerSave(sessionId, val, origin, pwMgrId);
          } else {
            lazy.cal.auth.passwordManagerRemove(sessionId, origin, pwMgrId);
          }
        } catch (e) {
          // User might have cancelled the master password prompt, or password saving
          // could be disabled. That is ok, throw for everything else.
          if (e.result != Cr.NS_ERROR_ABORT && e.result != Cr.NS_ERROR_NOT_AVAILABLE) {
            throw e;
          }
        }
        this.mRefreshToken = val;
      },
      enumerable: true,
    });

    // If the user has disabled cookies, we need to add an exception for Google so authentication
    // works. If the user has explicitly blocked google.com then we won't overwrite the rule though.
    if (Services.prefs.getIntPref("network.cookie.cookieBehavior") == 2) {
      let googlePrincipal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(
        "https://google.com"
      );

      let action = Services.perms.testPermissionFromPrincipal(googlePrincipal, "cookie");
      if (action == Ci.nsIPermissionManager.UNKNOWN_ACTION) {
        Services.perms.addFromPrincipal(
          googlePrincipal,
          "cookie",
          Ci.nsIPermissionManager.ALLOW_ACTION
        );
      }
    }
  },

  get accessToken() {
    return this.oauth.accessToken;
  },
  get refreshToken() {
    return this.oauth.refreshToken;
  },
  set refreshToken(val) {
    this.oauth.refreshToken = val;
  },

  /**
   * Resets the access token, it will be re-retrieved on the next request.
   */
  invalidate: function() {
    lazy.LOG(
      "[calGoogleSession] Invalidating session " +
        this.mId +
        ", will reauthenticate on next request"
    );
    this.oauth.accessToken = null;
  },

  /**
   * Returns a promise resolved when the login is complete.
   */
  login: function() {
    if (this.mLoginPromise) {
      return this.mLoginPromise;
    }
    let deferred = Promise.withResolvers();

    try {
      // Start logging in
      lazy.LOG("[calGoogleCalendar] Logging in session " + this.mId);
      let accessToken = this.accessToken;

      let authSuccess = function() {
        lazy.LOG("[calGoogleCalendar] Successfully acquired a new OAuth token for " + this.mId);
        deferred.resolve(this.accessToken);
      }.bind(this);

      let authFailed = function(aData) {
        lazy.LOG(
          "[calGoogleCalendar] Failed to acquire a new" +
            " OAuth token for " +
            this.mId +
            " data: " +
            aData
        );

        let error = null;
        if (aData) {
          let dataObj;
          try {
            dataObj = JSON.parse(aData);
          } catch (e) {
            // Ok if parsing fails
          }
          error = dataObj && dataObj.error;
        }

        if (error == "invalid_client" || error == "http_401") {
          this.notifyOutdated();
        } else if (error == "rate_limit_exceeded") {
          lazy.LOGerror(`[calGoogleSession] Rate limit for ${this.mId} exceeded`);
          this.notifyQuotaExceeded();
        } else if (error == "unauthorized_client") {
          lazy.LOGerror("[calGoogleSession] Token for " + this.mId + " is no longer authorized");
          // We need to trigger a login without access token but want
          // to login result to the original promise handlers. First
          // reset the login promise so that we don't just receive
          // the existing token from calling login() again. Then set
          // a new login promise in case of another handler.
          this.oauth.accessToken = null;
          this.mLoginPromise = null;
          this.mLoginPromise = this.login().then(deferred.resolve, deferred.reject);
          return;
        } else {
          lazy.LOGerror("[calGoogleSession] Authentication failure: " + aData);
        }
        deferred.reject(new Components.Exception(error));
      }.bind(this);

      let connect = function() {
        // Use the async prompter to avoid multiple master password prompts
        let self = this;
        let promptlistener = {
          onPromptStartAsync: function(callback) {
            this.onPromptAuthAvailable(callback);
          },
          onPromptAuthAvailable: function(callback) {
            self.oauth.connect(
              () => {
                authSuccess();
                if (callback) {
                  callback.onAuthResult(true);
                }
              },
              error => {
                authFailed(error);
                if (callback) {
                  callback.onAuthResult(false);
                }
              },
              true
            );
          },
          onPromptCanceled: authFailed,
          onPromptStart: function() {},
        };
        let asyncprompter = Cc["@mozilla.org/messenger/msgAsyncPrompter;1"].getService(
          Ci.nsIMsgAsyncPrompter
        );
        asyncprompter.queueAsyncAuthPrompt("googleapi://" + this.id, false, promptlistener);
      }.bind(this);

      if (accessToken) {
        deferred.resolve(accessToken);
      } else {
        lazy.LOG("[calGoogleCalendar] No access token for " + this.mId + ", refreshing token");
        // bug 901329: If the calendar window isn't loaded yet the
        // master password prompt will show just the buttons and
        // possibly hang. If we postpone until the window is loaded,
        // all is well.
        lazy.setTimeout(function postpone() {
          let win = lazy.cal.window.getCalendarWindow();
          if (!win || win.document.readyState != "complete") {
            lazy.setTimeout(postpone, 400);
          } else {
            connect();
          }
        }, 0);
      }
    } catch (e) {
      // If something went wrong, reset the login state just in case
      lazy.LOG("[calGoogleCalendar] Error Logging In: " + e);
      deferred.reject(e);
    }
    return deferred.promise.then(
      accessToken => {
        this.mLoginPromise = null;
        return accessToken;
      },
      e => {
        this.mLoginPromise = null;
        throw e;
      }
    );
  },

  /**
   * asyncItemRequest
   * get or post an Item from or to Google using the Queue.
   *
   * @param aRequest          The Request Object. This is an instance of
   *                          calGoogleRequest.
   */
  asyncItemRequest: function(aRequest) {
    let tokenExpiresIn = Math.floor((this.oauth.tokenExpires - new Date().getTime()) / 1000);
    if (tokenExpiresIn < 0 && !this.mLoginPromise) {
      lazy.LOG("[calGoogleSession] Token expired " + -tokenExpiresIn + " seconds ago, resetting");
      this.oauth.accessToken = null;
    }

    if (this.accessToken) {
      // Already have a token, we can request directly. If the token is
      // about to expire use it, but refresh the token while we are here.
      if (tokenExpiresIn < 30 && !this.mLoginPromise) {
        lazy.LOG(
          "[calGoogleSession] Token will expire in " + tokenExpiresIn + " seconds, refreshing"
        );
        this.mLoginPromise = this.login();
        this.mLoginPromise.then(() => {
          lazy.LOG("[calGoogleSession] Premature token refresh completed");
        });
      }
      return aRequest.commit(this);
    } else if (this.mLoginPromise) {
      // We are logging in and have no token, queue the request
      lazy.LOG("[calGoogleSession] Adding item " + aRequest.uri + " to queue");
      return this.mLoginPromise.then(
        () => {
          return aRequest.commit(this);
        },
        e => {
          // If the user cancelled the login dialog, or we've exceeded the rate limit, then disable
          // the calendar until the next startup or manual enable.
          if (
            aRequest.calendar &&
            (e.message == "cancelled" || e.message == "rate_limit_exceeded")
          ) {
            aRequest.calendar.setProperty("disabled", true);
            aRequest.calendar.setProperty("auto-enabled", true);
            aRequest.calendar.setProperty("currentStatus", Cr.NS_ERROR_FAILURE);
          }

          throw e;
        }
      );
    } else {
      // Not logging in and no token, get the login promise and retry.
      this.mLoginPromise = this.login();
      return this.asyncItemRequest(aRequest);
    }
  },

  asyncPaginatedRequest: async function(aRequest, onFirst, onEach, onLast) {
    let data = await this.asyncItemRequest(aRequest);

    if (onFirst) {
      await onFirst(data);
    }

    if (onEach) {
      await onEach(data);
    }

    if (data.nextPageToken) {
      aRequest.addQueryParameter("pageToken", data.nextPageToken);
      return await this.asyncPaginatedRequest(aRequest, null, onEach, onLast);
    } else if (onLast) {
      return await onLast(data);
    }

    return null;
  },

  /**
   * calIFreeBusyProvider Implementation
   */
  getFreeBusyIntervals: function(aCalId, aRangeStart, aRangeEnd, aBusyTypes, aListener) {
    let completeSync = aIntervals => {
      lazy.LOG(
        "[calGoogleCalendar] Freebusy query for " +
          aCalId +
          "succeeded, returning " +
          aIntervals.length +
          " intervals"
      );
      aListener.onResult({ status: Cr.NS_OK }, aIntervals);
    };

    let failSync = (aStatus, aMessage) => {
      lazy.LOG(
        "[calGoogleCalendar] Freebusy query for " +
          aCalId +
          " failed (" +
          aStatus +
          "): " +
          aMessage
      );

      // Usually we would notify with a result, but this causes trouble
      // with Lightning 3.9 and older.
      aListener.onResult({ status: aStatus }, null);
    };

    if (
      !aCalId.includes("@") ||
      !aCalId.includes(".") ||
      !aCalId.toLowerCase().startsWith("mailto:")
    ) {
      // No valid email, screw it
      return failSync(Cr.NS_ERROR_FAILURE, null);
    }

    if (aRangeStart) {
      aRangeStart = aRangeStart.getInTimezone(lazy.cal.dtz.UTC);
      aRangeStart.isDate = false;
    }
    if (aRangeEnd) {
      aRangeEnd = aRangeEnd.getInTimezone(lazy.cal.dtz.UTC);
      aRangeEnd.isDate = false;
    }

    let rfcRangeStart = lazy.cal.dtz.toRFC3339(aRangeStart);
    let rfcRangeEnd = lazy.cal.dtz.toRFC3339(aRangeEnd);
    /* 7 is the length of "mailto:", we've asserted this above */
    let strippedCalId = aCalId.substr(7);

    let requestData = {
      timeMin: rfcRangeStart,
      timeMax: rfcRangeEnd,
      items: [{ id: strippedCalId }],
    };

    let request = new lazy.calGoogleRequest();
    request.type = request.ADD;
    request.calendar = null;
    request.uri = lazy.API_BASE.EVENTS + "freeBusy";
    request.reauthenticate = false;
    request.setUploadData("application/json; charset=UTF-8", JSON.stringify(requestData));

    // Request Parameters
    this.asyncItemRequest(request).then(
      aData => {
        if ("calendars" in aData && strippedCalId in aData.calendars) {
          let calData = aData.calendars[strippedCalId];
          let reason = calData.errors && calData.errors[0] && calData.errors[0].reason;
          if (reason) {
            lazy.LOG(
              "[calGoogleCalendar] Could not request freebusy for " + strippedCalId + ": " + reason
            );
            failSync(Cr.NS_ERROR_FAILURE, reason);
          } else {
            let utcZone = lazy.cal.dtz.UTC;
            lazy.LOG(
              "[calGoogleCalendar] Found " +
                calData.busy.length +
                " busy slots within range for " +
                strippedCalId
            );
            let busyRanges = calData.busy.map(entry => {
              let start = lazy.cal.dtz.fromRFC3339(entry.start, utcZone);
              let end = lazy.cal.dtz.fromRFC3339(entry.end, utcZone);
              let interval = new lazy.cal.provider.FreeBusyInterval(
                aCalId,
                Ci.calIFreeBusyInterval.BUSY,
                start,
                end
              );
              lazy.LOGinterval(interval);
              return interval;
            });
            completeSync(busyRanges);
          }
        } else {
          lazy.LOGerror("[calGoogleCalendar] Invalid freebusy response: " + aData.toSource());
          failSync(Cr.NS_ERROR_FAILURE, aData && aData.toSource());
        }
      },
      e => {
        lazy.LOGerror("[calGoogleCalendar] Failed freebusy request: " + e);
        return failSync(request.status, null);
      }
    );

    return request;
  },

  getCalendarList: function() {
    let calendarRequest = new lazy.calGoogleRequest();
    calendarRequest.type = calendarRequest.GET;
    calendarRequest.uri = lazy.API_BASE.EVENTS + "users/me/calendarList";

    let items = [];
    return this.asyncPaginatedRequest(
      calendarRequest,
      null,
      data => {
        items.push(...data.items);
      },
      () => {
        return items;
      }
    );
  },

  getTasksList: function() {
    let tasksRequest = new lazy.calGoogleRequest();
    tasksRequest.type = tasksRequest.GET;
    tasksRequest.uri = lazy.API_BASE.TASKS + "users/@me/lists";
    let items = [];
    return this.asyncPaginatedRequest(
      tasksRequest,
      null,
      data => {
        items.push(...data.items);
      },
      () => {
        return items;
      }
    );
  },
};
