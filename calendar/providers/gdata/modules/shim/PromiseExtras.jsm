/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["PromiseAll"];

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm");
CuImport("resource://gre/modules/Promise.jsm", this);
CuImport("resource://gre/modules/PromiseUtils.jsm", this);

/**
 * Shim for Promise.all needed for Gecko 24. Unfortunately the Promise object
 * is frozen, so we need to export this directly.
 */
var PromiseAll;
if (typeof Promise.all == "function") {
  PromiseAll = Promise.all.bind(Promise);
} else {
  PromiseAll = function (aValues) {
    if (typeof Promise.all == "function") {
      return Promise.all(aValues);
    }
    function checkForCompletion(aValue, aIndex) {
      resolutionValues[aIndex] = aValue;
      if (--countdown === 0) {
        deferred.resolve(resolutionValues);
      }
    }

    if (aValues == null || !Array.isArray(aValues)) {
      throw new Error("Promise.all() expects an array.");
    }

    let values = aValues;
    let countdown = values.length;
    let resolutionValues = new Array(countdown);

    if (!countdown) {
      return Promise.resolve(resolutionValues);
    }

    let deferred = PromiseUtils.defer();
    for (let i = 0; i < values.length; i++) {
      let index = i;
      let value = values[i];
      let resolver = function(val) { return checkForCompletion(val, index); };

      if (value && typeof(value.then) == "function") {
        value.then(resolver, deferred.reject);
      } else {
        // Given value is not a promise, forward it as a resolution value.
        resolver(value);
      }
    }

    return deferred.promise;
  };
}
