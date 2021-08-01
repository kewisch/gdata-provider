/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

// eslint-disable-next-line no-control-regex
const EMAIL_REGEX = /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;

export const GCAL_PATH_RE = /\/calendar\/(feeds|ical)\/([^/]+)\/(public|private|free-busy)-?([^/]+)?\/(full|basic)(.ics)?$/;

export const NOTIFY_TIMEOUT = 60000;

export const API_BASE = {
  EVENTS: "https://www.googleapis.com/calendar/v3/",
  TASKS: "https://www.googleapis.com/tasks/v1/",
};

export const UTC = "UTC"; // TODO

export function isEmail(email) {
  return !!email.match(EMAIL_REGEX);
}

export function fromRFC3339(entry, zone) {
  // TODO
}

export function toRFC3339(entry) {
  // TODO
}

export function getGoogleId(item) {
  let baseId = item.metadata?.path || item.id.replace(/@google.com$/, "");
  // TODO
  // if (aItem.recurrenceId) {
  //   let recSuffix = "_" + aItem.recurrenceId.getInTimezone(cal.dtz.UTC).icalString;
  //   if (!baseId.endsWith(recSuffix)) {
  //     baseId += recSuffix;
  //   }
  // }
  return baseId;
}

export function categoriesStringToArray(aCategories) {
  if (!aCategories) {
    return [];
  }
  // \u001A is the unicode "SUBSTITUTE" character
  let categories = aCategories
    .replace(/\\,/g, "\u001A")
    .split(",")
    /* eslint-disable-next-line no-control-regex */
    .map(name => name.replace(/\u001A/g, ","));
  return categories;
}

export function arrayToCategoriesString(aSortedCategoriesArray) {
  let catString = aSortedCategoriesArray?.map(cat => cat.replace(/,/g, "\\,")).join(",");
  return catString?.length ? catString : null;
}

export function reverseObject(obj) {
  return Object.fromEntries(Object.entries(obj).map(entry => entry.reverse()));
}

export function sessionIdFromUrl(url) {
  return url.username ? `${url.username}@${url.hostname}` : url.hostname;
}

/* istanbul ignore next */
export async function isTesting() {
  try {
    await import("@jest/globals");
    return true;
  } catch (e) {
    return false;
  }
}