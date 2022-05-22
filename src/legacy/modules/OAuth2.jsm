/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
  "OAuth2.jsm"
);

/**
 * Provides OAuth 2.0 authentication
 */
var EXPORTED_SYMBOLS = ["OAuth2"]; /* exported OAuth2 */

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { httpRequest } = ChromeUtils.import("resource://gre/modules/Http.jsm");

function OAuth2(aBaseURI, aScope, aAppKey, aAppSecret) {
  // aBaseURI was used historically. Until we complete the MailExtensions rewrite, we'll use authURI
  // and tokenURI directly.

  this.consumerKey = aAppKey;
  this.consumerSecret = aAppSecret;
  this.scope = aScope;
  this.extraAuthParams = [];

  this.log = console.createInstance({
    prefix: "gdata.oauth",
    maxLogLevel: "Warn",
    maxLogLevelPref: "mailnews.oauth.loglevel",
  });
}

OAuth2.CODE_AUTHORIZATION = "authorization_code";
OAuth2.CODE_REFRESH = "refresh_token";

OAuth2.prototype = {
  responseType: "code",
  consumerKey: null,
  consumerSecret: null,

  authURI: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenURI: "https://oauth2.googleapis.com/token",
  redirectURI: "urn:ietf:wg:oauth:2.0:oob:auto",
  completionURI: "https://accounts.google.com/o/oauth2/approval/v2",
  errorURI: "https://accounts.google.com/signin/oauth/error",

  requestWindowURI: "chrome://messenger/content/browserRequest.xhtml",
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
      ["redirect_uri", this.redirectURI],
    ];
    // The scope can be optional.
    if (this.scope) {
      params.push(["scope", this.scope]);
    }

    // Add extra parameters, if they exist
    Array.prototype.push.apply(params, this.extraAuthParams);

    // Now map the parameters to a string
    params = params.map(([key, value]) => key + "=" + encodeURIComponent(value)).join("&");

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

          QueryInterface: ChromeUtils.generateQI([
            "nsIWebProgressListener",
            "nsISupportsWeakReference",
          ]),

          _cleanUp: function() {
            this.webProgress.removeProgressListener(this);
            this.window.close();
            delete this.window;
          },

          _checkForRedirect: function(aURL) {
            if (aURL.startsWith(this._parent.completionURI)) {
              this._parent.finishAuthorizationRequest();
              this._parent.onAuthorizationReceived(aURL);
            } else if (aURL.startsWith(this._parent.errorURI)) {
              let url = new URL(aURL);
              let authError = atob(url.searchParams.get("authError") || "");
              // eslint-disable-next-line no-control-regex
              let authErrorCode = authError.match(/\x13(.*?)\x12/);

              this._parent.finishAuthorizationRequest();
              this._parent.onAuthorizationFailed(
                null,
                JSON.stringify({
                  error: authErrorCode?.[1] || authError,
                  details: authError,
                })
              );
            }
          },

          onStateChange: function(aChangedWebProgress, aRequest, aStateFlags, aStatus) {
            const wpl = Ci.nsIWebProgressListener;
            if (aStateFlags & wpl.STATE_STOP) {
              try {
                let httpchannel = aRequest.QueryInterface(Ci.nsIHttpChannel);

                let responseCategory = Math.floor(httpchannel.responseStatus / 100);

                if (responseCategory != 2 && responseCategory != 3) {
                  this._parent.finishAuthorizationRequest();
                  this._parent.onAuthorizationFailed(
                    null,
                    '{ "error": "http_' + httpchannel.responseStatus + '" }'
                  );
                }
              } catch (e) {
                // Throw the case where it's a http channel.
                if (e.result != Cr.NS_ERROR_NO_INTERFACE && e.result != Cr.NS_ERROR_NOT_AVAILABLE) {
                  throw e;
                }
              }
            }

            if (aStateFlags & (wpl.STATE_START | wpl.STATE_IS_NETWORK)) {
              try {
                this._checkForRedirect(aRequest.QueryInterface(Ci.nsIChannel).URI.spec);
              } catch (e) {
                // Get rid of these annoying errors
              }
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
      },
    };

    this.wrappedJSObject = this._browserRequest;
    let parent = Services.wm.getMostRecentWindow("mail:3pane");
    Services.ww.openWindow(parent, this.requestWindowURI, null, this.requestWindowFeatures, this);
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
    let params = new URL(aData).searchParams;
    if (this.responseType == "code") {
      this.requestAccessToken(params.get("approvalCode"), OAuth2.CODE_AUTHORIZATION);
    } else if (this.responseType == "token") {
      this.onAccessTokenReceived(JSON.stringify(Object.fromEntries(params.entries())));
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
      params.push(["redirect_uri", this.redirectURI]);
    } else if (aType == OAuth2.CODE_REFRESH) {
      params.push(["refresh_token", aCode]);
    }

    let options = {
      postData: params,
      onLoad: this.onAccessTokenReceived.bind(this),
      onError: this.onAccessTokenFailed.bind(this),
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
      this.tokenExpires = new Date().getTime() + result.expires_in * 1000;
    } else {
      this.tokenExpires = Number.MAX_VALUE;
    }
    this.tokenType = result.token_type;

    this.connecting = false;
    this.connectSuccessCallback();
  },
};
