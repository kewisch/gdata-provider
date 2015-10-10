/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["Promise"];

var STATUS_PENDING = 0;
var STATUS_RESOLVED = 1;
var STATUS_REJECTED = 2;

function log(msg) {
    // Enable this to debug promises
    //dump("PROMISES: " + msg + "\n");
}

var PromiseWalker = {
    handlers: [],
    completePromise: function(aPromise, aStatus, aValue) {
        if (aPromise._status != STATUS_PENDING) {
            return;
        }
        if (aStatus == STATUS_RESOLVED && aValue &&
            typeof(aValue.then) == "function") {
          aValue.then(this.completePromise.bind(this, aPromise, STATUS_RESOLVED),
                      this.completePromise.bind(this, aPromise, STATUS_REJECTED));
          return;
        }
        aPromise._status = aStatus;
        aPromise._value = aValue;
        if (aPromise._handlers.length > 0) {
            this.schedulePromise(aPromise);
        } else if (aStatus == STATUS_REJECTED) {
            log("Pending error: " + aValue);
        }
    },

    scheduleWalkerLoop: function() {
        this.walkerLoopScheduled = true;
        let thread = Components.classes["@mozilla.org/thread-manager;1"]
                               .getService(Components.interfaces.nsIThreadManager)
                               .currentThread;
        thread.dispatch({
            run: function() {
                PromiseWalker.walkerLoop();
            }
        }, Components.interfaces.nsIEventTarget.DISPATCH_NORMAL);
    },

    schedulePromise: function (aPromise) {
        for each (let handler in aPromise._handlers) {
            this.handlers.push(handler);
        }
        aPromise._handlers.length = 0;

        if (!this.walkerLoopScheduled) {
            this.scheduleWalkerLoop();
        }
    },

    walkerLoopScheduled: false,

    walkerLoop: function() {
        if (this.handlers.length > 1) {
            this.scheduleWalkerLoop();
        } else {
            this.walkerLoopScheduled = false;
        }

        while (this.handlers.length > 0) {
            this.handlers.shift().process();
        }
    }
};
PromiseWalker.walkerLoop = PromiseWalker.walkerLoop.bind(PromiseWalker);

function Handler(aThisPromise, aOnResolve, aOnReject) {
    this.thisPromise = aThisPromise;
    this.onResolve = aOnResolve;
    this.onReject = aOnReject;
    this.nextPromise = new Promise(function() {});
}
Handler.prototype = {
    process: function() {
        let nextStatus = this.thisPromise._status;
        let nextValue = this.thisPromise._value;

        try {
            if (nextStatus == STATUS_RESOLVED) {
                if (typeof(this.onResolve) == "function") {
                    nextValue = this.onResolve.call(undefined, nextValue);
                }
            } else if (typeof(this.onReject) == "function") {
                nextValue = this.onReject.call(undefined, nextValue);
                nextStatus = STATUS_RESOLVED;
            }
        } catch (ex) {
            // Enable this to get promise debugging
            log("EXCEPTION: " + ex + "\n" + ex.stack + ex.printStackTrace);
            nextStatus = STATUS_REJECTED;
            nextValue = ex;
        }

        PromiseWalker.completePromise(this.nextPromise, nextStatus, nextValue);
    }
};
function Deferred() {
    this.promise = new Promise(function(aResolve, aReject) {
        this.resolve = aResolve;
        this.reject = aReject;
    }.bind(this));
}

function Promise(executor) {
    this._handlers = [];

    let resolve = PromiseWalker.completePromise.bind(PromiseWalker, this, STATUS_RESOLVED);
    let reject = PromiseWalker.completePromise.bind(PromiseWalker, this, STATUS_REJECTED);

    try {
        executor.call(undefined, resolve, reject);
    } catch (ex) {
        reject(ex);
    }

}

Promise.prototype = {
    _status: STATUS_PENDING,
    _value: undefined,

    then: function(aOnResolve, aOnReject) {
        let handler = new Handler(this, aOnResolve, aOnReject);
        this._handlers.push(handler);
        if (this._status != STATUS_PENDING) {
            PromiseWalker.schedulePromise(this);
        }
        return handler.nextPromise;
    },
    catch: function(onreject) {
        return this.then(undefined, onReject);
    }
};

Promise.defer = function() {
    return new Deferred();
};

Promise.resolve = function(aValue) {
    if (aValue instanceof Promise) {
        return aValue;
    }
    return new Promise(function(aResolve) { return aResolve(aValue); });
};
Promise.reject = function(aReason) {
    return new Promise(function(_, aReject) { return aReject(aReason); });
}
