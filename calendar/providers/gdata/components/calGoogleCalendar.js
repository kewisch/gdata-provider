/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Google Calendar Provider code.
 *
 * The Initial Developer of the Original Code is
 *   Philipp Kewisch <mozilla@kewis.ch>
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Joey Minta <jminta@gmail.com>
 *   Daniel Boelzle <daniel.boelzle@sun.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");

const cICL = Components.interfaces.calIChangeLog;

/**
 * calGoogleCalendar
 * This Implements a calICalendar Object adapted to the Google Calendar
 * Provider.
 *
 * @class
 * @constructor
 */
function calGoogleCalendar() {
    this.initProviderBase();
}

calGoogleCalendar.prototype = {
    __proto__: cal.ProviderBase.prototype,

    classDescription: "Google Calendar Provider",
    contractID: "@mozilla.org/calendar/calendar;1?type=gdata",
    classID:  Components.ID("{d1a6e988-4b4d-45a5-ba46-43e501ea96e3}"),

    getInterfaces: function cI_cGC_getInterfaces (count) {
        var ifaces = [
            Components.interfaces.nsISupports,
            Components.interfaces.calICalendar,
            Components.interfaces.calIGoogleCalendar,
            Components.interfaces.calISchedulingSupport,
            Components.interfaces.calIChangeLog,
            Components.interfaces.nsIClassInfo
        ];
        count.value = ifaces.length;
        return ifaces;
    },

    getHelperForLanguage: function cI_cGC_getHelperForLanguage(aLanguage) {
        return null;
    },

    implementationLanguage: Components.interfaces.nsIProgrammingLanguage.JAVASCRIPT,
    flags: 0,

    QueryInterface: function cGS_QueryInterface(aIID) {
        return cal.doQueryInterface(this, calGoogleCalendar.prototype, aIID, null, this);
    },

    /* Member Variables */
    mSession: null,
    mFullUri: null,
    mCalendarName: null,

    /*
     * Google Calendar Provider attributes
     */

    /**
     * readonly attribute googleCalendarName
     * Google's Calendar name. This represents the <calendar name> in
     * http[s]://www.google.com/calendar/feeds/<calendar name>/private/full
     */
    get googleCalendarName() {
        return this.mCalendarName;
    },

    get isDefaultCalendar() {
        return !/@group\.calendar\.google\.com$/.test(this.mCalendarName);
    },

    /**
     * attribute session
     * An calGoogleSession Object that handles the session requests.
     */
    get session() {
        return this.mSession;
    },
    set session(v) {
        return this.mSession = v;
    },

    get title() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set title(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get access() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set access(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get selected() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set selected(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get hidden() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set hidden(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get color() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set color(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get timezone() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set timezone(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    /**
     * findSession
     * Populates the Session Object based on the preferences or the result of a
     * login prompt.
     *
     * @param aIgnoreExistingSession If set, find the session regardless of
     *                               whether the session has been previously set
     *                               or not
     */
    findSession: function cGC_findSession(aIgnoreExistingSession) {
        if (this.mSession && !aIgnoreExistingSession) {
            return true;
        }

        // We need to find out which Google account fits to this calendar.
        var sessionMgr = getGoogleSessionManager();
        var googleUser = getCalendarPref(this, "googleUser");
        if (googleUser) {
            this.mSession = sessionMgr.getSessionByUsername(googleUser, true);
        } else {
            // We have no user, therefore we need to ask the user. Show a
            // user/password prompt and set the session based on those
            // values.

            var username = { value: null };
            if (this.isDefaultCalendar) {
                // Only pre-fill the username if this is the default calendar,
                // otherwise users might think the cryptic hash is the username
                // they have to use.
                username.value = this.mCalendarName;
            }
            var password = { value: null };
            var persist = { value: false };

            if (getCalendarCredentials(this.mCalendarName,
                                       username,
                                       password,
                                       persist)) {
                this.mSession = sessionMgr.getSessionByUsername(username.value,
                                                                true);

                this.mSession.password = password.value;
                this.mSession.persist = persist.value;
                setCalendarPref(this,
                                "googleUser",
                                "CHAR",
                                this.mSession.userName);
            } else {
                // The password dialog was canceled, disable the calendar.
                this.setProperty("disabled", true);
                return false;
            }
        }
        return true;
    },

    /**
     * ensureSession
     * Make sure a session is available. If not, throw an exception
     */
    ensureSession: function cGC_ensureSession() {
        if (!this.mSession ||
            !this.mSession.password ||
            this.mSession.password == "") {
            if (!this.findSession) {
                throw new Components.Exception("Session was canceled",
                                               Components.results.NS_ERROR_FAILURE);
            }
        }
    },

    /*
     * implement calICalendar
     */
    get type() {
        return "gdata";
    },

    get providerID() {
        return "{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}";
    },

    get uri() {
        return this.mUri;
    },

    get fullUri() {
        return this.mFullUri;
    },
    set uri(aUri) {
        // Parse google url, catch private cookies, public calendars,
        // basic and full types, bogus ics file extensions, invalid hostnames
        var re = new RegExp("/calendar/(feeds|ical)/" +
                            "([^/]+)/(public|private)-?([^/]+)?/" +
                            "(full|basic)(.ics)?$");

        var matches = aUri.path.match(re);

        if (!matches) {
            throw new Components.Exception(aUri, Components.results.NS_ERROR_MALFORMED_URI);
        }

        // Set internal Calendar Name
        this.mCalendarName = decodeURIComponent(matches[2]);

        // Set normalized url. We need private visibility and full projection
        this.mFullUri = aUri.clone();
        this.mFullUri.path = "/calendar/feeds/" + matches[2] + "/private/full";

        // Remember the uri as it was passed, in case the calendar manager
        // relies on it.
        this.mUri = aUri;

        this.findSession(true);
        return this.mUri;
    },

    getProperty: function cGC_getProperty(aName) {
        switch (aName) {
            // Capabilities
            case "capabilities.timezones.floating.supported":
            case "capabilities.attachments.supported":
            case "capabilities.priority.supported":
            case "capabilities.tasks.supported":
            case "capabilities.alarms.oninvitations.supported":
                return false;
            case "capabilities.privacy.values":
                return ["DEFAULT", "PUBLIC", "PRIVATE"];
            case "capabilities.alarms.maxCount":
                return 5;
            case "capabilities.alarms.actionValues":
                return ["DISPLAY", "EMAIL", "SMS"];
            case "organizerId":
                return "mailto:" + this.googleCalendarName;
            case "organizerCN":
                if (this.mSession) {
                    return this.session.fullName;
                }
                break;
            case "itip.transport":
                if (!this.isDefaultCalendar ||
                    !getPrefSafe("calendar.google.enableEmailInvitations", false)) {
                    // If we explicitly return null here, then these calendars
                    // will not be included in the list of calendars to accept
                    // invitations to and imip will effectively be disabled.
                    return null;
                }
                break;
            case "imip.identity.disabled":
                // Disabling this hides the picker for identities in the new
                // calendar wizard and calendar properties dialog. This should
                // be done for all secondary calendars as they cannot accept
                // invitations and if email invitations are generally disabled.
                if (!this.isDefaultCalendar ||
                    !getPrefSafe("calendar.google.enableEmailInvitations", false)) {
                    return true;
                }
                break;
        }

        return this.__proto__.__proto__.getProperty.apply(this, arguments);
    },

    get canRefresh() {
        return true;
    },

    adoptItem: function cGC_adoptItem(aItem, aListener) {
        return this.adoptItemOrUseCache(aItem, !!this.mOfflineStorage, aListener);
    },

    adoptItemOrUseCache: function adoptItemOrUseCache(aItem, useCache, aListener) {
        cal.LOG("[calGoogleCalendar] Adding item " + aItem.title);

        try {
            // Check if calendar is readonly
            if (this.readOnly) {
                throw new Components.Exception("",
                                               Components.interfaces.calIErrors.CAL_IS_READONLY);
            }

            // Make sure the item is an event
            aItem = aItem.QueryInterface(Components.interfaces.calIEvent);

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // Add the calendar to the item, for later use.
            aItem.calendar = this.superCalendar;

            var request = new calGoogleRequest(this);
            var xmlEntry = ItemToXMLEntry(aItem, this,
                                          this.session.userName,
                                          this.session.fullName);

            request.type = request.ADD;
            request.uri = this.fullUri.spec;
            request.setUploadData("application/atom+xml; charset=UTF-8", xmlEntry);
            request.operationListener = aListener;
            request.calendar = this;
            request.newItem = aItem;
            request.useCache = useCache;
            request.responseListener = { onResult: this.addItem_response.bind(this) };
            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            cal.LOG("[calGoogleCalendar] adoptItem failed before request " + aItem.title + "\n:" + e);
            if (e.result == Components.interfaces.calIErrors.CAL_IS_READONLY) {
                // The calendar is readonly, make sure this is set and
                // notify the user. This can come from above or from
                // mSession.addItem which checks for the editURI
                this.readOnly = true;
            }

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.ADD,
                                         null,
                                         e.message);
        }
        return null;
    },

    addItem: function cGC_addItem(aItem, aListener) {
        // Google assigns an ID to every event added. Any id set here or in
        // adoptItem will be overridden.
        return this.addItemOrUseCache(aItem, !!this.mOfflineStorage, aListener);
    },

    addItemOrUseCache: function addItemOrUseCache(aItem, useCache, aListener) {
        return this.adoptItemOrUseCache(aItem.clone(), useCache, aListener);
    },

    modifyItem: function cGC_modifyItem(aNewItem, aOldItem, aListener) {
        if (this.mOfflineStorage) {
            return this.modifyItemOrUseCache(aNewItem, aOldItem, true, aListener);
        } else {
            return this.doModifyItem(aNewItem, aOldItem, false, aListener);
        }
    },

    modifyItemOrUseCache: function modifyItemOrUseCache(aNewItem, aOldItem, useCache, aListener) {
        let thisCalendar = this;
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
                    thisCalendar.doModifyItem(aNewItem, aOldItem, useCache, aListener, false);
                }
            }
        };
        storage.getItemOfflineFlag(aOldItem, offlineFlagListener);
    },

    doModifyItem: function doModifyItem(aNewItem, aOldItem, useCache, aListener) {
        cal.LOG("[calGoogleCalendar] Modifying item " + aOldItem.title);

        try {
            if (this.readOnly) {
                throw new Components.Exception("",
                                               Components.interfaces.calIErrors.CAL_IS_READONLY);
            }

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // Check if enough fields have changed to warrant sending the event
            // to google. This saves network traffic. Also check if the item isn't
            // the same to work around a bug in the cache layer.
            if (aOldItem != aNewItem && relevantFieldsMatch(aOldItem, aNewItem)) {
                cal.LOG("[calGoogleCalendar] Not requesting item modification for " + aOldItem.id +
                        "(" + aOldItem.title + "), relevant fields match");

                this.notifyOperationComplete(aListener,
                                             Components.results.NS_OK,
                                             Components.interfaces.calIOperationListener.MODIFY,
                                             aNewItem.id,
                                             aNewItem);
                this.mObservers.notify("onModifyItem", [aNewItem, aOldItem]);
                return null;
            }

            // Set up the request
            var request = new calGoogleRequest(this.session);

            // We need to clone the new item, its possible that ItemToXMLEntry
            // will modify the item. For example, if the item is organized by
            // someone else, we cannot save alarms on it and they should
            // therefore not be added in the returned item.
            var newItem = aNewItem.clone();

            var xmlEntry = ItemToXMLEntry(newItem, this,
                                          this.session.userName,
                                          this.session.fullName);

            if (aOldItem.parentItem != aOldItem &&
                !aOldItem.parentItem.recurrenceInfo.getExceptionFor(aOldItem.startDate)) {

                // In this case we are modifying an occurence, not deleting it
                request.type = request.ADD;
                request.uri = this.fullUri.spec;
            } else {
                // We are  making a negative exception or modifying a parent item
                request.type = request.MODIFY;
                request.uri = getItemEditURI(aOldItem);
            }

            request.setUploadData("application/atom+xml; charset=UTF-8", xmlEntry);
            request.responseListener = { onResult: this.modifyItem_response.bind(this) };
            request.operationListener = aListener;
            request.newItem = newItem;
            request.oldItem = aOldItem;
            request.calendar = this;
            request.useCache = useCache;
            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            cal.LOG("[calGoogleCalendar] modifyItem failed before request " +
                    aNewItem.title + "(" + aNewItem.id + "):\n" + e);

            if (e.result == Components.interfaces.calIErrors.CAL_IS_READONLY) {
                // The calendar is readonly, make sure this is set and
                // notify the user. This can come from above or from
                // mSession.modifyItem which checks for the editURI
                this.readOnly = true;
            }

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.MODIFY,
                                         null,
                                         e.message);
        }
        return null;
    },


    deleteItem: function cGC_deleteItem(aItem, aListener) {
        if (this.mOfflineStorage) {
            return this.deleteItemOrUseCache(aItem, true, aListener);
        } else {
            return this.doDeleteItem(aItem, false, aListener);
        }
    },

    deleteItemOrUseCache: function deleteItemOrUseCache(aItem, useCache, aListener) {
        let thisCalendar = this;
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
                    thisCalendar.doDeleteItem(aItem, useCache, aListener);
                }
            }
        };
        storage.getItemOfflineFlag(aItem, offlineFlagListener);
    },

    doDeleteItem: function doDeleteItem(aItem, useCache, aListener) {
        cal.LOG("[calGoogleCalendar] Deleting item " + aItem.title + "(" + aItem.id + ")");

        try {
            if (this.readOnly) {
                throw new Components.Exception("",
                                               Components.interfaces.calIErrors.CAL_IS_READONLY);
            }

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // We need the item in the response, since google dosen't return any
            // item XML data on delete, and we need to call the observers.
            var request = new calGoogleRequest(this);

            request.type = request.DELETE;
            request.uri = getItemEditURI(aItem);
            request.operationListener = aListener;
            request.oldItem = aItem;
            request.calendar = this;
            request.useCache = useCache;
            request.responseListener = { onResult: this.deleteItem_response.bind(this) };

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            cal.LOG("[calGoogleCalendar] deleteItem failed before request for " +
                    aItem.title + "(" + aItem.id + "):\n" + e);

            if (e.result == Components.interfaces.calIErrors.CAL_IS_READONLY) {
                // The calendar is readonly, make sure this is set and
                // notify the user. This can come from above or from
                // mSession.deleteItem which checks for the editURI
                this.readOnly = true;
            }

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.DELETE,
                                         null,
                                         e.message);
        }
        return null;
    },

    getItem: function cGC_getItem(aId, aListener) {
        // This function needs a test case using mechanisms in bug 365212
        cal.LOG("[calGoogleCalendar] Getting item with id " + aId);
        try {

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // Set up the request

            var request = new calGoogleRequest(this);

            request.itemId = aId;
            request.type = request.GET;
            request.uri = this.fullUri.spec;
            request.operationListener = aListener;
            request.responseListener = { onResult: this.getItem_response.bind(this) };
            request.calendar = this;

            // Request Parameters
            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);
            request.addQueryParameter("max-results", kMANY_EVENTS);
            request.addQueryParameter("singleevents", "false");

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            cal.LOG("[calGoogleCalendar] getItem failed before request " + aId + "):\n" + e);

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
        return null;
    },

    getItems: function cGC_getItems(aItemFilter,
                                    aCount,
                                    aRangeStart,
                                    aRangeEnd,
                                    aListener) {
        try {
            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // item base type
            var wantEvents = ((aItemFilter &
                               Components.interfaces.calICalendar.ITEM_FILTER_TYPE_EVENT) != 0);
            var wantInvitations = ((aItemFilter &
                 Components.interfaces.calICalendar.ITEM_FILTER_REQUEST_NEEDS_ACTION) != 0);


            if (!wantEvents) {
                // Events are not wanted, nothing to do. The
                // notifyOperationComplete in the catch block below will catch
                // this.
                throw new Components.Exception("", Components.results.NS_OK);
            }

            // Requesting only a DATE returns items based on UTC. Therefore, we make
            // sure both start and end dates include a time and timezone. This may
            // not quite be what was requested, but I'd say its a shortcoming of
            // rfc3339.
            if (aRangeStart) {
                aRangeStart = aRangeStart.clone();
                aRangeStart.isDate = false;
            }
            if (aRangeEnd) {
                aRangeEnd = aRangeEnd.clone();
                aRangeEnd.isDate = false;
            }

            var rfcRangeStart = cal.toRFC3339(aRangeStart);
            var rfcRangeEnd = cal.toRFC3339(aRangeEnd);

            var request = new calGoogleRequest(this);

            request.type = request.GET;
            request.uri = this.fullUri.spec;
            request.operationListener = aListener;
            request.calendar = this;
            request.itemRangeStart = aRangeStart;
            request.itemRangeEnd = aRangeEnd;
            request.itemFilter = aItemFilter;

            // Request Parameters
            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);
            request.addQueryParameter("max-results",
                                      aCount ? aCount : kMANY_EVENTS);
            request.addQueryParameter("singleevents", "false");
            request.addQueryParameter("start-min", rfcRangeStart);
            request.addQueryParameter("start-max", rfcRangeEnd);
            request.responseListener = { onResult: this.getItems_response.bind(this) };
            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
        return null;
    },

    refresh: function cGC_refresh() {
        this.mObservers.notify("onLoad", [this]);
    },

    /*
     * Google Calendar Provider Response Listener functions
     */

    /**
     * addItem_response
     * Response function, called by the session object when an item was added
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    addItem_response: function cGC_addItem_response(aOperation, aData) {
        // First, have the general response retrieve the item
        let item, e;
        try {
            item = DataToItem(aOperation, aData, this, null);
            if (!resolveConflicts(aOperation, item)) {
                // If a conflict occurred and the user wants to overwrite, a new
                // request will be sent. bail out here, this method will be
                // called again
                return;
            }
        } catch (exp) {
            item = null;
            e = exp;
        }

        // Now we can do some processing on it. If the cache is used, then we
        // ultimately need to add the item to the cache, either as offline item
        // or normal item. We will also have to notify the listener and the
        // observers sooner or later.
        if (aOperation.useCache && this.mOfflineStorage && (!e || isCacheException(e))) {
            let listener;
            if (item) {
                // If we have an item, then we can directly notify the target
                // listener
                listener = aOperation.operationListener;
                cal.LOG("[calGoogleCalendar] Adding item " + aOperation.newItem.title + " successful");
            } else {
                // Otherwise we create an intermediate listener that also sets
                // the offline flag
                let storage = this.mOfflineStorage.QueryInterface(Components.interfaces.calIOfflineStorage);
                let self = this;
                item = aOperation.newItem;
                listener = {
                    onGetResult: function(calendar, status, itemType, detail, count, items) {},
                    onOperationComplete: function(calendar, status, opType, id, detail) {
                        if (Components.isSuccessCode(status)) {
                            // On success, the addOfflineItem call will notify the listener
                            cal.LOG("[calGoogleCalendar] Adding item " + aOperation.newItem.title + " failed, but the operation will be retried (status: " + status + ", exception: " + e + ")");
                            storage.addOfflineItem(detail, aOperation.operationListener);
                            self.mObservers.notify("onAddItem", [aOperation.newItem]);
                        } else if (aOperation.operationListener) {
                            cal.ERROR("[calGoogleCalendar] Could not add item " + aOperation.newItem.title + " to the offline cache:" +
                                      new Components.Exception(detail, status));
                            // Otherwise we have to do it ourselves.
                            self.notifyOperationComplete(aOperation.operationListener,
                                                         status,
                                                         Components.interfaces.calIOperationListener.ADD,
                                                         null,
                                                         null);
                        }
                    }
                };
            }

            // Now send the item to the offline storage
            this.mOfflineStorage.adoptItem(item, listener);
        } else {
            // When not using the cache, we merely have to notify onAddItem and
            // tell the operation listener we are done (error or not)
            if (item) {
                cal.LOG("[calGoogleCalendar] Adding item " + item.title + " successful");
                this.mObservers.notify("onAddItem", [item]);
            } else {
                cal.LOG("[calGoogleCalendar] Adding item " + aOperation.newItem.id + " failed, status " + aOperation.status + ", Exception: " + e);
            }
            this.notifyOperationComplete(aOperation.operationListener,
                                         (item ? Components.results.NS_OK : e.result),
                                         Components.interfaces.calIOperationListener.ADD,
                                         (item ? item.id : null),
                                         (item ? item : e.message));
        }
    },

    /**
     * modifyItem_response
     * Response function, called by the session object when an item was modified
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    modifyItem_response: function cGC_modifyItem_response_onResult(aOperation,
                                                                   aData) {
        let self = this;
        function notifyObserver(item, oldItem) {
            if (item && item.parentItem != item) {
                item.parentItem.recurrenceInfo.modifyException(item, false);
                item = item.parentItem;
                oldItem = oldItem.parentItem;
            }
            // Notify Observers
            if (item) {
                self.mObservers.notify("onModifyItem", [item, oldItem]);
            }
        }

        // First, convert the data to an item and make sure no conflicts occurred.
        let newItem, e;
        try {
            newItem = DataToItem(aOperation, aData, this, aOperation.newItem);
            if (!resolveConflicts(aOperation, newItem)) {
                // If a conflict occurred and the user wants to overwrite, a new
                // request will be sent. bail out here, this method will be
                // called again
                return;
            }
        } catch (exp) {
            newItem = null;
            e = exp;
        }

        // Now we can do some processing on it. If the cache is used, then we
        // ultimately need to modify the item in the cache, either as offline item
        // or normal item. We will also have to notify the listener and the
        // observers sooner or later.
        if (aOperation.useCache && this.mOfflineStorage && (!e || isCacheException(e))) {
            let listener;
            if (newItem) {
                // If we have an item, then we can directly notify the target
                // listener
                listener = aOperation.operationListener;
                cal.LOG("[calGoogleCalendar] Modifying item " + aOperation.oldItem.id + " successful");
            } else {
                let storage = this.mOfflineStorage.QueryInterface(Components.interfaces.calIOfflineStorage);
                newItem = aOperation.newItem;
                listener = {
                    onGetResult: function(calendar, status, itemType, detail, count, items) {},
                    onOperationComplete: function(calendar, status, opType, id, detail) {
                        if (Components.isSuccessCode(status)) {
                            cal.LOG("[calGoogleCalendar] Modifying item " + aOperation.oldItem.id + " failed, but the operation will be retried (status: " + status + ", exception: " + e + ")");
                            // On success, the modifyOfflineItem call will notify the listener
                            storage.modifyOfflineItem(detail, aOperation.operationListener);
                            notifyObserver(newItem, aOperation.oldItem);
                        } else if (aOperation.operationListener) {
                            cal.ERROR("[calGoogleCalendar] Could not modify item " + aOperation.newItem.id + " in the offline cache:" +
                                      new Components.Exception(detail, status));
                            // Otherwise we have to do it ourselves.
                            self.notifyOperationComplete(aOperation.operationListener,
                                                         status,
                                                         Components.interfaces.calIOperationListener.MODIFY,
                                                         null,
                                                         null);
                        }
                    }
                };
            }

            // Now send the item to the offline storage
            this.mOfflineStorage.modifyItem(newItem, aOperation.oldItem, listener);
        } else {
            // When not using the cache, we merely have to notify onModifyItem and
            // tell the operation listener we are done (error or not)
            notifyObserver(newItem, aOperation.oldItem);
            if (newItem) {
                cal.LOG("[calGoogleCalendar] Modifying item " + newItem.id + " successful");
            } else {
                cal.LOG("[calGoogleCalendar] Modifying item " + aOperation.oldItem.id + " failed, status " + aOperation.status + ", Exception: " + e);
            }
            this.notifyOperationComplete(aOperation.operationListener,
                                         (newItem ? Components.results.NS_OK : e.result || Components.results.NS_ERROR_FAILURE),
                                         Components.interfaces.calIOperationListener.MODIFY,
                                         (newItem ? newItem.id : null),
                                         (newItem ? newItem : e.message));
        }
    },

    /**
     * deleteItem_response
     * Response function, called by the session object when an Item was deleted
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    deleteItem_response: function cGC_deleteItem_response_onResult(aOperation,
                                                                   aData) {
        let item, e;
        try {
            item = DataToItem(aOperation, aData, this, aOperation.oldItem);
            if (!resolveConflicts(aOperation, item)) {
                // If a conflict occurred and the user wants to overwrite, a new
                // request will be sent. bail out here, this method will be
                // called again
                return;
            }
        } catch (exp) {
            item = null;
            e = exp;
        }

        if (aOperation.useCache && this.mOfflineStorage && (!e || isCacheException(e))) {
            if (item) {
                // If we have an item, then we can directly notify the target
                // listener using the offline storage
                cal.LOG("[calGoogleCalendar] Deleting item " + aOperation.oldItem.id + " successful");
                this.mOfflineStorage.deleteItem(item, aOperation.operationListener);
            } else {
                // Otherwise we shouldn't remove it from the cache, but set the
                // offline flag to mark it deleted
                let self = this;
                let offlineListener = {
                    // We should not return a success code since the listeners can delete the physical item in case of success
                    onGetResult: function(calendar, status, itemType, detail, count, items) {},
                    onOperationComplete: function(calendar, status, opType, id, detail) {
                        self.mObservers.notify("onDeleteItem", [aOperation.oldItem]);
                        cal.LOG("[calGoogleCalendar] Deleting item " + aOperation.oldItem.id + " failed, but the operation will be retried");
                        self.notifyOperationComplete(aOperation.operationListener,
                                                     Components.results.NS_ERROR_NOT_AVAILABLE,
                                                     Components.interfaces.calIOperationListener.GET,
                                                     aOperation.oldItem.id,
                                                     aOperation.oldItem);
                    }
                };
                let storage = this.mOfflineStorage.QueryInterface(Components.interfaces.calIOfflineStorage);
                storage.deleteOfflineItem(aOperation.oldItem, offlineListener);
            }
        } else {
            // When not using the cache, we merely have to notify onDeleteItem and
            // tell the operation listener we are done (error or not)
            if (item) {
                cal.LOG("[calGoogleCalendar] Deleting item " + aOperation.oldItem.id + " successful");
                this.mObservers.notify("onDeleteItem", [item]);
            } else {
                cal.LOG("[calGoogleCalendar] Deleting item " + aOperation.oldItem.id + " failed, status " + aOperation.status + ", Exception: " + e);
            }
            this.notifyOperationComplete(aOperation.operationListener,
                                         (item ? Components.results.NS_OK : e.result || Components.results.NS_ERROR_FAILURE),
                                         Components.interfaces.calIOperationListener.ADD,
                                         (item ? item.id : null),
                                         (item ? item : e.message));
        }
    },

    /**
     * getItem_response
     * Response function, called by the session object when a single Item was
     * downloaded.
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    getItem_response: function cGC_getItem_response_onResult(aOperation,
                                                             aData) {
        // XXX Due to google issue 399, we need to parse a full feed here.
        try {
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // Prepare Namespaces
            var gCal = new Namespace("gCal",
                                     "http://schemas.google.com/gCal/2005");
            var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
            var atom = new Namespace("", "http://www.w3.org/2005/Atom");
            default xml namespace = atom;

            // A feed was passed back, parse it.
            var xml = cal.safeNewXML(aData);
            var timezoneString = xml.gCal::timezone.@value.toString() || "UTC";
            var timezone = gdataTimezoneService.getTimezone(timezoneString);

            // This line is needed, otherwise the for each () block will never
            // be entered. It may seem strange, but if you don't believe me, try
            // it!
            xml.link.(@rel);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            // Get the item entry by id.
            var itemEntry = xml.entry.(id.substring(id.lastIndexOf('/') + 1) == aOperation.itemId ||
                                       gCal::uid.@value == aOperation.itemId);
            if (!itemEntry || !itemEntry.length()) {
                // Item wasn't found. Skip onGetResult and just complete. Not
                // finding an item isn't a user-important error, it may be a
                // wanted case. (i.e itip)
                cal.LOG("[calGoogleCalendar] Item " + aOperation.itemId + " not found in calendar " + this.name);
                throw new Components.Exception("Item not found", Components.results.NS_OK);
            }
            var item = XMLEntryToItem(itemEntry, timezone, this);
            item.calendar = this.superCalendar;

            if (item.recurrenceInfo) {
                // If this item is recurring, get all exceptions for this item.
                for each (var entry in xml.entry.gd::originalEvent.(@id == aOperation.itemId)) {
                    var excItem = XMLEntryToItem(entry.parent(), timezone, this);

                    // Google uses the status field to reflect negative
                    // exceptions.
                    if (excItem.status == "CANCELED") {
                        item.recurrenceInfo.removeOccurrenceAt(excItem.recurrenceId);
                    } else {
                        excItem.calendar = this;
                        item.recurrenceInfo.modifyException(excItem, true);
                    }
                }
            }
            // We are done, notify the listener of our result and that we are
            // done.
            cal.LOG("[calGoogleCalendar] Item " + aOperation.itemId + " was found in calendar " + this.name);
            aOperation.operationListener.onGetResult(this.superCalendar,
                                                     Components.results.NS_OK,
                                                     Components.interfaces.calIEvent,
                                                     null,
                                                     1,
                                                     [item]);
            this.notifyOperationComplete(aOperation.operationListener,
                                         Components.results.NS_OK,
                                         Components.interfaces.calIOperationListener.GET,
                                         item.id,
                                         null);
        } catch (e) {
            if (!Components.isSuccessCode(e.result)) {
                cal.LOG("[calGoogleCalendar] Error getting item " + aOperation.itemId + ":\n" + e);
                Components.utils.reportError(e);
            }
            this.notifyOperationComplete(aOperation.operationListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
    },

    /**
     * getItems_response
     * Response function, called by the session object when an Item feed was
     * downloaded.
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    getItems_response: function cGC_getItems_response(aOperation, aData) {
        // To simplify code, provide a one-stop function to call, independant of
        // if and what type of listener was passed.
        var listener = aOperation.operationListener ||
            { onGetResult: function() {}, onOperationComplete: function() {} };

        cal.LOG("[calGoogleCalendar] Recieved response for " + aOperation.uri);
        try {
            // Check if the call succeeded
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // Prepare Namespaces
            var gCal = new Namespace("gCal",
                                     "http://schemas.google.com/gCal/2005");
            var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
            var atom = new Namespace("", "http://www.w3.org/2005/Atom");
            default xml namespace = atom;

            // A feed was passed back, parse it.
            var xml = cal.safeNewXML(aData);
            var timezoneString = xml.gCal::timezone.@value.toString() || "UTC";
            var timezone = gdataTimezoneService.getTimezone(timezoneString);

            // This line is needed, otherwise the for each () block will never
            // be entered. It may seem strange, but if you don't believe me, try
            // it!
            xml.link.(@rel);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            if (xml.author.email == this.mSession.userName) {
                // If the current entry contains the user's email, then we can
                // extract the user's full name also.
                this.mSession.fullName = xml.author.name.toString();
            }


            var wantInvitations = ((aOperation.itemFilter &
                 Components.interfaces.calICalendar.ITEM_FILTER_REQUEST_NEEDS_ACTION) != 0);

            // Parse all <entry> tags
            for each (var entry in xml.entry) {
                if (entry.gd::originalEvent.toString().length) {
                    // This is an exception. If we are doing an uncached
                    // operation, then skip it for now since it will be parsed
                    // later.
                    continue;
                }


                var item = XMLEntryToItem(entry, timezone, this);
                item.calendar = this.superCalendar;

                if (wantInvitations) {
                    // If invitations are wanted and this is not an invitation,
                    // or if the user is not an attendee, or has already accepted
                    // then this is not an invitation.
                    var att = item.getAttendeeById("mailto:" + this.session.userName);
                    if (!this.isInvitation(item) ||
                        !att ||
                        att.participationStatus != "NEEDS-ACTION") {
                        continue;
                    }
                }

                cal.LOG("[calGoogleCalendar] Parsing entry:\n" + entry + "\n");

                if (item.recurrenceInfo) {
                    // If we are doing an uncached operation, then we need to
                    // gather all exceptions and put them into the item.
                    // Otherwise, our listener will take care of mapping the
                    // exception to the base item.
                    for each (var oid in xml.entry.gd::originalEvent.(@id == item.id)) {
                        // Get specific fields so we can speed up the parsing process
                        var status = oid.parent().gd::eventStatus.@value.toString().substring(39);

                        if (status == "canceled") {
                            let rId = oid.gd::when.@startTime.toString();
                            let rDate = cal.fromRFC3339(rId, timezone);
                            cal.LOG("[calGoogleCalendar] Negative exception " + rId + "/" + rDate);
                            item.recurrenceInfo.removeOccurrenceAt(rDate);
                        } else {
                            // Parse the exception and modify the current item
                            var excItem = XMLEntryToItem(oid.parent(),
                                                         timezone,
                                                         this);
                            if (excItem) {
                                // Google uses the status field to reflect negative
                                // exceptions.
                                excItem.calendar = this;
                                item.recurrenceInfo.modifyException(excItem, true);
                            }
                        }
                    }
                }

                item.makeImmutable();
                LOGitem(item);

                // This is an uncached call, expand the item and tell our
                // get listener about the item.
                var expandedItems = expandItems(item, aOperation);
                listener.onGetResult(this.superCalendar,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIEvent,
                                     null,
                                     expandedItems.length,
                                     expandedItems);
            }
            // Operation Completed successfully.
            this.notifyOperationComplete(listener,
                                         Components.results.NS_OK,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         null);
        } catch (e) {
            cal.LOG("[calGoogleCalendar] Error getting items:\n" + e);
            this.notifyOperationComplete(listener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
    },

    /**
     * Implement calIChangeLog
     */
    get offlineStorage() {
        return this.mOfflineStorage;
    },

    set offlineStorage(val) {
        return (this.mOfflineStorage = val);
    },

    resetLog: function cGC_resetLog() {
        cal.LOG("[calGoogleCalendar] Resetting last updated counter for " + this.name);
        this.deleteProperty("google.lastUpdated");
    },

    replayChangesOn: function cGC_replayChangesOn(aListener) {
        var lastUpdate = this.getProperty("google.lastUpdated");
        var lastUpdateDateTime;
        if (lastUpdate) {
            // Set up the last sync stamp
            lastUpdateDateTime = createDateTime();
            lastUpdateDateTime.icalString = lastUpdate;

            // Set up last week
            var lastWeek = getCorrectedDate(now().getInTimezone(UTC()));
            lastWeek.day -= 7;
            if (lastWeek.compare(lastUpdateDateTime) >= 0) {
                // The last sync was longer than a week ago. Google requires a full
                // sync in that case. This call also takes care of calling
                // resetLog().
                this.superCalendar.wrappedJSObject.setupCachedCalendar();
                lastUpdateDateTime = null;
            }
            cal.LOG("[calGoogleCalendar] The calendar " + this.name + " was last modified: " + lastUpdateDateTime);
        }

        var request = new calGoogleRequest(this.mSession);

        request.type = request.GET;
        request.uri = this.fullUri.spec
        request.destinationCal = this.mOfflineStorage;

        var calendar = this;
        request.responseListener = { onResult: this.syncItems_response.bind(this, (lastUpdateDateTime == null)) }
        request.operationListener = aListener;
        request.calendar = this;

        // Request Parameters
        request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);
        request.addQueryParameter("max-results", kMANY_EVENTS);
        request.addQueryParameter("singleevents", "false");

        if (lastUpdateDateTime) {
            // Partial sync requires sending updated-min
            request.addQueryParameter("updated-min", cal.toRFC3339(lastUpdateDateTime));
        }

        // Request the item. The response function is ready to take care of both
        // uncached getItem requests and this type of synchronization request.
        this.mSession.asyncItemRequest(request);
    },

    /**
     * syncItems_response
     * Response function, called by the session object when an Item feed was
     * downloaded.
     *
     * @param aIsFullSync   If set, this is a full sync rather than an update.
     * @param aOperation    The calIGoogleRequest processing the request
     * @param aData         In case of an error, this is the error string, otherwise
     *                        an XML representation of the added item.
     */
    syncItems_response: function cGC_syncItems_response(aIsFullSync, aOperation, aData) {
        cal.LOG("[calGoogleCalendar] Recieved response for " + aOperation.uri + (aIsFullSync ? " (full sync)" : ""));
        try {
            // Check if the call succeeded
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // Prepare Namespaces
            var gCal = new Namespace("gCal",
                                     "http://schemas.google.com/gCal/2005");
            var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
            var atom = new Namespace("", "http://www.w3.org/2005/Atom");
            default xml namespace = atom;

            // A feed was passed back, parse it.
            var xml = cal.safeNewXML(aData);
            var timezoneString = xml.gCal::timezone.@value.toString() || "UTC";
            var timezone = gdataTimezoneService.getTimezone(timezoneString);

            // This line is needed, otherwise the for each () block will never
            // be entered. It may seem strange, but if you don't believe me, try
            // it!
            xml.link.(@rel);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            if (xml.author.email == this.mSession.userName) {
                // If the current entry contains the user's email, then we can
                // extract the user's full name also.
                this.mSession.fullName = xml.author.name.toString();
            }

            // This is the calendar we should sync changes into.
            var destinationCal = aOperation.destinationCal;

            for each (var entry in xml.entry) {

                var recurrenceId = getRecurrenceIdFromEntry(entry, timezone);
                if (aIsFullSync && recurrenceId) {
                    // On a full sync, we parse exceptions different.
                    continue;
                }
                cal.LOG("[calGoogleCalendar] Parsing entry:\n" + entry + "\n");

                var referenceItemObj = {}
                destinationCal.getItem(getIdFromEntry(entry),
                                       new syncSetter(referenceItemObj));
                var referenceItem = referenceItemObj.value &&
                                    referenceItemObj.value.clone();

                // Parse the item. If we got a reference item from the storage
                // calendar, put that in to make sure we get all exceptions and
                // such.
                var item = XMLEntryToItem(entry,
                                          timezone,
                                          this,
                                          (recurrenceId && referenceItem ? null : referenceItem));
                item.calendar = this.superCalendar;

                if (aIsFullSync && item.recurrenceInfo) {
                    // On a full synchronization, we can go ahead and pre-parse
                    // all exceptions and then add the item at once. This way we
                    // make sure
                    for each (var oid in xml.entry.gd::originalEvent.(@id == item.id)) {
                        // Get specific fields so we can speed up the parsing process
                        var status = oid.parent().gd::eventStatus.@value.toString().substring(39);

                        if (status == "canceled") {
                            let rId = oid.gd::when.@startTime.toString();
                            let rDate = cal.fromRFC3339(rId, timezone);
                            item.recurrenceInfo.removeOccurrenceAt(rDate);
                            cal.LOG("[calGoogleCalendar] Negative exception " + rId + "/" + rDate);
                        } else {
                            // Parse the exception and modify the current item
                            var excItem = XMLEntryToItem(oid.parent(),
                                                         timezone,
                                                         this);
                            if (excItem) {
                                // Google uses the status field to reflect negative
                                // exceptions.
                                excItem.calendar = this;
                                item.recurrenceInfo.modifyException(excItem, true);
                            }
                        }
                    }
                }

                LOGitem(item);

                if (!aIsFullSync && item.recurrenceId && referenceItem) {
                    // This is a single occurrence that has been updated.
                    if (item.status == "CANCELED") {
                        // Canceled means the occurrence is an EXDATE.
                        referenceItem.recurrenceInfo.removeOccurrenceAt(item.recurrenceId);
                    } else {
                        // Not canceled means the occurrence was modified.
                        item.parentItem = referenceItem;
                        referenceItem.recurrenceInfo.modifyException(item, true);
                    }
                    destinationCal.modifyItem(referenceItem, null, null);
                } else if (!item.recurrenceId) {
                    // This is a normal item. If it was canceled, then it should
                    // be deleted, otherwise it should be either added or
                    // modified. The relaxed mode of the destination calendar
                    // takes care of the latter two cases.
                    if (item.status == "CANCELED") {
                        destinationCal.deleteItem(item, null);
                    } else {
                        destinationCal.modifyItem(item, null, null);
                    }
                } else {
                    // We could not find the parent item for the occurrence in
                    // the feed.
                    WARN("occurrence without parent for item "  + item.id);
                }
            }

            // Set the last updated timestamp to now.
            cal.LOG("[calGoogleCalendar] Last sync date for " + this.name + " is now: " +
                    aOperation.requestDate.toString());
            this.setProperty("google.lastUpdated",
                             aOperation.requestDate.icalString);

            // Tell our listener we are done.
            aOperation.operationListener.onResult(aOperation, null);
        } catch (e) {
            cal.LOG("[calGoogleCalendar] Error syncing items:\n" + e);
            aOperation.operationListener.onResult({ status: e.result }, e.message);
        }
    },

    /**
     * Implement calISchedulingSupport. Most is taken care of by the base
     * provider, but we want to advertise that we will always take care of
     * notifications.
     */
    canNotify: function cGC_canNotify(aMethod, aItem) {
        return true;
    }
};
