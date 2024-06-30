/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import Console from "./log.js";
import {
  TokenFailureError, QuotaFailureError, LoginFailedError, NotModifiedError, ResourceGoneError, ItemError,
  ModifyFailedError, ReadFailedError, ConflictError, GoogleRequestError
} from "./errors.js";

export default class calGoogleRequest {
  // static clockSkew = 0

  reauthenticate = true;

  constructor(options) {
    this.options = options;
    this.console = new Console(`calGoogleRequest(${this.calendar?.id})`);
  }

  get firstError() {
    return this.json?.error?.errors?.[0];
  }

  async handleAuthError(session) {
    switch (this.firstError?.reason) {
      case "invalid_client":
        session.notifyOutdated();
        throw new TokenFailureError();
      case "unauthorized_client":
      case "invalid_grant":
        await session.invalidate();
        if (this.reauthenticate) {
          this.console.log("The access token is not authorized, trying to refresh the token");
          this.reauthenticate = false;
          return this.commit(session);
        } else {
          this.console.log(
            "Even the refreshed token is not authorized, looks like the client is outdated"
          );
          session.notifyOutdated();
          throw new TokenFailureError();
        }
      case "variableTermLimitExceeded":
      case "userRateLimitExceeded":
      case "dailyLimitExceeded":
      case "quotaExceeded":
        session.notifyQuotaExceeded();
        throw new QuotaFailureError();
      case "insufficientPermissions":
        if (this.options.method == "GET") {
          throw new ReadFailedError();
        } else {
          throw new ModifyFailedError();
        }
      case "authError":
      case "invalidCredentials":
        await session.invalidate();
        if (this.reauthenticate) {
          this.reauthenticate = false;
          return this.commit(session);
        } else {
          throw new LoginFailedError();
        }
      default:
        throw new ItemError();
    }
  }

  async commit(session) {
    await session.waitForBackoff();

    try {
      return await this.#commit(session);
    } catch (e) {
      if (e instanceof GoogleRequestError) {
        if (this.options.calendar) {
          let updateProps = { lastError: e.message };
          if (e.DISABLE) {
            updateProps.enabled = false;
          }
          await messenger.calendar.calendars.update(this.options.calendar.id, updateProps);
        }
      }
      throw e;
    }
  }

  async #commit(session) {
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
    uri.search = new URLSearchParams(Object.entries(this.options.params).reduce((acc, param) => {
      if (Array.isArray(param[1])) {
        acc.push(...param[1].map(arrayParamValue => [param[0], arrayParamValue]));
      } else {
        acc.push(param);
      }
      return acc;
    }, []));

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
        if (this.options.calendar) {
          await messenger.calendar.calendars.update(this.options.calendar.id, {
            lastError: null
          });
        }
        return this.json;
      case 304:
        throw new NotModifiedError();
      case 401:
      case 403:
        // Unsupported standard parameter, or authentication or Authorization failed.
        this.console.log(
          `Login failed for ${session.id}. Status: ${this.response.status}. Reason: ${this.firstError?.reason}`
        );
        return this.handleAuthError(session);
      case 410:
        // 410 Gone: Happens when deleting an event that has already been deleted.
        throw new ResourceGoneError();
      case 404:
        //  404 NOT FOUND: Resource (such as a feed or entry) not found.
        // This happens when deleting an event that has already been deleted, fall through
        throw new ResourceGoneError();
      case 409:
      case 412:
        throw new ConflictError();
      case 400:
        if (this.firstError?.message == "Invalid sync token value.") {
          throw new ResourceGoneError();
        }
      // Fall through intended
      default:
        this.console.log(
          `A request error occurred. Status: ${this.response.status} ${
            this.response.statusText
          }. Body: ${JSON.stringify(this.json, null, 2)}`
        );
        throw new ItemError();
    }
  }
}
