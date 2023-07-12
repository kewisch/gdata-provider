/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
  "OAuth2.jsm"
);

/**
 * Provides OAuth 2.0 authentication.
 *
 * @see RFC 6749
 */
var EXPORTED_SYMBOLS = ["OAuth2"]; /* exported OAuth2 */

var Services =
  globalThis.Services || ChromeUtils.import("resource://gre/modules/Services.jsm").Services; // Thunderbird 103 compat

// Only allow one connecting window per endpoint.
var gConnecting = {};

/**
 * Constructor for the OAuth2 object.
 */
function OAuth2(aBaseURI, aScope, aAppKey, aAppSecret) {
  // aBaseURI was used historically. Until we complete the MailExtensions rewrite, we'll use authURI
  // and tokenEndpoint directly.

  this.clientId = aAppKey;
  this.consumerSecret = aAppSecret;
  this.scope = aScope;
  this.extraAuthParams = [];
  this.randomizePort();

  this.log = console.createInstance({
    prefix: "gdata.oauth",
    maxLogLevel: "Warn",
    maxLogLevelPref: "mailnews.oauth.loglevel",
  });
}

OAuth2.prototype = {
  clientId: null,
  consumerSecret: null,

  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  redirectionEndpoint: "https://localhost:226/",
  errorEndpoint: "https://accounts.google.com/signin/oauth/error",

  requestWindowURI: "chrome://messenger/content/browserRequest.xhtml",
  requestWindowFeatures: "chrome,private,centerscreen,width=980,height=750",
  requestWindowTitle: "",
  requestWindowDescription: "",
  scope: null,

  accessToken: null,
  refreshToken: null,
  tokenExpires: 0,

  connect(aSuccess, aFailure, aWithUI, aRefresh) {
    this.connectSuccessCallback = aSuccess;
    this.connectFailureCallback = aFailure;

    if (this.accessToken && !this.tokenExpired && !aRefresh) {
      aSuccess();
    } else if (this.refreshToken) {
      this.requestAccessToken(this.refreshToken, true);
    } else {
      if (!aWithUI) {
        aFailure('{ "error": "auth_noui" }');
        return;
      }
      if (gConnecting[this.authorizationEndpoint]) {
        aFailure("Window already open");
        return;
      }
      this.requestAuthorization();
    }
  },

  /**
   * True if the token has expired, or will expire within the grace time.
   */
  get tokenExpired() {
    // 30 seconds to allow for network inefficiency, clock drift, etc.
    const OAUTH_GRACE_TIME_MS = 30 * 1000;
    return this.tokenExpires - OAUTH_GRACE_TIME_MS < Date.now();
  },

  randomizePort() {
    let randomPort = Math.floor(Math.random() * (65535 - 49152 + 1) + 49152);
    this.redirectionEndpoint = `https://localhost:${randomPort}/`;
    this.completionRE = new RegExp("^https?://localhost:" + randomPort + "/");
    return this.redirectionEndpoint;
  },

  requestAuthorization() {
    let params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.randomizePort(),
    });

    // The scope is optional.
    if (this.scope) {
      params.append("scope", this.scope);
    }

    for (let [name, value] of this.extraAuthParams) {
      params.append(name, value);
    }

    let authEndpointURI = this.authorizationEndpoint + "?" + params.toString();
    this.log.info(
      "Interacting with the resource owner to obtain an authorization grant " +
        "from the authorization endpoint: " +
        authEndpointURI
    );

    this._browserRequest = {
      account: this,
      url: authEndpointURI,
      description: this.requestWindowDescription,
      _active: true,
      iconURI: "",
      cancelled() {
        if (!this._active) {
          return;
        }

        this.account.finishAuthorizationRequest();
        this.account.onAuthorizationFailed(Cr.NS_ERROR_ABORT, '{ "error": "cancelled"}');
      },

      loaded(aWindow, aWebProgress) {
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

          _cleanUp() {
            this.webProgress.removeProgressListener(this);
            this.window.close();
            delete this.window;
          },

          _checkForRedirect(aURL) {
            if (aURL.match(this._parent.completionRE)) {
              this._parent.finishAuthorizationRequest();
              this._parent.onAuthorizationReceived(aURL);
            } else if (aURL.startsWith(this._parent.errorEndpoint)) {
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

          onStateChange(aChangedWebProgress, aRequest, aStateFlags, aStatus) {
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
          onLocationChange(aChangedWebProgress, aRequest, aLocation) {
            this._checkForRedirect(aLocation.spec);
          },
          onProgressChange() {},
          onStatusChange() {},
          onSecurityChange() {},
        };
        aWebProgress.addProgressListener(this._listener, Ci.nsIWebProgress.NOTIFY_ALL);
        aWindow.document.title = this.account.requestWindowTitle;
      },
    };

    this.wrappedJSObject = this._browserRequest;
    let parent = Services.wm.getMostRecentWindow("mail:3pane");
    gConnecting[this.authorizationEndpoint] = true;
    Services.ww.openWindow(parent, this.requestWindowURI, null, this.requestWindowFeatures, this);
  },
  finishAuthorizationRequest() {
    gConnecting[this.authorizationEndpoint] = false;
    if (!("_browserRequest" in this)) {
      return;
    }

    this._browserRequest._active = false;
    if ("_listener" in this._browserRequest) {
      this._browserRequest._listener._cleanUp();
    }
    delete this._browserRequest;
  },

  // @see RFC 6749 section 4.1.2: Authorization Response
  onAuthorizationReceived(aURL) {
    this.log.info("OAuth2 authorization received: url=" + aURL);
    const url = new URL(aURL);
    if (url.searchParams.has("code")) {
      this.requestAccessToken(url.searchParams.get("code"), false);
    } else {
      this.onAuthorizationFailed(null, aURL);
    }
  },

  onAuthorizationFailed(aError, aData) {
    this.connectFailureCallback(aData);
  },

  /**
   * Request a new access token, or refresh an existing one.
   *
   * @param {string} aCode - The token issued to the client.
   * @param {boolean} aRefresh - Whether it's a refresh of a token or not.
   */
  requestAccessToken(aCode, aRefresh) {
    // @see RFC 6749 section 4.1.3. Access Token Request
    // @see RFC 6749 section 6. Refreshing an Access Token

    let data = new URLSearchParams();
    data.append("client_id", this.clientId);
    if (this.consumerSecret !== null) {
      // Section 2.3.1. of RFC 6749 states that empty secrets MAY be omitted
      // by the client. This OAuth implementation delegates this decision to
      // the caller: If the secret is null, it will be omitted.
      data.append("client_secret", this.consumerSecret);
    }

    if (aRefresh) {
      this.log.info(`Making a refresh request to the token endpoint: ${this.tokenEndpoint}`);
      data.append("grant_type", "refresh_token");
      data.append("refresh_token", aCode);
    } else {
      this.log.info(`Making access token request to the token endpoint: ${this.tokenEndpoint}`);
      data.append("grant_type", "authorization_code");
      data.append("code", aCode);
      data.append("redirect_uri", this.redirectionEndpoint);
    }

    fetch(this.tokenEndpoint, {
      method: "POST",
      cache: "no-cache",
      body: data,
    })
      .then(response => response.json())
      .then(result => {
        let resultStr = JSON.stringify(result, null, 2);
        if ("error" in result) {
          // RFC 6749 section 5.2. Error Response
          let err = result.error;
          if ("error_description" in result) {
            err += "; " + result.error_description;
          }
          if ("error_uri" in result) {
            err += "; " + result.error_uri;
          }
          this.log.warn(`Error response from the authorization server: ${err}`);
          this.log.info(`Error response details: ${resultStr}`);

          // Typically in production this would be {"error": "invalid_grant"}.
          // That is, the token expired or was revoked (user changed password?).
          // Reset the tokens we have and call success so that the auth flow
          // will be re-triggered.
          this.accessToken = null;
          this.refreshToken = null;
          this.connectSuccessCallback();
          return;
        }

        // RFC 6749 section 5.1. Successful Response
        this.log.info(`Successful response from the authorization server: ${resultStr}`);

        this.accessToken = result.access_token;
        if ("refresh_token" in result) {
          this.refreshToken = result.refresh_token;
        }
        if ("expires_in" in result) {
          this.tokenExpires = new Date().getTime() + result.expires_in * 1000;
        } else {
          this.tokenExpires = Number.MAX_VALUE;
        }

        this.connectSuccessCallback();
      })
      .catch(err => {
        this.log.info(`Connection to authorization server failed: ${err}`);
        this.connectFailureCallback(err);
      });
  },
};
