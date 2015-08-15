/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["Preferences"];

Components.utils.import("resource://calendar/modules/calUtils.jsm");

var Preferences = {
    has: function(k) { return !!cal.getPrefSafe(k); },
    get: function(k, v) { return cal.getPrefSafe(k, v); },
    set: function(k, v) { return cal.setPref(k, v); }
};
