/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

export class GoogleRequestError extends Error {

}

export class TokenFailureError extends GoogleRequestError {
  DISABLE = true;

  constructor() {
    super("TOKEN_FAILURE");
  }
}

export class QuotaFailureError extends GoogleRequestError {
  DISABLE = true;

  constructor() {
    super("QUOTA_FAILURE");
  }
}

export class LoginFailedError extends GoogleRequestError {
  constructor() {
    super("LOGIN_FAILED");
  }
}
export class NotModifiedError extends GoogleRequestError {
  constructor() {
    super("NOT_MODIFIED");
  }
}
export class ResourceGoneError extends GoogleRequestError {
  constructor() {
    super("RESOURCE_GONE");
  }
}

export class ItemError extends GoogleRequestError {
  itemErrorCode = "GENERAL_FAILURE";

  get message() {
    return this.itemErrorCode;
  }
}

export class ModifyFailedError extends ItemError {
  itemErrorCode = "MODIFY_FAILED";
}

export class ReadFailedError extends ItemError {
  itemErrorCode = "READ_FAILED";
}

export class ConflictError extends ItemError {
  itemErrorCode = "CONFLICT";
}
