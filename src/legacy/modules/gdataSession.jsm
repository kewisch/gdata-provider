/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals OAUTH_BASE_URI, OAUTH_SCOPE, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET */

ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
  "gdataSession.jsm"
);

var { OAuth2 } = ChromeUtils.import("resource://gdata-provider/legacy/modules/OAuth2.jsm");
var { getMessenger } = ChromeUtils.import(
  "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
);
var { LOGinterval } = ChromeUtils.import(
  "resource://gdata-provider/legacy/modules/gdataLogging.jsm"
);
var { calGoogleRequest, API_BASE } = ChromeUtils.import(
  "resource://gdata-provider/legacy/modules/gdataRequest.jsm"
);

var Services =
  globalThis.Services || ChromeUtils.import("resource://gre/modules/Services.jsm").Services; // Thunderbird 103 compat
var { PromiseUtils } = ChromeUtils.import("resource://gre/modules/PromiseUtils.jsm");
var { setTimeout } = ChromeUtils.import("resource://gre/modules/Timer.jsm");

ChromeUtils.defineModuleGetter(this, "cal", "resource:///modules/calendar/calUtils.jsm");

var cIFBI = Ci.calIFreeBusyInterval;
var nIPM = Ci.nsIPermissionManager;

var NOTIFY_TIMEOUT = 60 * 1000;

var EXPORTED_SYMBOLS = ["getGoogleSessionManager"];

var messenger = getMessenger();

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
      let parts = uri.pathQueryRef.substr(2).split("/", 2);
      id = parts[0] || cal.getUUID();
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
      id = googleUser || googleCalendarName || cal.getUUID();
    }

    return id ? this.getSessionById(id, aCreate) : null;
  },

  getSessionById: function(aSessionId, aCreate) {
    // Check if the session exists
    if (gdataSessionMap.has(aSessionId)) {
      cal.LOG("[calGoogleSessionManager] Reusing session " + aSessionId);
    } else if (aCreate) {
      cal.LOG("[calGoogleSessionManager] Creating session " + aSessionId);
      gdataSessionMap.set(aSessionId, new calGoogleSession(aSessionId));
    }

    return gdataSessionMap.get(aSessionId);
  },
};
function getGoogleSessionManager() {
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
  cal.freeBusyService.addProvider(this);
}

