/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");

this.EXPORTED_SYMBOLS = ["cal"];

if (!cal.dtz) {
    cal.dtz = {
        get defaultTimezone() { return cal.calendarDefaultTimezone(); },
        get floating() { return cal.floating(); },
        get UTC() { return cal.UTC(); },

        now: (...args) => cal.now(...args),
        ensureDateTime: (...args) => cal.ensureDateTime(...args),
        getRecentTimezones: (...args) => cal.getRecentTimezones(...args),
        saveRecentTimezone: (...args) => cal.saveRecentTimezone(...args),
        getDefaultStartDate: (...args) => cal.getDefaultStartDate(...args),
        setDefaultStartEndHour: (...args) => cal.setDefaultStartEndHour(...args),
        startDateProp: (...args) => cal.calGetStartDateProp(...args),
        endDateProp: (...args) => cal.calGetEndDateProp(...args),
        sameDay: (...args) => cal.sameDay(...args),
        jsDateToDateTime: (...args) => cal.jsDateToDateTime(...args),
        dateTimeToJsDate: (...args) => cal.dateTimeToJsDate(...args)
    };
}
