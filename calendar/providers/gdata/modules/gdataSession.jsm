/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm").shimIt(this);
Components.utils.import("resource://gdata-provider/modules/OAuth2.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataUtils.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataLogging.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataRequest.jsm");

CuImport("resource://gre/modules/XPCOMUtils.jsm", this);
CuImport("resource://gre/modules/Preferences.jsm", this);
CuImport("resource://gre/modules/Services.jsm", this);
CuImport("resource://gre/modules/Promise.jsm", this);
CuImport("resource://gre/modules/PromiseUtils.jsm", this);
CuImport("resource://gre/modules/Task.jsm", this);
CuImport("resource://gre/modules/Timer.jsm", this);

CuImport("resource:///modules/iteratorUtils.jsm", this);

CuImport("resource://calendar/modules/calUtils.jsm", this);
CuImport("resource://calendar/modules/calProviderUtils.jsm", this);

var cIFBI = Components.interfaces.calIFreeBusyInterval;
var nIPM = Components.interfaces.nsIPermissionManager;

var NOTIFY_TIMEOUT = 60 * 1000;

var EXPORTED_SYMBOLS = ["getGoogleSessionManager"];

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
        let host = (function() { try { return uri.host; } catch (e) {} })();
        const protocols = ["http", "https", "webcal", "webcals"];

        if (aCalendar.type != "gdata") {
            return;
        }

        if (uri.schemeIs("googleapi")) {
            let [fullUser, path] = uri.path.substr(2).split("/", 2);
            id = fullUser || cal.getUUID();
        } else if (host == "www.google.com" && uri.path.startsWith("/calendar/feeds") && protocols.some(function(s) { return uri.schemeIs(s); })) {
            let googleCalendarName = aCalendar.getProperty("googleCalendarName");
            let googleUser = Preferences.get("calendar.google.calPrefs." + googleCalendarName  + ".googleUser");
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
    }
};
function getGoogleSessionManager() { return calGoogleSessionManager; }

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
    cal.getFreeBusyService().addProvider(this);
}

