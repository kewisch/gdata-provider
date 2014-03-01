/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

/**
 * calGoogleRequest
 * This class represents a HTTP request sent to Google
 *
 * @constructor
 * @class
 */
function calGoogleRequest(aSession) {
    this.mQueryParameters = new Array();
    this.mSession = aSession;
    this.wrappedJSObject = this;
}
const calGoogleRequestClassID = Components.ID("{53a3438a-21bc-4a0f-b813-77a8b4f19282}");
const calGoogleRequestInterfaces = [
    Components.interfaces.calIGoogleRequest,
    Components.interfaces.calIOperation,
    Components.interfaces.nsIStreamLoaderObserver,
    Components.interfaces.nsIInterfaceRequestor,
    Components.interfaces.nsIChannelEventSink
];
calGoogleRequest.prototype = {

    /* Members */
    mUploadContent: null,
    mUploadData: null,
    mSession: null,
    mExtraData: null,
    mQueryParameters: null,
    mType: null,
    mCalendar: null,
    mLoader: null,
    mStatus: Components.results.NS_OK,

    /* Constants */
    LOGIN: 0,
    ADD: 1,
    MODIFY: 2,
    DELETE: 3,
    GET: 4,

    /* Simple Attributes */
    method: "GET",
    id: null,
    uri: null,
    responseListener: null,
    operationListener: null,
    reauthenticate: true,

    itemRangeStart: null,
    itemRangeEnd: null,
    itemFilter: null,
    itemId: null,
    calendar: null,
    newItem: null,
    oldItem: null,
    destinationCal: null,

    classID: calGoogleRequestClassID,
    QueryInterface: XPCOMUtils.generateQI(calGoogleRequestInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calGoogleRequestClassID,
        contractID: "@mozilla.org/calendar/providers/gdata/request;1",
        classDescription: "Google Calendar Request",
        interfaces: calGoogleRequestInterfaces
    }),

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
            this.mLoader.request.cancel(aStatus);
            this.mStatus = aStatus;
        }
    },

    /**
     * attribute type
     * The type of this reqest. Must be one of
     * LOGIN, GET, ADD, MODIFY, DELETE
     * This also sets the Request Method and for the LOGIN request also the uri
     */
    get type() { return this.mType; },

    set type(v) {
        switch (v) {
            case this.LOGIN:
                this.method = "POST";
                this.uri = "https://www.google.com/accounts/ClientLogin";
                break;
            case this.GET:
                this.method = "GET";
                break;
            case this.ADD:
                this.method = "POST";
                break;
            case this.MODIFY:
                this.method = "PUT";
                break;
            case this.DELETE:
                this.method = "DELETE";
                break;
            default:
                throw new Components.Exception("", Components.results.NS_ERROR_ILLEGAL_VALUE);
                break;
        }
        this.mType = v;
        return v;
    },

    /**
     * setUploadData
     * The HTTP body data for a POST or PUT request.
     *
     * @param aContentType The Content type of the Data
     * @param aData        The Data to upload
     */
    setUploadData: function cGR_setUploadData(aContentType, aData) {
        this.mUploadContent = aContentType;
        this.mUploadData = aData;
    },

    /**
     * addQueryParameter
     * Adds a query parameter to this request. This will be used in conjunction
     * with the uri.
     *
     * @param aKey      The key of the request parameter.
     * @param aValue    The value of the request parameter. This parameter will
     *                  be escaped.
     */
    addQueryParameter: function cGR_addQueryParameter(aKey, aValue) {
        if (aValue == null || aValue == "") {
            // Silently ignore empty values.
            return;
        }
        this.mQueryParameters.push(aKey + "=" + encodeURIComponent(aValue));
    },

    /**
     * commit
     * Starts the request process. This can be called multiple times if the
     * request should be repeated
     *
     * @param aSession  The session object this request should be made with.
     *                  This parameter is optional
     */
    commit: function cGR_commit(aSession) {

        try {
            // Set the session to request with
            if (aSession) {
                this.mSession = aSession;
            }

            let uristring = this.uri;
            if (this.mQueryParameters.length > 0) {
                uristring += "?" + this.mQueryParameters.join("&");
            }
            let uri = Services.io.newURI(uristring, null, null);
            let channel = Services.io.newChannelFromURI(uri);

            this.prepareChannel(channel);

            channel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
            channel.redirectionLimit = 3;

            this.mLoader = cal.createStreamLoader();

            cal.LOG("[calGoogleCalendar] Requesting " + this.method + " " +
                    channel.URI.spec);

            channel.notificationCallbacks = this;

            cal.sendHttpRequest(this.mLoader, channel, this);
        } catch (e) {
            // Let the response function handle the error that happens here
            this.fail(e.result, e.message);
        }
    },

    /**
     * fail
     * Call this request's listener with the given code and Message
     *
     * @param aCode     The Error code to fail with
     * @param aMessage  The Error message. If this is null, an error Message
     *                  from calIGoogleErrors will be used.
     */
    fail: function cGR_fail(aCode, aMessage) {
        this.mLoader = null;
        this.mStatus = aCode;
        this.responseListener.onResult(this, aMessage);
    },

    /**
     * succeed
     * Call this request's listener with a Success Code and the given Result.
     *
     * @param aResult   The result Text of this request.
     */
    succeed: function cGR_succeed(aResult) {
        // Succeeding is nothing more than failing with the result code set to
        // NS_OK.
        this.fail(Components.results.NS_OK, aResult);
    },

    /**
     * prepareChannel
     * Prepares the passed channel to match this objects properties
     *
     * @param aChannel    The Channel to be prepared
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

            if (this.mType == this.LOGIN) {
                cal.LOG("[calGoogleCalendar] Setting upload data for login request (hidden)");
            } else {
                cal.LOG("[calGoogleCalendar] Setting Upload Data (" +
                        this.mUploadContent + "):\n" + this.mUploadData);
            }
        }

        aChannel  = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);

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

        // Add Authorization
        if (this.mSession.authToken) {
            aChannel.setRequestHeader("Authorization",
                                      "GoogleLogin auth="
                                      +  this.mSession.authToken,
                                      false);
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

        // Calculate Google Clock Skew
        let serverDate = new Date(httpChannel.getResponseHeader("Date"));
        let curDate = new Date();

        // The utility function getCorrectedDate in calGoogleUtils.js receives
        // its clock skew seconds from here. The clock skew is updated on each
        // request and is therefore quite accurate.
        getCorrectedDate.mClockSkew = curDate.getTime() - serverDate.getTime();

        // Remember when this request happened
        this.requestDate = cal.jsDateToDateTime(serverDate);

        // Handle all (documented) error codes
        switch (httpChannel.responseStatus) {
            case 200: /* No error. */
            case 201: /* Creation of a resource was successful. */
                // Everything worked out, we are done
                this.succeed(result);
                break;

            case 401: /* Authorization required. */
            case 403: /* Unsupported standard parameter, or authentication or
                         Authorization failed. */
                cal.LOG("[calGoogleCalendar] Login failed for " + this.mSession.userName +
                        " HTTP Status " + httpChannel.responseStatus);

                // login failed. auth token must be invalid, password too

                if (this.type == this.MODIFY ||
                    this.type == this.DELETE ||
                    this.type == this.ADD) {
                    // Encountering this error on a write request means the
                    // calendar is readonly
                    this.fail(Components.interfaces.calIErrors.CAL_IS_READONLY, result);
                } else if (!this.reauthenticate) {
                    // If no reauth was requested, then don't invalidate the
                    // whole session and just bail out
                    this.fail(kGOOGLE_LOGIN_FAILED, result);
                } else if (this.type == this.LOGIN) {
                    // If this was a login request itself, then fail it.
                    // That will take care of logging in again
                    this.mSession.invalidate();
                    this.fail(kGOOGLE_LOGIN_FAILED, result);
                } else {
                    // Retry the request. Invalidating the session will trigger
                    // a new login dialog.
                    this.mSession.invalidate();
                    this.mSession.asyncItemRequest(this);
                }

                break;
            case 404: /* The resource was not found on the server, which is
                         also a conflict */
                //  404 NOT FOUND: Resource (such as a feed or entry) not found.
                this.fail(kGOOGLE_CONFLICT_DELETED, "");
                break;
            case 409: /* Specified version number doesn't match resource's
                         latest version number. */
                this.fail(kGOOGLE_CONFLICT_MODIFY, result);
                break;
            case 400:
                //  400 BAD REQUEST: Invalid request URI or header, or
                //                   unsupported nonstandard parameter.

                // HACK Ugh, this sucks. If we send a lower sequence number, Google
                // will throw a 400 and not a 409, even though both cases are a conflict.
                if (result == "Cannot decrease the sequence number of an event") {
                    this.fail(kGOOGLE_CONFLICT_MODIFY, "SEQUENCE-HACK");
                    break;
                }

                // Otherwise fall through
            default:
                // The following codes are caught here:
                //  500 INTERNAL SERVER ERROR: Internal error. This is the
                //                             default code that is used for
                //                             all unrecognized errors.
                //

                // Something else went wrong
                let error = "A request Error Occurred. Status Code: " +
                            httpChannel.responseStatus + " " +
                            httpChannel.responseStatusText + " Body: " +
                            result;

                this.fail(Components.results.NS_ERROR_NOT_AVAILABLE, error);
                break;
        }
    }
};
