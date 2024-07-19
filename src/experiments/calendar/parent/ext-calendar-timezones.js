/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  ExtensionCommon: { ExtensionAPI, EventManager }
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

var { default: ICAL } = ChromeUtils.importESModule("resource:///modules/calendar/Ical.sys.mjs");

this.calendar_timezones = class extends ExtensionAPI {
  getAPI(context) {
    let timezoneDatabase = Cc["@mozilla.org/calendar/timezone-database;1"].getService(
      Ci.calITimezoneDatabase
    );

    return {
      calendar: {
        timezones: {
          async getDefinition(tzid, options={}) {
            let zoneInfo = timezoneDatabase.getTimezoneDefinition(tzid);

            if (options.returnFormat == "jcal") {
              zoneInfo = ICAL.parse(zoneInfo);
            }

            return zoneInfo;
          }
        }
      }
    };
  }
};