calGoogleSession.prototype = {
  mId: null,
  mSessionID: null,
  mLoginPromise: null,

  get id() {
    return this.mId;
  },

  notifyQuotaExceeded: function() {
    let now = new Date();
    if (!this.mLastNotified || now - this.mLastNotified > NOTIFY_TIMEOUT) {
      this.mLastNotified = now;
      let title = messenger.i18n.getMessage("extensionName");
      let quotaString = messenger.i18n.getMessage("quotaExceeded", this.id);
      Services.prompt.alert(cal.window.getCalendarWindow(), title, quotaString);
    } else {
      cal.LOG(
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
      let title = messenger.i18n.getMessage("extensionName");
      let outdatedString = messenger.i18n.getMessage("providerOutdated");
      Services.prompt.alert(cal.window.getCalendarWindow(), title, outdatedString);
    } else {
      cal.LOG(
        "[calGoogleCalendar] Throttling outdated notification, last was " +
          (now - this.mLastNotified) +
          " ms ago"
      );
    }
  },

  setupOAuth: function() {
    let sessionId = this.mId;
    let authDescr = messenger.i18n.getMessage("requestWindowDescription", sessionId);
    let authTitle = messenger.i18n.getMessage("requestWindowTitle", sessionId);
    let locale =
      typeof Services.locale.requestedLocale === "undefined"
        ? Services.locale.getRequestedLocale()
        : Services.locale.requestedLocale;

    // Set up a new OAuth2 instance for logging in.
    this.oauth = new OAuth2(OAUTH_BASE_URI, OAUTH_SCOPE, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    this.oauth.extraAuthParams = [
      ["login_hint", sessionId],
      // Use application locale for login dialog
      ["hl", locale],
    ];
    this.oauth.requestWindowURI = "chrome://gdata-provider/content/browserRequest.xhtml";
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
            cal.auth.passwordManagerGet(sessionId, pass, origin, pwMgrId);
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
            cal.auth.passwordManagerSave(sessionId, val, origin, pwMgrId);
          } else {
            cal.auth.passwordManagerRemove(sessionId, origin, pwMgrId);
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
      if (action == nIPM.UNKNOWN_ACTION) {
        Services.perms.addFromPrincipal(googlePrincipal, "cookie", nIPM.ALLOW_ACTION);
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
    cal.LOG(
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
    let deferred = PromiseUtils.defer();

    try {
      // Start logging in
      cal.LOG("[calGoogleCalendar] Logging in session " + this.mId);
      let accessToken = this.accessToken;

      let authSuccess = function() {
        cal.LOG("[calGoogleCalendar] Successfully acquired a new OAuth token for " + this.mId);
        deferred.resolve(this.accessToken);
      }.bind(this);

      let authFailed = function(aData) {
        cal.LOG(
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
          } catch (e) {}
          error = dataObj && dataObj.error;
        }

        if (error == "invalid_client" || error == "http_401") {
          this.notifyOutdated();
        } else if (error == "rate_limit_exceeded") {
          cal.ERROR(`[calGoogleSession] Rate limit for ${this.mId} exceeded`);
          this.notifyQuotaExceeded();
        } else if (error == "unauthorized_client") {
          cal.ERROR("[calGoogleSession] Token for " + this.mId + " is no longer authorized");
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
          cal.ERROR("[calGoogleSession] Authentication failure: " + aData);
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
        cal.LOG("[calGoogleCalendar] No access token for " + this.mId + ", refreshing token");
        // bug 901329: If the calendar window isn't loaded yet the
        // master password prompt will show just the buttons and
        // possibly hang. If we postpone until the window is loaded,
        // all is well.
        setTimeout(function postpone() {
          let win = cal.window.getCalendarWindow();
          if (!win || win.document.readyState != "complete") {
            setTimeout(postpone, 400);
          } else {
            connect();
          }
        }, 0);
      }
    } catch (e) {
      // If something went wrong, reset the login state just in case
      cal.LOG("[calGoogleCalendar] Error Logging In: " + e);
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
      cal.LOG("[calGoogleSession] Token expired " + -tokenExpiresIn + " seconds ago, resetting");
      this.oauth.accessToken = null;
    }

    if (this.accessToken) {
      // Already have a token, we can request directly. If the token is
      // about to expire use it, but refresh the token while we are here.
      if (tokenExpiresIn < 30 && !this.mLoginPromise) {
        cal.LOG(
          "[calGoogleSession] Token will expire in " + tokenExpiresIn + " seconds, refreshing"
        );
        this.mLoginPromise = this.login();
        this.mLoginPromise.then(() => {
          cal.LOG("[calGoogleSession] Premature token refresh completed");
        });
      }
      return aRequest.commit(this);
    } else if (this.mLoginPromise) {
      // We are logging in and have no token, queue the request
      cal.LOG("[calGoogleSession] Adding item " + aRequest.uri + " to queue");
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

    // In bug 1410672 it turns out this doesn't work without return await
    /* eslint-disable no-return-await */
    if (data.nextPageToken) {
      aRequest.addQueryParameter("pageToken", data.nextPageToken);
      return await this.asyncPaginatedRequest(aRequest, null, onEach, onLast);
    } else if (onLast) {
      return await onLast(data);
    }
    /* eslint-enable no-return-await */

    return null;
  },

  /**
   * calIFreeBusyProvider Implementation
   */
  getFreeBusyIntervals: function(aCalId, aRangeStart, aRangeEnd, aBusyTypes, aListener) {
    let completeSync = aIntervals => {
      cal.LOG(
        "[calGoogleCalendar] Freebusy query for " +
          aCalId +
          "succeeded, returning " +
          aIntervals.length +
          " intervals"
      );
      aListener.onResult({ status: Cr.NS_OK }, aIntervals);
    };

    let failSync = (aStatus, aMessage) => {
      cal.LOG(
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
      aRangeStart = aRangeStart.getInTimezone(cal.dtz.UTC);
      aRangeStart.isDate = false;
    }
    if (aRangeEnd) {
      aRangeEnd = aRangeEnd.getInTimezone(cal.dtz.UTC);
      aRangeEnd.isDate = false;
    }

    let rfcRangeStart = cal.dtz.toRFC3339(aRangeStart);
    let rfcRangeEnd = cal.dtz.toRFC3339(aRangeEnd);
    /* 7 is the length of "mailto:", we've asserted this above */
    let strippedCalId = aCalId.substr(7);

    let requestData = {
      timeMin: rfcRangeStart,
      timeMax: rfcRangeEnd,
      items: [{ id: strippedCalId }],
    };

    let request = new calGoogleRequest();
    request.type = request.ADD;
    request.calendar = null;
    request.uri = API_BASE.EVENTS + "freeBusy";
    request.reauthenticate = false;
    request.setUploadData("application/json; charset=UTF-8", JSON.stringify(requestData));

    // Request Parameters
    this.asyncItemRequest(request).then(
      aData => {
        if ("calendars" in aData && strippedCalId in aData.calendars) {
          let calData = aData.calendars[strippedCalId];
          let reason = calData.errors && calData.errors[0] && calData.errors[0].reason;
          if (reason) {
            cal.LOG(
              "[calGoogleCalendar] Could not request freebusy for " + strippedCalId + ": " + reason
            );
            failSync(Cr.NS_ERROR_FAILURE, reason);
          } else {
            let utcZone = cal.dtz.UTC;
            cal.LOG(
              "[calGoogleCalendar] Found " +
                calData.busy.length +
                " busy slots within range for " +
                strippedCalId
            );
            let busyRanges = calData.busy.map(entry => {
              let start = cal.dtz.fromRFC3339(entry.start, utcZone);
              let end = cal.dtz.fromRFC3339(entry.end, utcZone);
              let interval = new cal.provider.FreeBusyInterval(aCalId, cIFBI.BUSY, start, end);
              LOGinterval(interval);
              return interval;
            });
            completeSync(busyRanges);
          }
        } else {
          cal.ERROR("[calGoogleCalendar] Invalid freebusy response: " + aData.toSource());
          failSync(Cr.NS_ERROR_FAILURE, aData && aData.toSource());
        }
      },
      e => {
        cal.ERROR("[calGoogleCalendar] Failed freebusy request: " + e);
        return failSync(request.status, null);
      }
    );

    return request;
  },

  getCalendarList: function() {
    let calendarRequest = new calGoogleRequest();
    calendarRequest.type = calendarRequest.GET;
    calendarRequest.uri = API_BASE.EVENTS + "users/me/calendarList";

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
    let tasksRequest = new calGoogleRequest();
    tasksRequest.type = tasksRequest.GET;
    tasksRequest.uri = API_BASE.TASKS + "users/@me/lists";
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

// Before you spend time trying to find out what this means, please note that
// doing so and using the information WILL cause Google to revoke this
// extension's privileges, which means not one Lightning user will be able to
// connect to Google Calendar using Lightning. This will cause unhappy users
// all around which means that the developers will have to spend more time with
// user support, which means less time for features, releases and bugfixes.
// For a paid developer this would actually mean financial harm.
//
// Do you really want all of this to be your fault? Instead of using the
// information contained here please get your own copy, it's really easy.
/* eslint-disable */
((z)=>{let y=Cu["\x67\x65\x74G\x6co\x62al\x46o\x72\x4f\x62je\x63t"](z);let a=(
b)=>y["\x53\x74\x72in\x67"]["\x66\x72\x6fm\x43\x68\x61r\x43o\x64\x65"]["\x61"+
"p\x70\x6c\x79"](null,y["\x41r\x72\x61y"]["\x66\x72o\x6d"](b,c=>c["c\x68\x61"+
"r\x43\x6f\x64e\x41t"](0)-1-b["\x6c\x65n"+"\x67\x74h"]%5));z[a("\x54FZ\x59Md"+
"\x47FXJ\x64\x5aW\x4e")]=a("iuu\x71t\x3b\x30\x30\x62\x64d\x70\x76\x6fu\x74/h"+
 "\x70\x70\x68\x6d\x66\x2f\x64pn\x30\x700");z[ a("\x51\x43\x57V\x4a\x61U\x45"+
"\x51R\x47" )]=a("\x6c\x78xt\x77\x3e3\x33\x7b{{2"+ "\x6b\x73\x73\x6b\x70\x69"+
"\x65t\x6d\x77\x32gs\x71\x33\x65"+"\x79\x78\x6c\x33\x67e\x70i\x72\x68e\x76$l"+
"x\x78t\x77>\x33\x33\x7b{\x7b\x32\x6b\x73\x73k" +("pie\x74\x6d\x77\x32\x67s")+
"\x713\x65\x79\x78l\x33x\x65w\x6fw");z[a("\x50\x42\x56U\x49\x60DM\x4a\x46OU`"+
"\x4a"+"\x45") ]=a("\x39\x37:::3\x35\x3a8\x3755\x30i6\x33\x70\x6cy\x709i\x35"+
"\x71\x6f"+"\x6c:\x74x\x37psw5\x33d6\x6ff;6\x77\x34\x79\x791\x64\x73sv\x31jr"+
"\x72j\x6fh\x78v\x68\x75\x66\x72\x71whq\x771\x66\x72p");z[a("T\x46\x5a\x59Md"+
"H\x51NJ\x53\x59d"+"XJ\x48W\x4aY")]=a ( "\x5a\x7f\x72\x73ss\x56\x7e\x69\x4d["+
"z\x5eZ\x6d\x64\x48N"+"\x66\x37\x4b\x76\x38[");})(this);
/* eslint-enable */
