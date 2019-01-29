/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Provides OAuth 2.0 authentication
 */
var EXPORTED_SYMBOLS = ["OAuth2"]; /* exported OAuth2 */

// Backwards compatibility with Thunderbird <60.
if (!("Cc" in this)) {
    // eslint-disable-next-line mozilla/no-define-cc-etc, no-unused-vars
    const { interfaces: Ci, results: Cr } = Components;
}

const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { Log4Moz } = ChromeUtils.import("resource:///modules/gloda/log4moz.js");
const { httpRequest } = ChromeUtils.import("resource://gre/modules/Http.jsm");

const { cal } = ChromeUtils.import("resource://gdata-provider/modules/calUtilsShim.jsm");

function parseURLData(aData) {
    let result = {};
    aData.split(/[?#]/, 2)[1].split("&").forEach((aParam) => {
        let [key, value] = aParam.split("=");
        result[key] = value;
    });
    return result;
}

function OAuth2(aBaseURI, aScope, aAppKey, aAppSecret) {
    this.authURI = aBaseURI + "oauth2/auth";
    this.tokenURI = aBaseURI + "oauth2/token";
    this.consumerKey = aAppKey;
    this.consumerSecret = aAppSecret;
    this.scope = aScope;
    this.extraAuthParams = [];

    this.log = Log4Moz.getConfiguredLogger("TBOAuth");
}

OAuth2.CODE_AUTHORIZATION = "authorization_code";
OAuth2.CODE_REFRESH = "refresh_token";

