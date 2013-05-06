/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calXMLUtils.jsm");
Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

// This constant is an arbitrary large number. It is used to tell google to get
// many events, the exact number is not important.
const kMANY_EVENTS = 0x7FFFFFFF;

function calGoogleSessionManager() {
    this.wrappedJSObject = this;

}
const calGoogleSessionManagerClassID = Components.ID("{6a7ba1f0-f271-49b0-8e93-5ca33651b4af}");
const calGoogleSessionManagerInterfaces = [Components.interfaces.calIGoogleSessionManager];
calGoogleSessionManager.prototype = {
    mSessionMap: {},

    classID: calGoogleSessionManagerClassID,
    QueryInterface: XPCOMUtils.generateQI(calGoogleSessionManagerInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calGoogleSessionManagerClassID,
        contractID: "@mozilla.org/calendar/providers/gdata/session-manager;1",
        classDescription: "Google Calendar Session Manager",
        interfaces: calGoogleSessionManagerInterfaces,
        flags: Components.interfaces.nsIClassInfo.SINGLETON
    }),

    /**
     * getSessionByUsername
     * Get a Session object for the specified username. If aCreate is false,
     * null will be returned if the session doesn't exist. Otherwise, the
     * session will be created.
     *
     * @param aUsername The username to get the session for
     * @param aCreate   If true, the session will be created prior to returning
     */
    getSessionByUsername: function cGSM_getSessionByUsername(aUsername, aCreate) {
        // If the username contains no @, assume @gmail.com
        // XXX Maybe use accountType=GOOGLE and just pass the raw username?
        if (aUsername.indexOf('@') == -1) {
            aUsername += "@gmail.com";
        }

        // Check if the session exists
        if (!this.mSessionMap.hasOwnProperty(aUsername)) {
            if (!aCreate) {
                return null;
            }
            cal.LOG("[calGoogleCalendar] Creating session for: " + aUsername);
            this.mSessionMap[aUsername] = new calGoogleSession(aUsername);
        } else {
            cal.LOG("[calGoogleCalendar] Reusing session for: " + aUsername);
        }

        // XXX What happens if the username is "toSource" :)
        return this.mSessionMap[aUsername];
    }
};

/**
 * calGoogleSession
 * This Implements a Session object to communicate with google
 *
 * @constructor
 * @class
 */
