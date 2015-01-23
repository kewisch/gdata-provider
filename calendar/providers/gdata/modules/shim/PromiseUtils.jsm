/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["PromiseUtils"];

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm");
CuImport("resource://gre/modules/Promise.jsm", this);

// Shim for PromiseUtils. We really just need Promise.defer and since in
// versions before PromiseUtils existed the Promise object had the defer
// method, we can just alias ist.
var PromiseUtils = Promise;
