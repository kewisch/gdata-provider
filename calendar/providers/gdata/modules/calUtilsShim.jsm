/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");
var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

// calAsyncUtils and calAlarmUtils should no longer be injected directly, so first check if it is
// already on the cal object through newer calUtils.jsm
if (typeof cal.async == "undefined") {
    let { cal: temp } = ChromeUtils.import("resource://calendar/modules/calAsyncUtils.jsm");
    cal.async = temp.async;
}
if (typeof cal.alarms == "undefined") {
    let { cal: temp } = ChromeUtils.import("resource://calendar/modules/calAlarmUtils.jsm");
    cal.alarms = temp.alarms;
}

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
        dateTimeToJsDate: (...args) => cal.dateTimeToJsDate(...args),
        fromRFC3339: (...args) => cal.fromRFC3339(...args),
        toRFC3339: (...args) => cal.toRFC3339(...args)
    };
}

if (!cal.item) {
    cal.item = {
        ItemDiff: cal.itemDiff,
        isItemSupported: (...args) => cal.isItemSupported(...args),
        isEventCalendar: (...args) => cal.isEventCalendar(...args),
        isTaskCalendar: (...args) => cal.isTaskCalendar(...args),
        isEvent: (...args) => cal.isEvent(...args),
        isToDo: (...args) => cal.isToDo(...args),
        checkIfInRange: (...args) => cal.checkIfInRange(...args),
        setItemProperty: (...args) => cal.setItemProperty(...args),
        getEventDefaultTransparency: (...args) => cal.getEventDefaultTransparency(...args),
        compareContent: (...args) => cal.compareItemContent(...args),
        shiftOffset: (...args) => cal.shiftItem(...args),
        moveToDate: (...args) => cal.moveItem(...args),
        serialize: (...args) => cal.getSerializedItem(...args),
        get productId() { return cal.calGetProductId(); },
        get productVersion() { return cal.calGetProductVersion(); },
        setStaticProps: (...args) => cal.calSetProdidVersion(...args),
        findWindow: (...args) => cal.findItemWindow(...args),
        setToAllDay: (...args) => cal.setItemToAllDay(...args)
    };
}

if (!cal.view || !cal.view.hashColor) {
    cal.view = Object.assign(cal.view || {}, {
        isMouseOverBox: (...args) => cal.isMouseOverBox(...args),
        removeChildElementsByAttribute: (...args) => cal.removeChildElementsByAttribute(...args),
        getParentNodeOrThis: (...args) => cal.getParentNodeOrThis(...args),
        getParentNodeOrThisByAttribute: (...args) => cal.getParentNodeOrThisByAttribute(...args),
        formatStringForCSSRule: (...args) => cal.formatStringForCSSRule(...args),
        getCompositeCalendar: (...args) => cal.getCompositeCalendar(...args),
        hashColor: (...args) => cal.hashColor(...args),
        getContrastingTextColor: (...args) => cal.getContrastingTextColor(...args),
        /* cal.view.compareItems stays the same, just a different import */
    });
}

if (typeof cal.window == "undefined") {
    cal.window = {
        getCalendarWindow: function() {
            return cal.getCalendarWindow();
        }
    };
}

if (typeof cal.category == "undefined") {
    cal.category = {
        stringToArray: function(aStr) { return cal.categoriesStringToArray(aStr); },
        arrayToString: function(aArr) { return cal.categoriesArrayToString(aArr); }
    };
}

if (typeof cal.itip == "undefined") {
    let { cal: temp } = ChromeUtils.import("resource://calendar/modules/calItipUtils.jsm");
    cal.itip = temp.itip;
}

if (typeof cal.itip.isInvitation == "undefined") {
    cal.itip.isInvitation = function(aItem) { return cal.isInvitation(aItem); };
}

if (typeof cal.l10n == "undefined") {
    cal.l10n = {
        getAnyString: function(aComponent, aBundle, aString, aParams) {
            return cal.calGetString(aBundle, aString, aParams, aComponent);
        }
    };
}

if (typeof cal.provider == "undefined") {
    cal.provider = {
        BaseClass: cal.ProviderBase,
        prepHttpChannel: (...args) => cal.prepHttpChannel(...args),
        sendHttpRequest: (...args) => cal.sendHttpRequest(...args),
        createStreamLoader: (...args) => cal.createStreamLoader(...args),
        InterfaceRequestor_getInterface: (...args) => cal.InterfaceRequestor_getInterface(...args),
        convertByteArray: (...args) => cal.convertByteArray(...args),
        promptOverwrite: (...args) => cal.promptOverwrite(...args)
    };
}

if (typeof cal.generateQI == "undefined") {
    cal.generateQI = XPCOMUtils.generateQI.bind(XPCOMUtils);
}