function calGoogleSession(aUsername) {
    this.mItemQueue = new Array();
    this.mGoogleUser = aUsername;
    this.wrappedJSObject = this;

    // Register a freebusy provider for this session
    getFreeBusyService().addProvider(this);
}
const calGoogleSessionClassID = Components.ID("{652f6233-e03f-438a-bd3b-39877f68c0f4}");
const calGoogleSessionInterfaces = [Components.interfaces.calIGoogleSession];
calGoogleSession.prototype = {
    classID: calGoogleSessionClassID,
    QueryInterface: XPCOMUtils.generateQI(calGoogleSessionInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calGoogleSessionClassID,
        contractID: "@mozilla.org/calendar/providers/gdata/session;1",
        classDescription: "Google Calendar Session",
        interfaces: calGoogleSessionInterfaces
    }),

    /* Member Variables */
    mGoogleUser: null,
    // This must be |undefined|, we need this variable to be tri-state.
    mGooglePass: undefined,
    mGoogleFullName: null,
    mAuthToken: null,
    mSessionID: null,

    mLoggingIn: false,
    mPersistPassword: false,
    mItemQueue: null,

    mCalendarName: null,

    /**
     * readonly attribute authToken
     *
     * The auth token returned from Google Accounts
     */
    get authToken() {
        return this.mAuthToken;
    },

    /**
     * readonly attribute userName
     *
     * The username for this session. To get a session with a different
     * username, use calIGoogleSessionManager.
     */
    get userName() {
        return this.mGoogleUser;
    },

    /**
     * attribute persist
     *
     * If set, the password will persist across restarts.
     */
    get persist() {
        return this.mPersistPassword;
    },
    set persist(v) {
        return this.mPersistPassword = v;
    },

    /**
     * attribute AUTF8String fullName
     *
     * The user's full name, usually retrieved from the XML <author> fields.
     */
    get fullName() {
        return this.mGoogleFullName;
    },
    set fullName(v) {
        return this.mGoogleFullName = v;
    },

    /**
     * attribute AUTF8String password
     *
     * The password used to authenticate. It is only important to implement the
     * setter here, since the password is only used internally.
     */
    get password() {
        return this.mGooglePass;
    },
    set password(v) {
        return this.mGooglePass = v;
    },

    /**
     * invalidate
     * Resets the Auth token and password.
     */
    invalidate: function cGS_invalidate() {
        this.mAuthToken = null;
        this.mGooglePass = null;
        this.persist = false;

        passwordManagerRemove(this.mGoogleUser);
    },

    getCalendars: function cGS_getCalendars(aListener) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    /**
     * failQueue
     * Fails all requests in this session's queue. Optionally only fail requests
     * for a certain calendar
     *
     * @param aCode     Failure Code
     * @param aCalendar The calendar to fail for. Can be null.
     */
    failQueue: function cGS_failQueue(aCode, aCalendar) {
        function cGS_failQueue_failInQueue(element, index, arr) {
            if (!aCalendar || (aCalendar && element.calendar == aCalendar)) {
                element.fail(aCode, null);
                return false;

            }
            return true;
        }

        this.mItemQueue = this.mItemQueue.filter(cGS_failQueue_failInQueue);
    },

    /**
     * loginAndContinue
     * Prepares a login request, then requests via #asyncRawRequest
     *
     *
     * @param aCalendar    The calendar of the request that initiated the login.
     */
    loginAndContinue: function cGS_loginAndContinue(aCalendar) {
        if (this.mLoggingIn) {
            cal.LOG("[calGoogleCalendar] loginAndContinue called while logging in");
            return;
        }
        try {
            cal.LOG("[calGoogleCalendar] Logging in to " + this.mGoogleUser);

            // We need to have a user and should not be logging in
            ASSERT(!this.mLoggingIn);
            ASSERT(this.mGoogleUser);

            // Start logging in
            this.mLoggingIn = true;

            if (this.mGooglePass === undefined) {
                // This happens only on the first run. Try to get the password
                // from the password manager.
                let password = {};
                passwordManagerGet(this.mGoogleUser, password);
                if (password.value) {
                    cal.LOG("Retrieved Password for " + this.mGoogleUser +
                            " from password manager");
                    this.mPersistPassword = true;
                    this.mGooglePass = password.value;
                } else {
                    // Could not get the password from the password manager, set
                    // it to null to make sure the password is prompted for in
                    // the next block.
                    this.mGooglePass = null;
                }
            }

            // Check if we have a password. If not, authentication may have
            // failed.
            if (!this.mGooglePass) {
                let username = { value: this.mGoogleUser };
                let password = { value: null };
                let persist = { value: false };

                // Try getting a new password, potentially switching sesssions.
                let calendarName = (aCalendar ?
                                    aCalendar.googleCalendarName :
                                    this.mGoogleUser);

                if (getCalendarCredentials(calendarName,
                                           username,
                                           password,
                                           persist)) {

                    cal.LOG("[calGoogleCalendar] Got the pw from the calendar credentials: " +
                            calendarName);

                    // If a different username was entered, switch sessions

                    if (aCalendar && username.value != this.mGoogleUser) {
                        let newSession = getGoogleSessionManager()
                                         .getSessionByUsername(username.value,
                                                               true);
                        newSession.password = password.value;
                        newSession.persist = persist.value;
                        setCalendarPref(aCalendar,
                                        "googleUser",
                                        "CHAR",
                                        username.value);

                        // Set the new session for the calendar
                        aCalendar.session = newSession;
                        cal.LOG("[calGoogleCalendar] Setting " + aCalendar.name +
                                "'s Session to " + newSession.userName);

                        // Move all requests by this calendar to its new session
                        function cGS_login_moveToSession(element, index, arr) {
                            if (element.calendar == aCalendar) {
                                cal.LOG("[calGoogleCalendar] Moving " + element.uri + " to " +
                                        newSession.userName);
                                newSession.asyncItemRequest(element);
                                return false;
                            }
                            return true;
                        }
                        this.mItemQueue = this.mItemQueue
                                          .filter(cGS_login_moveToSession);

                        // Do not complete the request here, since it has been
                        // moved. This is not an error though, so nothing is
                        // thrown.
                        return;
                    }

                    // If we arrive at this point, then the session was not
                    // changed. Just adapt the password from the dialog and
                    // continue.
                    this.mGooglePass = password.value;
                    this.persist = persist.value;
                } else {
                    cal.LOG("[calGoogleCalendar] Could not get any credentials for " +
                            calendarName + " (" +
                            this.mGoogleUser + ")");

                    if (aCalendar) {
                        // First of all, disable the calendar so no further login
                        // dialogs show up.
                        aCalendar.setProperty("disabled", true);
                        aCalendar.setProperty("auto-enabled", true);

                        // Unset the session in the requesting calendar, if the user
                        // canceled the login dialog that also asks for the
                        // username, then the session is not valid. This also
                        // prevents multiple login windows.
                        aCalendar.session = null;
                    }

                    // We are done logging in
                    this.mLoggingIn = false;

                    // The User even canceled the login prompt asking for
                    // the user. This means we have to fail all requests
                    // that belong to that calendar and are in the queue. This
                    // will also include the request that initiated the login
                    // request, so that dosent need to be handled extra. If no
                    // calendar was passed, fail all request in that queue
                    this.failQueue(Components.results.NS_ERROR_NOT_AVAILABLE,
                                   aCalendar);
                    return;
                }
            }

            // Now we should have a password
            ASSERT(this.mGooglePass);

            // Get Version info
            let source = Services.appinfo.vendor + "-" +
                         Services.appinfo.name + "-" +
                         Services.appinfo.version;

            // Request Login
            let request = new calGoogleRequest(this);

            request.type = request.LOGIN;
            request.calendar = aCalendar;
            request.responseListener = this;

            request.setUploadData("application/x-www-form-urlencoded",
                                  "Email=" + encodeURIComponent(this.mGoogleUser) +
                                  "&Passwd=" + encodeURIComponent(this.mGooglePass) +
                                  "&accountType=HOSTED_OR_GOOGLE" +
                                  "&source=" + encodeURIComponent(source) +
                                  "&service=cl");
            this.asyncRawRequest(request);
        } catch (e) {
            // If something went wrong, reset the login state just in case
            this.mLoggingIn = false;
            cal.LOG("[calGoogleCalendar] Error Logging In: " + e);

            // If something went wrong, then this.loginComplete should handle
            // the error. We don't need to take care of the request that
            // initiated the login, since it is also in the item queue.
            this.onResult({ status: e.result}, e.message);
        }
    },

    /**
     * onResult (loginComplete)
     * Callback function that is called when the login request to Google
     * Accounts has finished
     *  - Retrieves the Authentication Token
     *  - Saves the Password in the Password Manager
     *  - Processes the Item Queue
     *
     * @private
     * @param aOperation    The calIOperation that initiated the login
     * @param aData         The (String) Result of the Request
     *                      (or an Error Message)
     */
     onResult: function cGS_onResult(aOperation, aData) {
        // About mLoggingIn: this should only be set to false when either
        // something went wrong or mAuthToken is set. This avoids redundant
        // logins to Google. Hence mLoggingIn is set three times in the course
        // of this function

        if (!aData || !Components.isSuccessCode(aOperation.status)) {
            this.mLoggingIn = false;
            cal.LOG("[calGoogleCalendar] Login failed. Status: " + aOperation.status);

            if (aOperation.status == kGOOGLE_LOGIN_FAILED &&
                aOperation.reauthenticate) {
                // If the login failed, then retry the login. This is not an
                // error that should trigger failing the calICalendar's request.
                this.loginAndContinue(aOperation.calendar);
            } else {
                cal.LOG("[calGoogleCalendar] Failing queue with " + aOperation.status);
                this.failQueue(aOperation.status);
            }
        } else {
            let start = aData.indexOf("Auth=");
            if (start == -1) {
                // The Auth token could not be extracted
                this.mLoggingIn = false;
                this.invalidate();

                // Retry login
                this.loginAndContinue(aOperation.calendar);
            } else {
                this.mAuthToken = aData.substring(start + 5, aData.length - 1);

                this.mLoggingIn = false;

                if (this.persist) {
                    try {
                        passwordManagerSave(this.mGoogleUser,
                                            this.mGooglePass);
                    } catch (e) {
                        // This error is non-fatal, but would constrict
                        // functionality
                        cal.LOG("[calGoogleCalendar] Error adding password to manager");
                    }
                }

                // Process Items that were requested while logging in
                let request;
                // Extra parentheses to avoid js strict warning.
                while ((request = this.mItemQueue.shift())) {
                    cal.LOG("[calGoogleCalendar] Processing Queue Item: " + request.uri);
                    request.commit(this);
                }
            }
        }
    },

    /**
     * asyncItemRequest
     * get or post an Item from or to Google using the Queue.
     *
     * @param aRequest          The Request Object. This is an instance of
     *                          calGoogleRequest
     */
    asyncItemRequest: function cGS_asyncItemRequest(aRequest) {

        if (!this.mLoggingIn && this.mAuthToken) {
            // We are not currently logging in and we have an auth token, so
            // directly try the login request
            this.asyncRawRequest(aRequest);
        } else {
            // Push the request in the queue to be executed later
            this.mItemQueue.push(aRequest);

            cal.LOG("[calGoogleCalendar] Adding item " + aRequest.uri + " to queue");

            // If we are logging in, then we are done since the passed request
            // will be processed when the login is complete. Otherwise start
            // logging in.
            if (!this.mLoggingIn && this.mAuthToken == null) {
                // We need to do this on a timeout, otherwise the UI thread will
                // block when the password prompt is shown.
                setTimeout(function() {
                    this.loginAndContinue(aRequest.calendar);
                }, 0, this);
            }
        }
    },

    /**
     * asyncRawRequest
     * get or post an Item from or to Google without the Queue.
     *
     * @param aRequest          The Request Object. This is an instance of
     *                          calGoogleRequest
     */
    asyncRawRequest: function cGS_asyncRawRequest(aRequest) {
        // Request is handled by an instance of the calGoogleRequest
        // We don't need to keep track of these requests, they
        // pass to a listener or just die

        ASSERT(aRequest);
        aRequest.commit(this);
    },

    /**
     * calIFreeBusyProvider Implementation
     */
    getFreeBusyIntervals: function cGS_getFreeBusyIntervals(aCalId,
                                                            aRangeStart,
                                                            aRangeEnd,
                                                            aBusyTypes,
                                                            aListener) {
        if (aCalId.indexOf("@") < 0 || aCalId.indexOf(".") < 0) {
            // No valid email, screw it
            aListener.onResult(null, null);
            return null;
        }

        // Requesting only a DATE returns items based on UTC. Therefore, we make
        // sure both start and end dates include a time and timezone. This may
        // not quite be what was requested, but I'd say its a shortcoming of
        // rfc3339.
        if (aRangeStart) {
            aRangeStart = aRangeStart.clone();
            aRangeStart.isDate = false;
        }
        if (aRangeEnd) {
            aRangeEnd = aRangeEnd.clone();
            aRangeEnd.isDate = false;
        }

        let rfcRangeStart = cal.toRFC3339(aRangeStart);
        let rfcRangeEnd = cal.toRFC3339(aRangeEnd);

        let request = new calGoogleRequest(this);

        request.type = request.GET;
        request.uri = "https://www.google.com/calendar/feeds/" +
                      encodeURIComponent(aCalId.replace(/^mailto:/i, "")) +
                      "/private/free-busy";
        request.operationListener = aListener;
        request.itemRangeStart = aRangeStart;
        request.itemRangeEnd = aRangeEnd;
        request.reauthenticate = false;

        // Request Parameters
        request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);
        request.addQueryParameter("max-results", kMANY_EVENTS);
        request.addQueryParameter("singleevents", "true");
        request.addQueryParameter("start-min", rfcRangeStart);
        request.addQueryParameter("start-max", rfcRangeEnd);

        let session = this;
        request.responseListener = {
            onResult: function cGS_getFreeBusyIntervals_onResult(aOperation, aData) {
                session.getFreeBusyIntervals_response(aOperation,
                                                      aData,
                                                      aCalId,
                                                      aRangeStart,
                                                      aRangeEnd);
            }
        };

        this.asyncItemRequest(request);
        return request;
    },

    getFreeBusyIntervals_response: function getFreeBusyIntervals_response(aOperation,
                                                                          aData,
                                                                          aCalId,
                                                                          aRangeStart,
                                                                          aRangeEnd) {
        // Prepare Namespaces
        if (aOperation.status == kGOOGLE_LOGIN_FAILED ||
            !Components.isSuccessCode(aOperation.status)) {
            aOperation.operationListener.onResult(aOperation, null);
            return;
        }

        // A feed was passed back, parse it.
        let xml = cal.xml.parseString(aData);
        let timezoneString = gdataXPathFirst(xml, 'atom:feed/gCal:timezone/@value') || "UTC";
        let timezone = gdataTimezoneService.getTimezone(timezoneString);

        let intervals = [];
        const fbtypes = Components.interfaces.calIFreeBusyInterval;
        for each (let entry in gdataXPath(xml, 'atom:feed/atom:entry')) {
            let start = cal.fromRFC3339(gdataXPathFirst(entry, 'gd:when/@startTime'), timezone);
            let end = cal.fromRFC3339(gdataXPathFirst(entry, 'gd:when/@endTime'), timezone);
            let interval = new cal.FreeBusyInterval(aCalId, fbtypes.BUSY, start, end);
            LOGinterval(interval);
            intervals.push(interval);
        }

        aOperation.operationListener.onResult(aOperation, intervals);
    }
};
