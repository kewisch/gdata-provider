/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["CuImport", "shimIt"];

/**
 * Attempt to import a module, log failure if it does not exist.
 */
function CuImport(uriSpec, globalObj) {
    try {
        Components.utils.import(uriSpec, globalObj)
    } catch (e) {
        if (e.result == Components.results.NS_ERROR_FILE_NOT_FOUND) {
            let fn = Components.stack.caller.filename;
            Components.utils.reportError("[calGoogleCalendar] Missing: " + fn + " -> " + uriSpec);
        } else {
            throw e;
        }
    }
}

/**
 * Inject any missing functions and objects into the given global
 */
function shimIt(global) {
    if (!global.String.prototype.includes) {
        Object.defineProperty(global.String.prototype, 'includes', {
          enumerable: false,
          configurable: true,
          writable: false,
          value: StringIncludes
        });
    }

    if (!global.Array.prototype.includes) {
        Object.defineProperty(global.Array.prototype, 'includes', {
          enumerable: false,
          configurable: true,
          writable: false,
          value: ArrayIncludes
        });
    }
}

/**
 * Implementation for String.prototype.includes/contains.
 */
function StringIncludes() {
    return String.prototype.indexOf.apply(this, arguments) !== -1;
}

/**
 * Implementation for Array.prototype.includes.
 */
function ArrayIncludes() {
    return Array.prototype.indexOf.apply(this, arguments) !== -1;
}
