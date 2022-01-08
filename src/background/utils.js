/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import ICAL from "./libs/ical.js";

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

export function addVCalendar(vcomponent) {
  if (vcomponent?.[0] == "vevent" || vcomponent?.[0] == "vtodo") {
    return [
      "vcalendar",
      [
        ["calscale", {}, "text", "GREGORIAN"],
        ["prodid", {}, "text", "-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN"],
        ["version", {}, "text", "2.0"],
      ],
      [vcomponent],
    ];
  } else if (vcomponent?.[0] == "vcalendar") {
    return vcomponent;
  } else {
    throw new Error("Invalid base component: " + vcomponent?.[0]);
  }
}

export function getGoogleId(item) {
  let baseId = item.metadata?.path || item.id.replace(/@google.com$/, "");

  let vevent = new ICAL.Component(item.formats.jcal);
  let recId = vevent.getFirstPropertyValue("recurrence-id");
  if (recId) {
    let recSuffix = "_" + recId.convertToZone(ICAL.Timezone.utcTimezone).toICALString();
    if (!baseId.endsWith(recSuffix)) {
      baseId += recSuffix;
    }
  }
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
  // The first two cases are for the jest tests, node's URL constructor works differently.
  if (url.username) {
    return `${url.username}@${url.hostname}`;
  } /* istanbul ignore else */ else if (url.hostname) {
    return url.hostname;
  } else {
    return url.pathname.substring(2, url.pathname.length - 1);
  }
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
