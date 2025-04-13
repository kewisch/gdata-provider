/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import ICAL from "./libs/ical.js";

class TimezoneService {
  #zoneCache = new Map();

  init() {
    ICAL.TimezoneService.get = this.get.bind(this);

    this.#zoneCache.set("UTC", ICAL.Timezone.utcTimezone);
    this.#zoneCache.set("floating", ICAL.Timezone.localTimezone);
  }

  get(tzid) {
    if (!tzid) {
      return null;
    }

    if (tzid == "Z") {
      return this.#zoneCache.get("UTC");
    }

    let zone = this.#zoneCache.get(tzid);
    if (!zone) {
      let tzdef = messenger.calendar.timezones.getDefinition(tzid);
      if (!tzdef) {
        return null;
      }

      zone = ICAL.Timezone.fromData({
        tzid,
        component: tzdef
      });

      this.#zoneCache.set(tzid, zone);
    }
    return zone;
  }
}

const tzs = new TimezoneService();
export default tzs;
