/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm").shimIt(this);
Components.utils.import("resource://gdata-provider/modules/gdataLogging.jsm");

CuImport("resource://gre/modules/XPCOMUtils.jsm", this);
CuImport("resource://gre/modules/Services.jsm", this);
CuImport("resource://gre/modules/Promise.jsm", this);
CuImport("resource://gre/modules/PromiseUtils.jsm", this);
CuImport("resource://gre/modules/Preferences.jsm", this);

CuImport("resource://calendar/modules/calUtils.jsm", this);

var cIE = Components.interfaces.calIErrors;

var API_BASE = {
    EVENTS: "https://www.googleapis.com/calendar/v3/",
    TASKS: "https://www.googleapis.com/tasks/v1/"
};

var EXPORTED_SYMBOLS = ["calGoogleRequest", "getCorrectedDate", "API_BASE"];

/**
 * Gets the date and time that Google's http server last sent us. Note the
 * passed argument is modified. This might not be the exact server time (i.e it
 * may be off by network latency), but it does give a good guess when syncing.
 *
 * @param aDate     The date to modify.
 */
function getCorrectedDate(aDate) {
    if (getCorrectedDate.mClockSkew) {
        aDate.second += getCorrectedDate.mClockSkew;
    }
    return aDate;
}

/**
 * calGoogleRequest
 * This class represents a HTTP request sent to Google
 *
 * @constructor
 * @class
 */
function calGoogleRequest() {
    this.mQueryParameters = new Map();
    this.mRequestHeaders = new Map();
    this.wrappedJSObject = this;
}
calGoogleRequest.ADD = "POST";
calGoogleRequest.MODIFY = "PUT";
calGoogleRequest.DELETE = "DELETE";
calGoogleRequest.GET = "GET";
calGoogleRequest.PATCH = "PATCH";

var GDATA_ERROR_BASE = Components.interfaces.calIErrors.ERROR_BASE + 0x400;
calGoogleRequest.LOGIN_FAILED = GDATA_ERROR_BASE + 1;
calGoogleRequest.CONFLICT_DELETED = GDATA_ERROR_BASE + 2;
calGoogleRequest.CONFLICT_MODIFY = GDATA_ERROR_BASE + 3;
calGoogleRequest.NOT_MODIFIED = GDATA_ERROR_BASE + 4;
calGoogleRequest.QUOTA_FAILURE = GDATA_ERROR_BASE + 5;
calGoogleRequest.TOKEN_FAILURE = GDATA_ERROR_BASE + 6;
calGoogleRequest.RESOURCE_GONE = GDATA_ERROR_BASE + 7;