calGoogleSession.prototype = {
    mId: null,
    mSessionID: null,
    mLoginPromise: null,

    get id() { return this.mId; },

    notifyQuotaExceeded: function() {
        let now = new Date();
        let tt = (now - this.mLastNotified);
        if (!this.mLastNotified || (now - this.mLastNotified) > NOTIFY_TIMEOUT) {
            this.mLastNotified = now;
            let title = getProviderString("extensions.{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}.name");
            let quotaString = getProviderString("quotaExceeded", this.id);
            Services.prompt.alert(cal.getCalendarWindow(), title, quotaString);
        } else {
            cal.LOG("[calGoogleCalendar] Throttling quota notification, last was " + (now - this.mLastNotified) + " ms ago");
        }
    },

    notifyOutdated: function() {
        let now = new Date();
        let tt = (now - this.mLastNotified);
        if (!this.mLastNotified || (now - this.mLastNotified) > NOTIFY_TIMEOUT) {
            this.mLastNotified = now;
            let title = getProviderString("extensions.{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}.name");
            let outdatedString = getProviderString("providerOutdated");
            Services.prompt.alert(cal.getCalendarWindow(), title, outdatedString);
        } else {
            cal.LOG("[calGoogleCalendar] Throttling outdated notification, last was " + (now - this.mLastNotified) + " ms ago");
        }
    },

    setupOAuth: function setupOAuth() {
        let sessionId = this.mId;
        let authDescr = getProviderString("requestWindowDescription", sessionId);
        let authTitle = cal.calGetString("commonDialogs", "EnterUserPasswordFor",
                                         [sessionId], "global");

        // Set up a new OAuth2 instance for logging in.
        this.oauth = new OAuth2(OAUTH_BASE_URI, OAUTH_SCOPE, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
        this.oauth.extraAuthParams = [
          ["login_hint", sessionId],
          // Use application locale for login dialog
          ["hl", Preferences.get("general.useragent.locale", "en-US")]
        ];
        this.oauth.requestWindowURI = "chrome://gdata-provider/content/browserRequest.xul";
        this.oauth.requestWindowFeatures = "chrome,private,centerscreen,width=430,height=600";
        this.oauth.requestWindowTitle = authTitle;
        this.oauth.requestWindowDescription = authDescr;

        // Overwrite the refreshToken attribute, since we want to save it in
        // the password manager
        let pwMgrId = "Google Calendar OAuth Token";
        Object.defineProperty(this.oauth, "refreshToken", {
            get: function getRefreshToken() {
                if (!this.mRefreshToken) {
                    let pass = { value: null };
                    try {
                        cal.auth.passwordManagerGet(sessionId, pass, sessionId, pwMgrId);
                    } catch (e if e.result == Components.results.NS_ERROR_ABORT) {
                        // User might have cancelled the master password prompt, thats ok
                    }
                    this.mRefreshToken = pass.value;
                }
                return this.mRefreshToken;
            },
            set: function setRefreshToken(val) {
                try {
                    if (!val) {
                        cal.auth.passwordManagerRemove(sessionId, sessionId, pwMgrId);
                    } else {
                        cal.auth.passwordManagerSave(sessionId, val, sessionId, pwMgrId);
                    }
                } catch (e if e.result == Components.results.NS_ERROR_ABORT) {
                    // User might have cancelled the master password prompt, thats ok
                }
                return (this.mRefreshToken = val);
            },
            enumerable: true
        });

        // If the user has disabled cookies, we need to add an exception for
        // Google so authentication works. If the user has explicitly blocked
        // google.com then we won't overwrite the rule though.
        if (Preferences.get("network.cookie.cookieBehavior") == 2) {
            let found = null;
            for (let perm in fixIterator(Services.perms.enumerator, Components.interfaces.nsIPermission)) {
                if (perm.type == "cookie" && perm.host == "google.com") {
                    found = perm;
                    break;
                }
            }

            if (!found || found.capability != nIPM.DENY_ACTION) {
                Services.perms.remove("google.com", "cookie");
                let uri = Services.io.newURI("http://google.com", null, null);
                Services.perms.add(uri, "cookie", nIPM.ALLOW_ACTION, nIPM.EXPIRE_SESSION);
            }
        }
    },

    get accessToken() { return this.oauth.accessToken; },
    get refreshToken() { return this.oauth.refreshToken; },
    set refreshToken(val) { this.oauth.refreshToken = val; },

    /**
     * Resets the access token, it will be re-retrieved on the next request.
     */
    invalidate: function cGS_invalidate() {
        cal.LOG("[calGoogleSession] Invalidating session, will reauthenticate on next request");
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
            let refreshToken = this.refreshToken;

            let authSuccess = function() {
                cal.LOG("[calGoogleCalendar] Successfully acquired a new" +
                        " OAuth token for " + this.mId);
                deferred.resolve(this.accessToken);
            }.bind(this);

            let authFailed = function(aData) {
                cal.LOG("[calGoogleCalendar] Failed to acquire a new" +
                        " OAuth token for " + this.mId + " data: " + aData);

                let error = null;
                if (aData) {
                    let dataObj;
                    try { dataObj = JSON.parse(aData); } catch (e) {}
                    error = dataObj && dataObj.error;
                }

                if (error == "invalid_client" || error == "http_401") {
                    this.notifyOutdated();
                } else if (error == "unauthorized_client") {
                    cal.ERROR("[calGoogleSession] Token for " + this.mId +
                              " is no longer authorized");
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
                    onPromptStart: function() {
                        // Usually this function should be synchronous. The OAuth
                        // connection itself is asynchronous, but if a master
                        // password is prompted it will block on that.
                        this.onPromptAuthAvailable();
                        return true;
                    },

                    onPromptAuthAvailable: function() {
                        self.oauth.connect(authSuccess, authFailed, true, false);
                    },
                    onPromptCanceled: authFailed
                };
                let asyncprompter = Components.classes["@mozilla.org/messenger/msgAsyncPrompter;1"]
                                              .getService(Components.interfaces.nsIMsgAsyncPrompter);
                asyncprompter.queueAsyncAuthPrompt("googleapi://" + this.id, false, promptlistener);
            }.bind(this);

            if (accessToken) {
                deferred.resolve(accessToken);
            } else {
                cal.LOG("[calGoogleCalendar] No access token for " + this.mId +
                        ", refreshing token");
                // bug 901329: If the calendar window isn't loaded yet the
                // master password prompt will show just the buttons and
                // possibly hang. If we postpone until the window is loaded,
                // all is well.
                setTimeout(function postpone() {
                    let win = cal.getCalendarWindow();
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
        return deferred.promise.then(function(accessToken) {
            this.mLoginPromise = null;
            return accessToken;
        }.bind(this), function(e) {
            this.mLoginPromise = null;
            throw e;
        }.bind(this));
    },

    /**
     * asyncItemRequest
     * get or post an Item from or to Google using the Queue.
     *
     * @param aRequest          The Request Object. This is an instance of
     *                          calGoogleRequest.
     */
    asyncItemRequest: function cGS_asyncItemRequest(aRequest) {
        let tokenExpiresIn = Math.floor((this.oauth.tokenExpires - (new Date()).getTime()) / 1000);
        if (tokenExpiresIn < 0 && !this.mLoginPromise) {
            cal.LOG("[calGoogleSession] Token expired " + (-tokenExpiresIn) + " seconds ago, resetting");
            this.oauth.accessToken = null;
        }

        if (this.accessToken) {
            // Already have a token, we can request directly. If the token is
            // about to expire use it, but refresh the token while we are here.
            if (tokenExpiresIn < 30 && !this.mLoginPromise) {
                cal.LOG("[calGoogleSession] Token will expire in " + tokenExpiresIn + " seconds, refreshing");
                this.mLoginPromise = this.login();
                this.mLoginPromise.then(function() {
                    cal.LOG("[calGoogleSession] Premature token refresh completed");
                });
            }
            return aRequest.commit(this);
        } else if (this.mLoginPromise) {
            // We are logging in and have no token, queue the request
            cal.LOG("[calGoogleSession] Adding item " + aRequest.uri + " to queue");
            return this.mLoginPromise.then(function() {
                return aRequest.commit(this);
            }.bind(this), function(e) {
                // If the user cancelled the login dialog, then disable the
                // calendar until the next startup or manual enable.
                if (aRequest.calendar && e.message == "cancelled") {
                    aRequest.calendar.setProperty("disabled", true);
                    aRequest.calendar.setProperty("auto-enabled", true);
                    aRequest.calendar.setProperty("currentStatus",
                                    Components.results.NS_ERROR_FAILURE);
                }

                throw e;
            }.bind(this));
        } else {
            // Not logging in and no token, get the login promise and retry.
            this.mLoginPromise = this.login();
            return this.asyncItemRequest(aRequest);
        }
    },

    asyncPaginatedRequest: function(aRequest, onFirst, onEach, onLast) {
        return Task.spawn(function() {
            let data = yield this.asyncItemRequest(aRequest);

            if (onFirst) {
                yield onFirst(data);
            }

            if (onEach) {
                yield onEach(data);
            }

            if (data.nextPageToken) {
                aRequest.addQueryParameter("pageToken", data.nextPageToken);
                throw new Task.Result(yield this.asyncPaginatedRequest(aRequest, null, onEach, onLast));
            } else if (onLast) {
                throw new Task.Result(yield onLast(data));
            }
        }.bind(this));
    },

    /**
     * calIFreeBusyProvider Implementation
     */
    getFreeBusyIntervals: function cGS_getFreeBusyIntervals(aCalId,
                                                            aRangeStart,
                                                            aRangeEnd,
                                                            aBusyTypes,
                                                            aListener) {
        let completeSync = function(aIntervals) {
            cal.LOG("[calGoogleCalendar] Freebusy query for " + aCalId +
                    "suceeded, returning " + aIntervals.length + " intervals");
            aListener.onResult({ status: Components.results.NS_OK }, aIntervals);
        }.bind(this);

        let failSync = function(aStatus, aMessage) {
            cal.LOG("[calGoogleCalendar] Freebusy query for " + aCalId +
                    " failed (" + aStatus + "): " + aMessage);

            // Usually we would notify with a result, but this causes trouble
            // with Lightning 3.9 and older.
            aListener.onResult({ status: aStatus }, null);
        }.bind(this);

        if (!aCalId.includes("@") || !aCalId.includes(".") ||
            !aCalId.toLowerCase().startsWith("mailto:")) {
            // No valid email, screw it
            return failSync(Components.results.NS_ERROR_FAILURE, null);
        }

        if (aRangeStart) {
            aRangeStart = aRangeStart.getInTimezone(cal.UTC());
        }
        if (aRangeEnd) {
            aRangeEnd = aRangeEnd.getInTimezone(cal.UTC());
        }

        let rfcRangeStart = cal.toRFC3339(aRangeStart);
        let rfcRangeEnd = cal.toRFC3339(aRangeEnd);
        /* 7 is the length of "mailto:", we've asserted this above */
        let strippedCalId = aCalId.substr(7);

        let requestData = {
          timeMin: rfcRangeStart,
          timeMax: rfcRangeEnd,
          items: [ { id: strippedCalId } ]
        };

        let request = new calGoogleRequest();
        request.type = request.ADD;
        request.calendar = null;
        request.uri = API_BASE.EVENTS + "freeBusy";
        request.reauthenticate = false;
        request.setUploadData("application/json; charset=UTF-8",
                              JSON.stringify(requestData));

        // Request Parameters
        this.asyncItemRequest(request).then(function(aData) {
            if ("calendars" in aData && strippedCalId in aData.calendars) {
                let calData = aData.calendars[strippedCalId];
                let reason = calData.errors && calData.errors[0] && calData.errors[0].reason;
                if (reason) {
                    cal.LOG("[calGoogleCalendar] Could not request freebusy for " + strippedCalId + ": " + reason);
                    failSync(Components.results.NS_ERROR_FAILURE, reason);
                } else {
                    let utcZone = cal.UTC();
                    cal.LOG("[calGoogleCalendar] Found " + calData.busy.length + " busy slots within range for " + strippedCalId);
                    let busyRanges = calData.busy.map(function(entry) {
                        let start = cal.fromRFC3339(entry.start, utcZone);
                        let end = cal.fromRFC3339(entry.end, utcZone);
                        let interval = new cal.FreeBusyInterval(aCalId, cIFBI.BUSY, start, end);
                        LOGinterval(interval);
                        return interval;
                    });
                    completeSync(busyRanges);
                }
            } else {
                cal.ERROR("[calGoogleCalendar] Invalid freebusy response: " + aData.toSource());
                failSync(Components.results.NS_ERROR_FAILURE, (aData && aData.toSource()));
            }
        }.bind(this), function(e) {
            cal.ERROR("[calGoogleCalendar] Failed freebusy request: " + e);
            return failSync(request.status, null);
        }.bind(this));

        return request;
    },

    getCalendarList: function() {
        let calendarRequest = new calGoogleRequest();
        calendarRequest.type = calendarRequest.GET;
        calendarRequest.uri = API_BASE.EVENTS + "users/me/calendarList";

        let items = [];
        return this.asyncPaginatedRequest(calendarRequest, null, function(data) {
            Array.prototype.push.apply(items, data.items);
        }.bind(this), function() {
            return items;
        }.bind(this));
    },

    getTasksList: function() {
        let tasksRequest = new calGoogleRequest();
        tasksRequest.type = tasksRequest.GET;
        tasksRequest.uri = API_BASE.TASKS + "users/@me/lists";
        let items = [];
        return this.asyncPaginatedRequest(tasksRequest, null, function(data) {
            Array.prototype.push.apply(items, data.items);
        }.bind(this), function() {
            return items;
        }.bind(this));
    }
};

// Before you spend time trying to find out what this means, please note
// that doing so and using the information WILL cause Google to revoke
// this extension's privileges, which means not one Lightning user will
// be able to connect to Google Calendar using Lightning. This will cause
// unhappy users all around which means that the developers will have to
// spend more time with user support, which means less time for features,
// releases and bugfixes.  For a paid developer this would actually mean
// financial harm.
// Do you really want all of this to be your fault? Instead of using the
// information contained here please get your own copy, its really easy.
this["\x65\x76\x61\x6C"]([String["\x66\x72\x6F\x6D\x43\x68\x61\x72\x43\x6F"+
"\x64\x65"](("wbs!!!PBVUI`CBTF`VSJ>#iuuqt;00bddpvout/hpphmf/dpn0p0#<wbs!!!"+
"PBVUI`TDPQF>#iuuqt;00xxx/hpphmfbqjt/dpn0bvui0dbmfoebs!iuuqt;00xxx/hpphmfb"+
"qjt/dpn0bvui0ubtlt#<wbs!!!PBVUI`DMJFOU`JE>#758881386533.o8m3pwsucmb9kh3ru"+
"qd4cpw2opkdukrq/bqqt/hpphmfvtfsdpoufou/dpn#<wbs!!!PBVUI`DMJFOU`TFDSFU>#f1"+
"Un{fzChWpEMPSUB8TsDFJV#<")["\x63\x68\x61\x72\x43\x6F\x64\x65\x41\x74"](i)-1)
for(i in (function(){let x=303; while (x--) yield x})())].reverse().join(""));
