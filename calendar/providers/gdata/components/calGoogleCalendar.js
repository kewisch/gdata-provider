/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");
Components.utils.import("resource://calendar/modules/calXMLUtils.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

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
const calGoogleCalendarClassID = Components.ID("{d1a6e988-4b4d-45a5-ba46-43e501ea96e3}");
const calGoogleCalendarInterfaces = [
    Components.interfaces.calICalendar,
    Components.interfaces.calIGoogleCalendar,
    Components.interfaces.calISchedulingSupport,
    Components.interfaces.calIChangeLog
];
calGoogleCalendar.prototype = {
    __proto__: cal.ProviderBase.prototype,
    classID: calGoogleCalendarClassID,
    QueryInterface: XPCOMUtils.generateQI(calGoogleCalendarInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calGoogleCalendarClassID,
        contractID: "@mozilla.org/calendar/calendar;1?type=gdata",
        classDescription: "Google Calendar Provider",
        interfaces: calGoogleCalendarInterfaces
    }),

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
        let sessionMgr = getGoogleSessionManager();
        let googleUser = getCalendarPref(this, "googleUser");
        if (googleUser) {
            this.mSession = sessionMgr.getSessionByUsername(googleUser, true);
        } else {
            // We have no user, therefore we need to ask the user. Show a
            // user/password prompt and set the session based on those
            // values.

            let username = { value: null };
            if (this.isDefaultCalendar) {
                // Only pre-fill the username if this is the default calendar,
                // otherwise users might think the cryptic hash is the username
                // they have to use.
                username.value = this.mCalendarName;
            }
            let password = { value: null };
            let persist = { value: false };

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
        let re = new RegExp("/calendar/(feeds|ical)/" +
                            "([^/]+)/(public|private)-?([^/]+)?/" +
                            "(full|basic)(.ics)?$");

        let matches = aUri.path.match(re);

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
                    !Preferences.get("calendar.google.enableEmailInvitations", false)) {
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
                    !Preferences.get("calendar.google.enableEmailInvitations", false)) {
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

            let request = new calGoogleRequest(this);
            let xmlEntry = ItemToXMLEntry(aItem, this,
                                          this.session.userName,
                                          this.session.fullName);

            request.type = request.ADD;
            request.uri = this.fullUri.spec;
            request.setUploadData("application/atom+xml; charset=UTF-8", cal.xml.serializeDOM(xmlEntry));
            request.operationListener = aListener;
            request.calendar = this;
            request.newItem = aItem;
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
        return this.adoptItem(aItem.clone(), aListener);
    },

    modifyItem: function cGC_modifyItem(aNewItem, aOldItem, aListener) {
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
            let request = new calGoogleRequest(this.session);

            // We need to clone the new item, its possible that ItemToXMLEntry
            // will modify the item. For example, if the item is organized by
            // someone else, we cannot save alarms on it and they should
            // therefore not be added in the returned item.
            let newItem = aNewItem.clone();

            let xmlEntry = ItemToXMLEntry(newItem, this,
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

            request.setUploadData("application/atom+xml; charset=UTF-8", cal.xml.serializeDOM(xmlEntry));
            request.responseListener = { onResult: this.modifyItem_response.bind(this) };
            request.operationListener = aListener;
            request.newItem = newItem;
            request.oldItem = aOldItem;
            request.calendar = this;
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
            let request = new calGoogleRequest(this);

            request.type = request.DELETE;
            request.uri = getItemEditURI(aItem);
            request.operationListener = aListener;
            request.oldItem = aItem;
            request.calendar = this;
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

            let request = new calGoogleRequest(this);

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
            let wantEvents = ((aItemFilter &
                               Components.interfaces.calICalendar.ITEM_FILTER_TYPE_EVENT) != 0);
            let wantInvitations = ((aItemFilter &
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

            let rfcRangeStart = cal.toRFC3339(aRangeStart);
            let rfcRangeEnd = cal.toRFC3339(aRangeEnd);

            let request = new calGoogleRequest(this);

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

        let resultCode;
        if (item) {
            cal.LOG("[calGoogleCalendar] Adding item " + item.title + " successful");
            this.mObservers.notify("onAddItem", [item]);
            resultCode = Components.results.NS_OK;
        } else {
            cal.LOG("[calGoogleCalendar] Adding item " + aOperation.newItem.id + " failed, status " + aOperation.status + ", Exception: " + e);
            resultCode = isCacheException(e) ? Components.results.NS_ERROR_NOT_AVAILABLE : e.result || Components.results.NS_ERROR_FAILURE;
        }

        this.notifyOperationComplete(aOperation.operationListener,
                                     resultCode,
                                     Components.interfaces.calIOperationListener.ADD,
                                     (item ? item.id : null),
                                     (item ? item : e.message));
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

        let resultCode;
        if (newItem) {
            cal.LOG("[calGoogleCalendar] Modifying item " + newItem.id + " successful");
            notifyObserver(newItem, aOperation.oldItem);
            resultCode = Components.results.NS_OK;
        } else {
            cal.LOG("[calGoogleCalendar] Modifying item " + aOperation.oldItem.id + " failed, status " + aOperation.status + ", Exception: " + e);
            resultCode = isCacheException(e) ? Components.results.NS_ERROR_NOT_AVAILABLE : e.result || Components.results.NS_ERROR_FAILURE;
        }
        this.notifyOperationComplete(aOperation.operationListener,
                                     resultCode,
                                     Components.interfaces.calIOperationListener.MODIFY,
                                     (newItem ? newItem.id : null),
                                     (newItem ? newItem : e.message));
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

        let resultCode;
        if (item) {
            cal.LOG("[calGoogleCalendar] Deleting item " + aOperation.oldItem.id + " successful");
            this.mObservers.notify("onDeleteItem", [item]);
            resultCode = Components.results.NS_OK;
        } else {
            cal.LOG("[calGoogleCalendar] Deleting item " + aOperation.oldItem.id + " failed, status " + aOperation.status + ", Exception: " + e);
            resultCode = isCacheException(e) ? Components.results.NS_ERROR_NOT_AVAILABLE : e.result || Components.results.NS_ERROR_FAILURE;
        }
        this.notifyOperationComplete(aOperation.operationListener,
                                     resultCode,
                                     Components.interfaces.calIOperationListener.DELETE,
                                     (item ? item.id : null),
                                     (item ? item : e.message));
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

            // A feed was passed back, parse it.
            let xml = cal.xml.parseString(aData);
            let timezoneString = gdataXPathFirst(xml, 'atom:feed/gCal:timezone/@value') || "UTC";
            let timezone = gdataTimezoneService.getTimezone(timezoneString);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            // Get the item entry by id.
            let itemXPath = 'atom:feed/atom:entry[substring-before(atom:id/text(), "' + aOperation.itemId + '")!="" or gCal:uid/@value="' + aOperation.itemId + '"]';
            let itemEntry = gdataXPathFirst(xml, itemXPath);
            if (!itemEntry) {
                // Item wasn't found. Skip onGetResult and just complete. Not
                // finding an item isn't a user-important error, it may be a
                // wanted case. (i.e itip)
                cal.LOG("[calGoogleCalendar] Item " + aOperation.itemId + " not found in calendar " + this.name);
                throw new Components.Exception("Item not found", Components.results.NS_OK);
            }
            let item = XMLEntryToItem(itemEntry, timezone, this);
            item.calendar = this.superCalendar;

            if (item.recurrenceInfo) {
                // If this item is recurring, get all exceptions for this item.
                for each (let entry in gdataXPath(xml, 'atom:feed/atom:entry[gd:originalEvent/@id="' + aOperation.itemId + '"]')) {
                    let excItem = XMLEntryToItem(entry, timezone, this);

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
        let listener = aOperation.operationListener ||
            { onGetResult: function() {}, onOperationComplete: function() {} };

        cal.LOG("[calGoogleCalendar] Received response for " + aOperation.uri);
        try {
            // Check if the call succeeded
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // A feed was passed back, parse it.
            let xml = cal.xml.parseString(aData);
            let timezoneString = gdataXPathFirst(xml, 'atom:feed/gCal:timezone/@value') || "UTC";
            let timezone = gdataTimezoneService.getTimezone(timezoneString);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            if (gdataXPathFirst(xml, 'atom:feed/atom:author/atom:email/text()') == this.mSession.userName) {
                // If the current entry contains the user's email, then we can
                // extract the user's full name also.
                this.mSession.fullName = gdataXPathFirst(xml, 'atom:feed/atom:author/atom:name/text()');
            }

            let wantInvitations = ((aOperation.itemFilter &
                 Components.interfaces.calICalendar.ITEM_FILTER_REQUEST_NEEDS_ACTION) != 0);

            // Parse all <entry> tags
            for each (let entry in gdataXPath(xml, 'atom:feed/atom:entry')) {
                if (gdataXPathFirst(entry, 'gd:originalEvent')) {
                    // This is an exception. If we are doing an uncached
                    // operation, then skip it for now since it will be parsed
                    // later.
                    continue;
                }

                let item = XMLEntryToItem(entry, timezone, this);
                item.calendar = this.superCalendar;

                if (wantInvitations) {
                    // If invitations are wanted and this is not an invitation,
                    // or if the user is not an attendee, or has already accepted
                    // then this is not an invitation.
                    let att = item.getAttendeeById("mailto:" + this.session.userName);
                    if (!this.isInvitation(item) ||
                        !att ||
                        att.participationStatus != "NEEDS-ACTION") {
                        continue;
                    }
                }

                cal.LOG("[calGoogleCalendar] Parsing entry:\n" + cal.xml.serializeDOM(entry) + "\n");

                if (item.recurrenceInfo) {
                    // If we are doing an uncached operation, then we need to
                    // gather all exceptions and put them into the item.
                    // Otherwise, our listener will take care of mapping the
                    // exception to the base item.
                    for each (let oid in gdataXPath(xml, 'atom:feed/atom:entry[gd:originalEvent/@id="' + item.id + '"]')) {
                        // Get specific fields so we can speed up the parsing process
                        let status = gdataXPathFirst(oid, 'gd:eventStatus/@value').substring(39);

                        if (status == "canceled") {
                            let rId = gdataXPathFirst(oid, 'gd:when/@startTime');
                            let rDate = cal.fromRFC3339(rId, timezone);
                            cal.LOG("[calGoogleCalendar] Negative exception " + rId + "/" + rDate);
                            item.recurrenceInfo.removeOccurrenceAt(rDate);
                        } else {
                            // Parse the exception and modify the current item
                            let excItem = XMLEntryToItem(oid, timezone, this);

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
                let expandedItems = expandItems(item, aOperation);
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
        let lastUpdate = this.getProperty("google.lastUpdated");
        let lastUpdateDateTime;
        if (lastUpdate) {
            // Set up the last sync stamp
            lastUpdateDateTime = createDateTime();
            lastUpdateDateTime.icalString = lastUpdate;

            // Set up last week
            let lastWeek = getCorrectedDate(now().getInTimezone(UTC()));
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

        let request = new calGoogleRequest(this.mSession);

        request.type = request.GET;
        request.uri = this.fullUri.spec
        request.destinationCal = this.mOfflineStorage;

        let calendar = this;
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
        cal.LOG("[calGoogleCalendar] Received response for " + aOperation.uri + (aIsFullSync ? " (full sync)" : ""));
        try {
            // Check if the call succeeded
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // A feed was passed back, parse it.
            let xml = cal.xml.parseString(aData);
            let timezoneString = gdataXPathFirst(xml, 'atom:feed/gCal:timezone/@value') || "UTC";
            let timezone = gdataTimezoneService.getTimezone(timezoneString);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            if (gdataXPathFirst(xml, 'atom:feed/atom:author/atom:email/text()') == this.mSession.userName) {
                // If the current entry contains the user's email, then we can
                // extract the user's full name also.
                this.mSession.fullName = gdataXPathFirst(xml, 'atom:feed/atom:author/atom:name/text()');
            }

            // This is the calendar we should sync changes into.
            let destinationCal = aOperation.destinationCal;

            for each (let entry in gdataXPath(xml, 'atom:feed/atom:entry')) {
                let recurrenceId = getRecurrenceIdFromEntry(entry, timezone);
                if (aIsFullSync && recurrenceId) {
                    // On a full sync, we parse exceptions different.
                    continue;
                }
                cal.LOG("[calGoogleCalendar] Parsing entry:\n" + entry + "\n");

                let referenceItemObj = {}
                destinationCal.getItem(getIdFromEntry(entry),
                                       new syncSetter(referenceItemObj));
                let referenceItem = referenceItemObj.value &&
                                    referenceItemObj.value.clone();

                // Parse the item. If we got a reference item from the storage
                // calendar, put that in to make sure we get all exceptions and
                // such.
                let item = XMLEntryToItem(entry,
                                          timezone,
                                          this,
                                          (recurrenceId && referenceItem ? null : referenceItem));
                item.calendar = this.superCalendar;

                if (aIsFullSync && item.recurrenceInfo) {
                    // On a full synchronization, we can go ahead and pre-parse
                    // all exceptions and then add the item at once. This way we
                    // make sure
                    for each (let oid in gdataXPath(xml, 'atom:feed/atom:entry[gd:originalEvent/@id="' + item.id + '"]')) {
                        // Get specific fields so we can speed up the parsing process
                        let status = gdataXPathFirst(oid, 'gd:eventStatus/@value').substring(39);

                        if (status == "canceled") {
                            let rId = gdataXPathFirst(oid, 'gd:when/@startTime');
                            let rDate = cal.fromRFC3339(rId, timezone);
                            item.recurrenceInfo.removeOccurrenceAt(rDate);
                            cal.LOG("[calGoogleCalendar] Negative exception " + rId + "/" + rDate);
                        } else {
                            // Parse the exception and modify the current item
                            let excItem = XMLEntryToItem(oid, timezone, this);

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