calGoogleRequest.prototype = {

    /* Members */
    mUploadContent: null,
    mUploadData: null,
    mSession: null,
    mQueryParameters: null,
    mType: null,
    mLoader: null,
    mDeferred: null,
    mStatus: Components.results.NS_OK,

    /* Constants */
    ADD: calGoogleRequest.ADD,
    MODIFY: calGoogleRequest.MODIFY,
    DELETE: calGoogleRequest.DELETE,
    GET: calGoogleRequest.GET,
    PATCH: calGoogleRequest.PATCH,

    /* Simple Attributes */
    method: "GET",
    id: null,
    uri: null,
    calendar: null,
    reauthenticate: true,
    requestDate: null,

    QueryInterface: XPCOMUtils.generateQI([
        Components.interfaces.calIOperation,
        Components.interfaces.nsIStreamLoaderObserver,
        Components.interfaces.nsIInterfaceRequestor,
        Components.interfaces.nsIChannelEventSink
    ]),

    /**
     * Implement calIOperation
     */
    get isPending() {
        return (this.mLoader && this.mLoader.request != null);
    },

    get status() {
        if (this.isPending) {
            return this.mLoader.request.status;
        } else {
            return this.mStatus;
        }
    },

    cancel: function cGR_cancel(aStatus) {
        if (this.isPending) {
            if (this.mLoader) {
                this.mLoader.request.cancel(aStatus);
            }
            this.mStatus = aStatus;
        }
    },

    /**
     * attribute type
     * The type of this reqest. Must be one of
     * GET, ADD, MODIFY, DELETE
     */
    get type() { return this.method; },

    set type(v) {
        let valid = [this.GET, this.ADD, this.MODIFY, this.PATCH, this.DELETE];
        if (!valid.includes(v)) {
            throw new Components.Exception("Invalid request type: " + v,
                                            Components.results.NS_ERROR_ILLEGAL_VALUE);
        }
        return (this.method = v);
    },

    /**
     * setUploadData
     * The HTTP body data for a POST or PUT request.
     *
     * @param aContentType The Content type of the Data.
     * @param aData        The Data to upload.
     */
    setUploadData: function cGR_setUploadData(aContentType, aData) {
        this.mUploadContent = aContentType;
        this.mUploadData = aData;
    },

    addQueryParameter: function cGR_addQueryParameter(aKey, aValue) {
        if (aValue) {
            this.mQueryParameters.set(aKey, aValue);
        } else {
            this.mQueryParameters.delete(aKey);
        }
    },

    addRequestHeader: function cGR_addRequestHeader(aKey, aValue) {
        if (aValue) {
            this.mRequestHeaders.set(aKey, aValue);
        } else {
            this.mRequestHeaders.delete(aKey);
        }
    },

    /**
     * commit
     * Starts the request process. This can be called multiple times if the
     * request should be repeated
     *
     * @param aSession  The session object this request should be made with.
     *                  This parameter is optional.
     */
    commit: function cGR_commit(aSession) {
        if (!this.mDeferred) {
            this.mDeferred = PromiseUtils.defer();
        }
        let promise = this.mDeferred.promise;

        try {
            // Set the session to request with
            if (aSession) {
                this.mSession = aSession;
            }

            // create the channel
            let uristring = this.uri;
            if (this.mQueryParameters.size > 0) {
                let params = [];

                // Using forEach is needed for backwards compatibility
                this.mQueryParameters.forEach(function(v, k) {
                    params.push(k + "=" + encodeURIComponent(v));
                });
                uristring += "?" + params.join("&");
            }
            let uri = Services.io.newURI(uristring, null, null);
            let channel;
            if ("newChannelFromURI2" in Services.io) {
                // Lightning 4.3+
                channel = Services.io.newChannelFromURI2(uri,
                                                         null,
                                                         Services.scriptSecurityManager.getSystemPrincipal(),
                                                         null,
                                                         Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                         Components.interfaces.nsIContentPolicy.TYPE_OTHER);
            } else {
                // Lightning 4.2 and older
                channel = Services.io.newChannelFromURI(uri);
            }

            cal.LOG("[calGoogleRequest] Requesting " + this.method + " " +
                    channel.URI.spec);

            this.prepareChannel(channel);

            channel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
            channel.redirectionLimit = 3;

            this.mLoader = cal.createStreamLoader();
            channel.notificationCallbacks = this;
            cal.sendHttpRequest(this.mLoader, channel, this);
        } catch (e) {
            // Let the response function handle the error that happens here
            this.fail(e.result, e.message);
        }
        return promise;
    },

    /**
     * fail
     * Call this request's listener with the given code and Message
     *
     * @param aCode     The Error code to fail with.
     * @param aMessage  The Error message. If this is null, an error Message
     *                  from calGoogleRequest will be used.
     */
    fail: function cGR_fail(aCode, aMessage) {
        let ex = new Components.Exception(aMessage, aCode);
        this.mLoader = null;
        this.mStatus = aCode;
        this.mDeferred.reject(ex);
        this.mDeferred = null;
    },

    /**
     * succeed
     * Call this request's listener with a Success Code and the given Result.
     *
     * @param aResult   The result Text of this request.
     */
    succeed: function cGR_succeed(aResult) {
        this.mLoader = null;
        this.mStatus = Components.results.NS_OK;
        this.mDeferred.resolve(aResult);
        this.mDeferred = null;
    },

    /**
     * prepareChannel
     * Prepares the passed channel to match this objects properties
     *
     * @param aChannel    The Channel to be prepared.
     */
    prepareChannel: function cGR_prepareChannel(aChannel) {
        // No caching
        aChannel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;

        // Set upload Data
        if (this.mUploadData) {
            let converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
                            createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
            converter.charset = "UTF-8";

            let stream = converter.convertToInputStream(this.mUploadData);
            aChannel = aChannel.QueryInterface(Components.interfaces.nsIUploadChannel);
            aChannel.setUploadStream(stream, this.mUploadContent, -1);

            cal.LOG("[calGoogleCalendar] Setting Upload Data (" +
                    this.mUploadContent + "):\n" + this.mUploadData);
        }

        aChannel = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);

        // Depending on the preference, we will use X-HTTP-Method-Override to
        // get around some proxies. This will default to true.
        if (Preferences.get("calendar.google.useHTTPMethodOverride", true) &&
            (this.method == "PUT" || this.method == "DELETE")) {

            aChannel.requestMethod = "POST";
            aChannel.setRequestHeader("X-HTTP-Method-Override",
                                      this.method,
                                      false);
            if (this.method == "DELETE") {
                // DELETE has no body, set an empty one so that Google accepts
                // the request.
                aChannel.setRequestHeader("Content-Type",
                                          "application/atom+xml; charset=UTF-8",
                                          false);
                aChannel.setRequestHeader("Content-Length", 0, false);
            }
        } else {
            aChannel.requestMethod = this.method;
        }

        if (this.mRequestHeaders.size) {
            cal.LOG("[calGoogleCalendar] Sending request headers: " + this.mRequestHeaders.toSource());
        }

        // Using forEach is needed for backwards compatibility
        this.mRequestHeaders.forEach(function(v, k) {
            aChannel.setRequestHeader(k, v, false);
        });

        // Add Authorization
        let token = this.mSession.accessToken;
        if (token) {
            aChannel.setRequestHeader("Authorization",
                                      "Bearer " + token,
                                      false);
        } else {
            cal.WARN("[calGoogleCalendar] Missing access token for " +
                     aChannel.URI.spec);
        }
    },

    /**
     * @see nsIInterfaceRequestor
     * @see calProviderUtils.jsm
     */
    getInterface: cal.InterfaceRequestor_getInterface,

    /**
     * @see nsIChannelEventSink
     */
    asyncOnChannelRedirect: function cGR_onChannelRedirect(aOldChannel,
                                                           aNewChannel,
                                                           aFlags,
                                                           aCallback) {
        // all we need to do to the new channel is the basic preparation
        this.prepareChannel(aNewChannel);
        aCallback.onRedirectVerifyCallback(Components.results.NS_OK);
    },

    /**
     * @see nsIStreamLoaderObserver
     */
    onStreamComplete: function cGR_onStreamComplete(aLoader,
                                                    aContext,
                                                    aStatus,
                                                    aResultLength,
                                                    aResult) {
        if (!aResult || !Components.isSuccessCode(aStatus)) {
            this.fail(aStatus, aResult);
            return;
        }

        let httpChannel = aLoader.request.QueryInterface(Components.interfaces.nsIHttpChannel);

        // Convert the stream, falling back to utf-8 in case its not given.
        let result = cal.convertByteArray(aResult, aResultLength, httpChannel.contentCharset);
        if (result === null) {
            this.fail(Components.results.NS_ERROR_FAILURE,
                      "Could not convert bytestream to Unicode: " + e);
            return;
        }

        let objData;
        try {
            if (result.length) {
                objData = JSON.parse(result);
            } else {
                objData = { status: "No Content" };
            }
        } catch (e) {
            cal.ERROR("[calGoogleCalendar] Could not parse API response as " +
                      "JSON: " + result);
            this.fail(Components.results.NS_ERROR_FAILURE, result);
        }

        // Calculate Google Clock Skew
        let serverDate = new Date(httpChannel.getResponseHeader("Date"));
        let curDate = new Date();

        // The utility function getCorrectedDate in calGoogleUtils.js receives
        // its clock skew seconds from here. The clock skew is updated on each
        // request and is therefore quite accurate. As this calculation doesn't
        // take latency into account it might overlap 1-2 seconds, but better
        // one event too much than one event too little.
        getCorrectedDate.mClockSkew = Math.floor((curDate.getTime() - serverDate.getTime()) / 1000);
        if (getCorrectedDate.mClockSkew != 0) {
            cal.LOG("[calGoogleRequest] Clock skew is " + getCorrectedDate.mClockSkew + " seconds");
        }

        // Remember when this request happened
        this.requestDate = cal.createDateTime();
        this.requestDate.nativeTime = serverDate.getTime() * 1000;

        cal.LOG("[calGoogleCalendar] Request " + this.method + " " +
                httpChannel.URI.spec + " responded with HTTP "
                + httpChannel.responseStatus);

        // Handle all (documented) error codes
        switch (httpChannel.responseStatus) {
            case 200: /* No error. */
            case 201: /* Creation of a resource was successful. */
            case 204: /* No content */
                // Everything worked out, we are done
                if (this.calendar) {
                    this.calendar.setProperty("currentStatus", 0);
                }
                this.succeed(objData);
                break;
            case 304: /* Not modified */
                this.fail(calGoogleRequest.NOT_MODIFIED, objData);
                break;
            case 401: /* Authorization required. */
            case 403: { /* Unsupported standard parameter, or authentication or
                         Authorization failed. */
                let reason = objData && objData.error &&
                             objData.error.errors && objData.error.errors[0] &&
                             objData.error.errors[0].reason;
                cal.LOG("[calGoogleCalendar] Login failed for " + this.mSession.id +
                        " HTTP Status: " + httpChannel.responseStatus +
                        " Reason: " + (reason || result));
                switch (reason) {
                    case "invalid_client":
                        this.mSession.notifyOutdated();
                        if (this.calendar) {
                            this.calendar.setProperty("disabled", true);
                            this.calendar.setProperty("currentStatus", calGoogleRequest.TOKEN_FAILURE);
                        }
                        this.fail(calGoogleRequest.TOKEN_FAILURE, reason);
                        break;
                    case "unauthorized_client":
                        // This often happens when the client makes a request
                        // authorized with an old api token. Retry the request
                        // once.
                        this.mSession.invalidate();
                        if (this.reauthenticate) {
                            cal.LOG("[calGoogleRequest] The access token is not authorized, trying to refresh token.")
                            this.reauthenticate = false;
                            this.mSession.asyncItemRequest(this);
                        } else {
                            cal.LOG("[calGoogleRequest] Even refreshed token is not authorized, looks like the client is outdated");
                            this.mSession.notifyOutdated();
                            if (this.calendar) {
                                this.calendar.setProperty("disabled", true);
                                this.calendar.setProperty("currentStatus", calGoogleRequest.TOKEN_FAILURE);
                            }
                            this.fail(calGoogleRequest.TOKEN_FAILURE, reason);
                        }
                        break;
                    case "variableTermLimitExceeded":
                    case "userRateLimitExceeded":
                    case "dailyLimitExceeded":
                    case "quotaExceeded":
                        this.mSession.notifyQuotaExceeded();
                        if (this.calendar) {
                            this.calendar.setProperty("disabled", true);
                            this.calendar.setProperty("currentStatus", calGoogleRequest.QUOTA_FAILURE);
                        }
                        this.fail(calGoogleRequest.QUOTA_FAILURE, reason);
                        break;
                    case "insufficientPermissions":
                        if (this.type == this.MODIFY || this.type == this.DELETE || this.type == this.ADD) {
                            this.fail(cIE.MODIFICATION_FAILED, objData);
                        } else {
                            this.fail(cIE.READ_FAILED, objData);
                        }
                        break;
                    case "authError":
                    case "invalidCredentials":
                        this.mSession.invalidate();
                        if (this.reauthenticate) {
                            this.reauthenticate = false;
                            this.mSession.asyncItemRequest(this);
                        } else {
                            this.fail(calGoogleRequest.LOGIN_FAILED, reason);
                        }
                        break;
                    default:
                        if (this.calendar) {
                            this.calendar.setProperty("currentStatus", Components.results.NS_ERROR_FAILURE);
                        }
                        this.fail(Components.results.NS_ERROR_FAILURE, result);
                        break;
                }

                break;
            }
            case 404: /* The resource was not found on the server, which is
                         also a conflict */
                //  404 NOT FOUND: Resource (such as a feed or entry) not found.
                // 410 Gone: Happens when deleting an event that has already
                //           been deleted.
                this.fail(calGoogleRequest.CONFLICT_DELETED, objData);
                break;
            case 410:
                this.fail(calGoogleRequest.RESOURCE_GONE, objData);
                break;
            case 412:
            case 409: /* Specified version number doesn't match resource's
                         latest version number. */
                this.fail(calGoogleRequest.CONFLICT_MODIFY, objData);
                break;
            case 400: {
                // Some bad requests we can handle
                let error = objData && objData.error &&
                            objData.error.errors && objData.error.errors[0];

                if (error.message == "Invalid sync token value.") {
                    this.fail(calGoogleRequest.RESOURCE_GONE, objData);
                    return;
                }
            }
            // Otherwise fall through
            default:
                // The following codes are caught here:
                //  500 INTERNAL SERVER ERROR: Internal error. This is the
                //                             default code that is used for
                //                             all unrecognized errors.
                //

                // Something else went wrong
                let msg = "A request Error Occurred. Status Code: " +
                          httpChannel.responseStatus + " " +
                          httpChannel.responseStatusText + " Body: " +
                          result;
                cal.LOG("[calGoogleCalendar] " + msg);

                this.fail(Components.results.NS_ERROR_NOT_AVAILABLE, msg);
                break;
        }
    }
};
