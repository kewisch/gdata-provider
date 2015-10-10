/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [
  "Task"
];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;
var Cr = Components.results;

Cu.import("resource://gdata-provider/modules/shim/Promise.jsm");

// The following error types are considered programmer errors, which should be
// reported (possibly redundantly) so as to let programmers fix their code.
var ERRORS_TO_REPORT = ["EvalError", "RangeError", "ReferenceError", "TypeError"];

var gCurrentTask = null;

function linesOf(string) {
  let reLine = /([^\r\n])+/g;
  let match;
  while ((match = reLine.exec(string))) {
    yield [match[0], match.index];
  }
};

function isGenerator(aValue) {
  return Object.prototype.toString.call(aValue) == "[object Generator]";
}

this.Task = {
  spawn: function Task_spawn(aTask) {
    return createAsyncFunction(aTask).call(undefined);
  },

  async: function Task_async(aTask) {
    if (typeof(aTask) != "function") {
      throw new TypeError("aTask argument must be a function");
    }

    return createAsyncFunction(aTask);
  },

  Result: function Task_Result(aValue) {
    this.value = aValue;
  }
};

function createAsyncFunction(aTask) {
  let asyncFunction = function () {
    let result = aTask;
    if (aTask && typeof(aTask) == "function") {
      if (aTask.isAsyncFunction) {
        throw new TypeError(
          "Cannot use an async function in place of a promise. " +
          "You should either invoke the async function first " +
          "or use 'Task.spawn' instead of 'Task.async' to start " +
          "the Task and return its promise.");
      }

      try {
        // Let's call into the function ourselves.
        result = aTask.apply(this, arguments);
      } catch (ex if ex instanceof Task.Result) {
        return Promise.resolve(ex.value);
      } catch (ex) {
        return Promise.reject(ex);
      }
    }

    if (isGenerator(result)) {
      // This is an iterator resulting from calling a generator function.
      return new TaskImpl(result).deferred.promise;
    }

    // Just propagate the given value to the caller as a resolved promise.
    return Promise.resolve(result);
  };

  asyncFunction.isAsyncFunction = true;

  return asyncFunction;
}

function TaskImpl(iterator) {
  this.deferred = Promise.defer();
  this._iterator = iterator;
  this._run(true);
}

TaskImpl.prototype = {
  deferred: null,
  _iterator: null,

  _run: function TaskImpl_run(aSendResolved, aSendValue) {
    try {
      gCurrentTask = this;

      try {
        let yielded = aSendResolved ? this._iterator.send(aSendValue)
                                    : this._iterator.throw(aSendValue);
        this._handleResultValue(yielded);
      } catch (ex if ex instanceof Task.Result) {
        this.deferred.resolve(ex.value);
      } catch (ex if ex instanceof StopIteration) {
        this.deferred.resolve(undefined);
      } catch (ex) {
        this._handleException(ex);
      }
    } finally {
      if (gCurrentTask == this) {
        gCurrentTask = null;
      }
    }
  },

  _handleResultValue: function TaskImpl_handleResultValue(aValue) {
    if (isGenerator(aValue)) {
      aValue = Task.spawn(aValue);
    }

    if (aValue && typeof(aValue.then) == "function") {
      aValue.then(this._run.bind(this, true),
                  this._run.bind(this, false));
    } else {
      this._run(true, aValue);
    }
  },

  _handleException: function TaskImpl_handleException(aException) {
    gCurrentTask = this;
    this.deferred.reject(aException);
  }
};
