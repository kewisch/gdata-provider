/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["setTimeout"];

function setTimeout(func, timeout) {
    let timer = Components.classes["@mozilla.org/timer;1"]
                          .createInstance(Components.interfaces.nsITimer);

    timer.initWithCallback({ notify: func }, timeout, timer.TYPE_ONE_SHOT);
    // Timer.jsm usually keeps track of the timers to be able to cancel them,
    // but we only use it for postponing things so this is enough.
}