OAuth2.prototype = {

    responseType: "code",
    consumerKey: null,
    consumerSecret: null,
    completionURI: "http://localhost",
    requestWindowURI: "chrome://messenger/content/browserRequest.xul",
    requestWindowFeatures: "chrome,private,centerscreen,width=980,height=750",
    requestWindowTitle: "",
    requestWindowDescription: "",
    scope: null,

    accessToken: null,
    refreshToken: null,
    tokenExpires: 0,
    connecting: false,

    connect: function(aSuccess, aFailure, aWithUI, aRefresh) {
        if (this.connecting) {
            return;
        }

        this.connectSuccessCallback = aSuccess;
        this.connectFailureCallback = aFailure;

        if (!aRefresh && this.accessToken) {
            aSuccess();
        } else if (this.refreshToken) {
            this.connecting = true;
            this.requestAccessToken(this.refreshToken, OAuth2.CODE_REFRESH);
        } else {
            if (!aWithUI) {
                aFailure('{ "error": "auth_noui" }');
                return;
            }
            this.connecting = true;
            this.requestAuthorization();
        }
    },

    requestAuthorization: function() {
        let params = [
            ["response_type", this.responseType],
            ["client_id", this.consumerKey],
            ["redirect_uri", this.completionURI],
        ];
        // The scope can be optional.
        if (this.scope) {
            params.push(["scope", this.scope]);
        }

        // Add extra parameters, if they exist
        Array.prototype.push.apply(params, this.extraAuthParams);

        // Now map the parameters to a string
        params = params.map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");

        this._browserRequest = {
            account: this,
            url: this.authURI + "?" + params,
            description: this.requestWindowDescription,
            _active: true,
            iconURI: "",
            cancelled: function() {
                if (!this._active) {
                    return;
                }

                this.account.finishAuthorizationRequest();
                this.account.onAuthorizationFailed(Cr.NS_ERROR_ABORT, '{ "error": "cancelled"}');
            },

            loaded: function(aWindow, aWebProgress) {
                if (!this._active) {
                    return;
                }

                this._listener = {
                    window: aWindow,
                    webProgress: aWebProgress,
                    _parent: this.account,

                    QueryInterface: cal.generateQI([
                        Ci.nsIWebProgressListener,
                        Ci.nsISupportsWeakReference
                    ]),

                    _cleanUp: function() {
                        this.webProgress.removeProgressListener(this);
                        this.window.close();
                        delete this.window;
                    },

                    _checkForRedirect: function(aURL) {
                        if (!aURL.startsWith(this._parent.completionURI)) {
                            return;
                        }

                        this._parent.finishAuthorizationRequest();
                        this._parent.onAuthorizationReceived(aURL);
                    },

                    onStateChange: function(aChangedWebProgress, aRequest, aStateFlags, aStatus) {
                        const wpl = Ci.nsIWebProgressListener;
                        if (aStateFlags & (wpl.STATE_STOP)) {
                            try {
                                let httpchannel = aRequest.QueryInterface(Ci.nsIHttpChannel);

                                let responseCategory = Math.floor(httpchannel.responseStatus / 100);

                                if (responseCategory != 2 && responseCategory != 3) {
                                    this._parent.finishAuthorizationRequest();
                                    this._parent.onAuthorizationFailed(null, '{ "error": "http_' + httpchannel.responseStatus + '" }');
                                }
                            } catch (e) {
                                // Throw the case where it's a http channel.
                                if (e.result != Cr.NS_ERROR_NO_INTERFACE) {
                                    throw e;
                                }
                            }
                        }

                        if (aStateFlags & (wpl.STATE_START | wpl.STATE_IS_NETWORK)) {
                            this._checkForRedirect(aRequest.name);
                        }
                    },
                    onLocationChange: function(aChangedWebProgress, aRequest, aLocation) {
                        this._checkForRedirect(aLocation.spec);
                    },
                    onProgressChange: function() {},
                    onStatusChange: function() {},
                    onSecurityChange: function() {},
                };
                aWebProgress.addProgressListener(this._listener, Ci.nsIWebProgress.NOTIFY_ALL);
                aWindow.document.title = this.account.requestWindowTitle;
            }
        };

        this.wrappedJSObject = this._browserRequest;
        Services.ww.openWindow(null, this.requestWindowURI, null, this.requestWindowFeatures, this);
    },
    finishAuthorizationRequest: function() {
        if (!("_browserRequest" in this)) {
            return;
        }

        this._browserRequest._active = false;
        if ("_listener" in this._browserRequest) {
            this._browserRequest._listener._cleanUp();
        }
        delete this._browserRequest;
    },

    onAuthorizationReceived: function(aData) {
        this.log.info("authorization received" + aData);
        let results = parseURLData(aData);
        if (this.responseType == "code") {
            this.requestAccessToken(results.code, OAuth2.CODE_AUTHORIZATION);
        } else if (this.responseType == "token") {
            this.onAccessTokenReceived(JSON.stringify(results));
        }
    },

    onAuthorizationFailed: function(aError, aData) {
        this.connecting = false;
        this.connectFailureCallback(aData);
    },

    requestAccessToken: function(aCode, aType) {
        let params = [
            ["client_id", this.consumerKey],
            ["client_secret", this.consumerSecret],
            ["grant_type", aType],
        ];

        if (aType == OAuth2.CODE_AUTHORIZATION) {
            params.push(["code", aCode]);
            params.push(["redirect_uri", this.completionURI]);
        } else if (aType == OAuth2.CODE_REFRESH) {
            params.push(["refresh_token", aCode]);
        }

        let options = {
            postData: params,
            onLoad: this.onAccessTokenReceived.bind(this),
            onError: this.onAccessTokenFailed.bind(this)
        };
        httpRequest(this.tokenURI, options);
    },

    onAccessTokenFailed: function(aError, aData) {
        if (aError != "offline") {
            this.refreshToken = null;
        }
        this.connecting = false;
        this.connectFailureCallback(aData);
    },

    onAccessTokenReceived: function(aData) {
        let result = JSON.parse(aData);

        this.accessToken = result.access_token;
        if ("refresh_token" in result) {
            this.refreshToken = result.refresh_token;
        }
        if ("expires_in" in result) {
            this.tokenExpires = (new Date()).getTime() + (result.expires_in * 1000);
        } else {
            this.tokenExpires = Number.MAX_VALUE;
        }
        this.tokenType = result.token_type;

        this.connecting = false;
        this.connectSuccessCallback();
    }
};
