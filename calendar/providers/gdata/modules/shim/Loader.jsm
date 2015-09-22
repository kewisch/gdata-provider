/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");

var EXPORTED_SYMBOLS = ["CuImport", "shimIt"];

var CuImportSubstitutions = {
    "resource://gre/modules/Promise.jsm": "resource://gdata-provider/modules/shim/Promise.jsm",
    "resource://gre/modules/PromiseUtils.jsm": "resource://gdata-provider/modules/shim/PromiseUtils.jsm",
    "resource://gre/modules/Task.jsm": "resource://gdata-provider/modules/shim/Task.jsm",
    "resource://gre/modules/Timer.jsm": "resource://gdata-provider/modules/shim/Timer.jsm",
    "resource://gre/modules/Preferences.jsm": "resource://gdata-provider/modules/shim/Preferences.jsm",
};

/**
 * Attempt to import a module, falling back to the shim if it does not exist.
 */
function CuImport(uriSpec, globalObj) {
    try {
        Components.utils.import(uriSpec, globalObj)
    } catch (e if e.result == Components.results.NS_ERROR_FILE_NOT_FOUND) {
        if (uriSpec in CuImportSubstitutions) {
            // If we have a substitution, then load it now.
            Components.utils.import(CuImportSubstitutions[uriSpec], globalObj);
        } else {
            let fn = Components.stack.caller.filename;
            Components.utils.reportError("[calGoogleCalendar] Missing: " + fn + " -> " + uriSpec);
        }
    }
}

/**
 * Inject any missing functions and objects into the given global
 */
function shimIt(global) {
    if (!global.String.prototype.startsWith) {
        Object.defineProperty(global.String.prototype, 'startsWith', {
            enumerable: false,
            configurable: true,
            writable: false,
            value: function(searchString, position) {
                position = position || 0;
                return this.lastIndexOf(searchString, position) === position;
            }
        });
    }

    if (!global.String.prototype.endsWith) {
        Object.defineProperty(global.String.prototype, 'endsWith', {
            enumerable: false,
            configurable: true,
            writable: false,
            value: function(searchString, position) {
                var subjectString = this.toString();
                if (position === undefined || position > subjectString.length) {
                    position = subjectString.length;
                }
                position -= searchString.length;
                var lastIndex = subjectString.indexOf(searchString, position);
                return lastIndex !== -1 && lastIndex === position;
            }
        });
    }

    // See note at the bottom of https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/includes
    // for why the same method is used for contains/includes.
    if (!global.String.prototype.contains) {
        Object.defineProperty(global.String.prototype, 'contains', {
          enumerable: false,
          configurable: true,
          writable: false,
          value: StringContains
        });
    }

    if (!global.String.prototype.includes) {
        Object.defineProperty(global.String.prototype, 'includes', {
          enumerable: false,
          configurable: true,
          writable: false,
          value: StringContains
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

    if (!global.Map) {
        global.Map = Map;
    }
    if (!global.Set) {
        global.Set = Set;
    }

    if (typeof global.Map.prototype.forEach !== "function") {
        Object.defineProperty(global.Map.prototype, 'forEach', {
          enumerable: false,
          configurable: true,
          writable: false,
          value: MapSetForEach
        });
    }
    if (typeof global.Set.prototype.forEach !== "function") {
        Object.defineProperty(global.Set.prototype, 'forEach', {
          enumerable: false,
          configurable: true,
          writable: false,
          value: MapSetForEach
        });
    }
}

/**
 * Implementation for String.prototype.includes/contains.
 */
function StringContains() {
    return String.prototype.indexOf.apply(this, arguments) !== -1;
}

/**
 * Implementation for Array.prototype.includes.
 */
function ArrayIncludes() {
    return Array.prototype.indexOf.apply(this, arguments) !== -1;
}

/**
 * forEach implementation for Map and Set, for Thunderbird 24
 */
function MapSetForEach(cb) {
    let iter = this.entries();
    while (1) {
        let k, v;
        try {
            [k,v] = iter.next();
        } catch (e if e instanceof StopIteration) {
              break;
        }
        cb(v, k, this);
    }
}

/**
 * This implementation of Map doesn't work quite like the ES6 Map, but it works
 * well enough for our purposes.
 */
function Map(values) {
    this.data = Object.create(null);
    if (values) {
        for each (let [k,v] in values) {
            this.data[k] = v;
        }
    }
}
Map.prototype = {
    has: function(k) { return k in this.data; },
    set: function(k, v) { return this.data[k] = v; },
    get: function(k) { return this.data[k]; },
    delete: function(k) { return delete this.data[k]; },
    get size() { return Object.keys(this.data).length; },
    forEach: function(cb) {
        for (let k in this.data) {
            cb(this.data[k], k, this);
        }
    },

    toSource: function() { return Object.prototype.toSource.call(this.data); },
    __iterator__: function() { return new Iterator(this.data); }
};

/**
 * Not a particularly fast implementation of Set, but since our keys can be
 * objects we can't just use normal js objects.
 */
function Set(values) {
    this.data = [];
    if (values) {
        values.forEach(this.add, this);
    }
}
Set.prototype = {
    has: function(v) {
        for each (let dv in this.data) {
            if (v == dv) return true;
        }
        return false;
    },

    get size() { return this.data.length; },
    add: function(v) { return this.has(v) ? null : this.data.push(v); },
    clear: function() { return this.data = []; },
    delete: function(v) {
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i] == v) {
                this.data.splice(i, 1);
                return;
            }
        }
    },

    forEach: function(cb) {
        for each (let v in this.data) {
            cb(v, v, this);
        }
    },

    toSource: function() { return this.data.toSource(); },
    __iterator__: function() {
        for each (let v in this.data) {
            yield v;
        }
    }
};

if (!cal.hashColor) {
    cal.hashColor = function hashColor(str) {
        // This is the palette of colors in the current colorpicker implementation.
        // Unfortunately, there is no easy way to extract these colors from the
        // binding directly.
        const colorPalette = ["#FFFFFF", "#FFCCCC", "#FFCC99", "#FFFF99", "#FFFFCC",
                              "#99FF99", "#99FFFF", "#CCFFFF", "#CCCCFF", "#FFCCFF",
                              "#CCCCCC", "#FF6666", "#FF9966", "#FFFF66", "#FFFF33",
                              "#66FF99", "#33FFFF", "#66FFFF", "#9999FF", "#FF99FF",
                              "#C0C0C0", "#FF0000", "#FF9900", "#FFCC66", "#FFFF00",
                              "#33FF33", "#66CCCC", "#33CCFF", "#6666CC", "#CC66CC",
                              "#999999", "#CC0000", "#FF6600", "#FFCC33", "#FFCC00",
                              "#33CC00", "#00CCCC", "#3366FF", "#6633FF", "#CC33CC",
                              "#666666", "#990000", "#CC6600", "#CC9933", "#999900",
                              "#009900", "#339999", "#3333FF", "#6600CC", "#993399",
                              "#333333", "#660000", "#993300", "#996633", "#666600",
                              "#006600", "#336666", "#000099", "#333399", "#663366",
                              "#000000", "#330000", "#663300", "#663333", "#333300",
                              "#003300", "#003333", "#000066", "#330099", "#330033"];

        let sum = Array.map(str || " ", function(e) { return e.charCodeAt(0); }).reduce(function(a, b) { return a + b; });
        return colorPalette[sum % colorPalette.length];
    }
}
