/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["calendarShim", "gdataRegisterCalendar"];

Components.utils.import("resource://calendar/modules/calUtils.jsm");

const cICL = Components.interfaces.calIChangeLog;

/**
 * Shim functions that can be injected into an object implementing calICalendar
 * to make it compatible with older versions of Lightning
 */
var calendarShim = {
    addItemOrUseCache: function(aItem, useCache, aListener) {
        let newItem = aItem.clone();
        return this.adoptItemOrUseCache(newItem, useCache, aListener);
    },

    adoptItemOrUseCache: function(aItem, useCache, aListener) {
        let self = this;
        let addOfflineListener = {
            onGetResult: function() {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (Components.isSuccessCode(status)) {
                    let storage = self.mOfflineStorage.QueryInterface(Components.interfaces.calIOfflineStorage);
                    storage.addOfflineItem(detail, aListener);
                } else if (aListener) {
                    aListener.onOperationComplete(self, status, opType, id, detail);
                }
            }
        };

        let intermediateListener = {
            onGetResult: function() {},
            onOperationComplete: function(aCalendar, aStatus, aOp, aId, aInnerItem) {
                if (useCache) {
                    if (isUnavailableCode(aStatus)) {
                        self.mOfflineStorage.adoptItem(aInnerItem, addOfflineListener);
                    } else {
                        self.mOfflineStorage.addItem(aInnerItem, aListener);
                    }
                } else {
                    aListener.onOperationComplete.apply(aListener, arguments);
                }
            }
        };

        return this.adoptItem(aItem, intermediateListener);
    },

    modifyItemOrUseCache: function modifyItemOrUseCache(aNewItem, aOldItem, useCache, aListener) {
        let self = this;
        let storage = this.mOfflineStorage.QueryInterface(Components.interfaces.calIOfflineStorage);
        let modifyOfflineListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                storage.modifyOfflineItem(detail, aListener);
            }
        };

        let offlineFlagListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                let offline_flag = detail;
                if ((offline_flag == cICL.OFFLINE_FLAG_CREATED_RECORD ||
                     offline_flag == cICL.OFFLINE_FLAG_MODIFIED_RECORD) && useCache) {
                    storage.modifyItem(aNewItem, aOldItem, modifyOfflineListener);
                } else {
                    self.modifyItem(aNewItem, aOldItem, aListener);
                }
            }
        };
        storage.getItemOfflineFlag(aOldItem, offlineFlagListener);
    },

    deleteItemOrUseCache: function deleteItemOrUseCache(aItem, useCache, aListener) {
        let self = this;
        let storage = this.mOfflineStorage.QueryInterface(Components.interfaces.calIOfflineStorage);
        let deleteOfflineListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (aListener) {
                    aListener.onOperationComplete(calendar, status, opType, aItem.id, aItem);
                }
            }
        };

        let offlineFlagListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                let offline_flag = detail;
                if ((offline_flag == cICL.OFFLINE_FLAG_CREATED_RECORD ||
                     offline_flag == cICL.OFFLINE_FLAG_MODIFIED_RECORD) && useCache) {
                    /* We do not delete the item from the cache, but mark it deleted */
                    storage.deleteOfflineItem(aItem, aListener);
                } else {
                    self.deleteItem(aItem, aListener);
                }
            }
        };
        storage.getItemOfflineFlag(aItem, offlineFlagListener);
    },

    notifyPureOperationComplete: function(aListener, aStatus, aOpType, aId, aDetail) {
        let protoComplete = this.__proto__.__proto__.notifyPureOperationComplete;

        if (protoComplete) {
            protoComplete.apply(this, arguments);
        } else {
            // Shim for older versions of Lightning
            if (aListener) {
                try {
                    aListener.onOperationComplete(this.superCalendar, aStatus, aOpType, aId, aDetail);
                } catch (exc) {
                    cal.ERROR(exc);
                }
            }
        }
    }
};

/**
 * Checks if the error code is a code that happens when there is a network
 * error or similar, that would make the calendar temporarily unavailable.
 *
 * @param result        The result code to check.
 * @return              True, if the code is an unavailable code.
 */
function isUnavailableCode(result) {
    // Stolen from nserror.h
    const NS_ERROR_MODULE_NETWORK = 6;
    function NS_ERROR_GET_MODULE(code) {
        return (((code >> 16) - 0x45) & 0x1fff);
    }

    if (NS_ERROR_GET_MODULE(result) == NS_ERROR_MODULE_NETWORK &&
        !Components.isSuccessCode(result)) {
        // This is a network error, which most likely means we should
        // retry it some time.
        return true;
    }

    // Other potential errors we want to retry with
    switch (result) {
        case Components.results.NS_ERROR_NOT_AVAILABLE:
            return true;
        default:
            return false;
    }
}

/**
 * A replacement for calICalendarManager::registerCalendar, that allows
 * registering calendars with an existing id. This is needed for backwards
 * compatibility before Gecko 9.
 *
 * @param calendar      The calendar to register
 */
function gdataRegisterCalendar(calendar) {
    if (!calendar.id) {
        calendar.id = cal.getUUID();
    }
    let branch = "calendar.registry." + calendar.id + ".";

    cal.setPref(branch + "type", calendar.type);
    cal.setPref(branch + "uri", calendar.uri.spec);

    let calmgr = cal.getCalendarManager().wrappedJSObject;
    let calCachedCalendar = Components.utils.getGlobalForObject(calmgr).calCachedCalendar;

    if ((calendar.getProperty("cache.supported") !== false) &&
        calendar.getProperty("cache.enabled")) {
        calendar = new calCachedCalendar(calendar);
    }

    calmgr.setupCalendar(calendar);
    Components.classes["@mozilla.org/preferences-service;1"]
              .getService(Components.interfaces.nsIPrefService)
              .savePrefFile(null);

    if (!calendar.getProperty("disabled") && calendar.canRefresh) {
        calendar.refresh();
    }

    calmgr.notifyObservers("onCalendarRegistered", [calendar]);
}
