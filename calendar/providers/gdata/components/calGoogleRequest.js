/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Google Calendar Provider code.
 *
 * The Initial Developer of the Original Code is
 *   Philipp Kewisch <mozilla@kewis.ch>
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

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

calGoogleRequest.prototype = {

    /* Members */
    uri: null,
    mUploadContent: null,
    mUploadData: null,
    responseListener: null,
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

    QueryInterface: function cGR_QueryInterface(aIID) {
        return doQueryInterface(this,
                                calGoogleRequest.prototype,
                                aIID,
                                null,
                                g_classInfo["calGoogleRequest"]);
    },

    /**
     * Implement calIOperation
     */
    get isPending cGR_getIsPending() {
        return (this.mLoader && this.mLoader.request != null);
    },

    get status cGR_status() {
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
    get type cGR_getType() { return this.mType; },

    set type cGR_setType(v) {
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
        if (this.mType == this.LOGIN) {
            LOG("Setting upload data for login request (hidden)");
        } else {
            LOG({action:"Setting Upload Data:",
                 content:aContentType,
                 data:aData});
        }
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

            // create the channel
            var ioService = Components.classes["@mozilla.org/network/io-service;1"].
                            getService(Components.interfaces.nsIIOService);

            var uristring = this.uri;
            if (this.mQueryParameters.length > 0) {
                uristring += "?" + this.mQueryParameters.join("&");
            }
            var uri = ioService.newURI(uristring, null, null);
            var channel = ioService.newChannelFromURI(uri);

            this.prepareChannel(channel);

            channel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
            channel.redirectionLimit = 3;

            this.mLoader = cal.createStreamLoader();

            LOG("calGoogleRequest: Requesting " + this.method + " " +
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
            var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
                            createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
            converter.charset = "UTF-8";

            var stream = converter.convertToInputStream(this.mUploadData);
            aChannel = aChannel.QueryInterface(Components.interfaces.nsIUploadChannel);
            aChannel.setUploadStream(stream, this.mUploadContent, -1);
        }

        aChannel  = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);

        // Depending on the preference, we will use X-HTTP-Method-Override to
        // get around some proxies. This will default to true.
        if (getPrefSafe("calendar.google.useHTTPMethodOverride", true) &&
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
    onChannelRedirect: function cGR_onChannelRedirect(aOldChannel,
                                                      aNewChannel,
                                                      aFlags) {
        // all we need to do to the new channel is the basic preparation
        this.prepareChannel(aNewChannel);
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

        var httpChannel = aLoader.request.QueryInterface(Components.interfaces.nsIHttpChannel);

        // Convert the stream, falling back to utf-8 in case its not given.
        let result = cal.convertByteArray(aResult, aResultLength, httpChannel.contentCharset);
        if (result === null) {
            this.fail(Components.results.NS_ERROR_FAILURE,
                      "Could not convert bytestream to Unicode: " + e);
            return;
        }

        // Calculate Google Clock Skew
        var serverDate = new Date(httpChannel.getResponseHeader("Date"));
        var curDate = new Date();

        // The utility function getCorrectedDate in calGoogleUtils.js recieves
        // its clock skew seconds from here. The clock skew is updated on each
        // request and is therefore quite accurate.
        getCorrectedDate.mClockSkew = curDate.getTime() - serverDate.getTime();

        // Remember when this request happened
        this.requestDate = jsDateToDateTime(serverDate);

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
                LOG("Login failed for " + this.mSession.userName +
                    " HTTP Status " + httpChannel.responseStatus );

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
            case 409: /* Specified version number doesn't match resource's
                         latest version number. */

                // 409 Conflict. The client should get a newer version of the
                // event
                // and edit that one.

                // TODO Enhancement tracked in bug 362645
                // Fall through, if 409 is not handled then the event is not
                // modified/deleted, which is definitly an error.
            default:
                // The following codes are caught here:
                //  400 BAD REQUEST: Invalid request URI or header, or
                //                   unsupported nonstandard parameter.
                //  404 NOT FOUND: Resource (such as a feed or entry) not found.
                //  500 INTERNAL SERVER ERROR: Internal error. This is the
                //                             default code that is used for
                //                             all unrecognized errors.
                //

                // Something else went wrong
                var error = "A request Error Occurred. Status Code: " +
                            httpChannel.responseStatus + " " +
                            httpChannel.responseStatusText + " Body: " +
                            result;

                this.fail(Components.results.NS_ERROR_FAILURE, error);
                break;
        }
    }
};
