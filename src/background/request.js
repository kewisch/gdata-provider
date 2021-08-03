/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

export default class calGoogleRequest {
  // static clockSkew = 0

  reauthenticate = true;

  constructor(options) {
    this.options = options;
  }

  get firstError() {
    return this.json?.error?.errors?.[0];
  }

  async handleAuthError(session) {
    switch (this.firstError?.reason) {
      case "invalid_client":
        session.notifyOutdated();
        // TODO disable calendar and set currentStatus to TOKEN_FAILURE
        throw new Error("TOKEN_FAILURE");
      case "unauthorized_client":
      case "invalid_grant":
        await session.invalidate();
        if (this.reauthenticate) {
          console.log("The access token is not authorized, trying to refresh the token");
          this.reauthenticate = false;
          return this.commit(session);
        } else {
          console.log(
            "Even the refreshed token is not authorized, looks like the client is outdated"
          );
          session.notifyOutdated();
          // TODO disable calendar and set currentStatus to TOKEN_FAILURE
          throw new Error("TOKEN_FAILURE");
        }
      case "variableTermLimitExceeded":
      case "userRateLimitExceeded":
      case "dailyLimitExceeded":
      case "quotaExceeded":
        session.notifyQuotaExceeded();
        // TODO disable calendar and set currentStatus to QUOTA_FAILURE
        throw new Error("QUOTA_FAILURE");
      case "insufficientPermissions":
        // TODO proppagate this to the calendar
        if (this.options.method == "GET") {
          throw new Error("READ_FAILED");
        } else {
          throw new Error("MODIFICATION_FAILED");
        }
      case "authError":
      case "invalidCredentials":
        await session.invalidate();
        if (this.reauthenticate) {
          this.reauthenticate = false;
          return this.commit(session);
        } else {
          throw new Error("LOGIN_FAILED");
        }
      default:
        throw new Error("NS_ERROR_FAILURE"); // TODO
    }
  }

  async commit(session) {
    await session.ensureLogin();

    this.options.headers = this.options.headers || {};
    this.options.headers.Authorization = "Bearer " + session.accessToken;

    if (this.options.json) {
      this.options.body = JSON.stringify(this.options.json);
      this.options.headers["Content-Type"] = "application/json; charset=UTF-8";
      delete this.options.json;
    }

    this.options.params = this.options.params || {};
    for (let [key, value] of Object.entries(this.options.params)) {
      if (!value) {
        delete this.options.params[key];
      }
    }

    let uri = new URL(this.options.uri);
    if (Object.keys(this.options.params).length) {
      uri.search = new URLSearchParams(this.options.params);
    }

    this.response = await fetch(uri, this.options);
    try {
      if (this.response.headers.get("Content-Type")?.startsWith("application/json")) {
        this.json = await this.response.json();
      } else if (this.response.headers.get("Content-Length") == "0") {
        this.json = { status: "No Content" };
      } else {
        throw new Error(
          `Received plain response: ${(await this.response.text()).substr(0, 20)}...`
        );
      }
    } catch (e) {
      console.error("Could not parse API response as JSON", e);
      throw e;
    }

    this.responseDate = new Date(this.response.headers.get("Date")).toISOString();

    switch (this.response.status) {
      case 200: /* No error. */
      case 201: /* Creation of a resource was successful. */
      case 204 /* No content */:
        // TODO set currentStatus on calendar
        return this.json;
      case 304:
        // TODO throw not modified?
        throw new Error("NOT_MODIFIED");
      case 401:
      case 403:
        // Unsupported standard parameter, or authentication or Authorization failed.
        console.log(
          `Login failed for ${session.id}. Status: ${this.response.status}. Reason: ${this.firstError?.reason}`
        );
        return this.handleAuthError(session);
      case 404:
        //  404 NOT FOUND: Resource (such as a feed or entry) not found.
        throw new Error("CONFLICT_DELETED");
      case 410:
        // 410 Gone: Happens when deleting an event that has already been deleted.
        throw new Error("RESOURCE_GONE");
      case 409:
      case 412:
        throw new Error("CONFLICT_MODIFY");
      case 400:
        if (this.firstError?.message == "Invalid sync token value.") {
          throw new Error("RESOURCE_GONE");
        }
      // Fall through intended
      default:
        console.log(
          `A request error occurred. Status: ${this.response.status} ${
            this.response.statusText
          }. Body: ${JSON.stringify(this.json, null, 2)}`
        );
        throw new Error("NS_ERROR_NOT_AVAILABLE"); // TODO
    }
  }
}
