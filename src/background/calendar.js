/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import sessions from "./session.js";
import calGoogleRequest from "./request.js";
import { ItemError, ResourceGoneError, QuotaFailureError } from "./errors.js";
import Console from "./log.js";
import TimezoneService from "./timezone.js";

import { getGoogleId, sessionIdFromUrl, isEmail, GCAL_PATH_RE, API_BASE } from "./utils.js";
import { itemToJson, jsonToItem, jsonToAlarm, patchItem, ItemSaver } from "./items.js";

var console = new Console("calGoogleCalendar");

export default class calGoogleCalendar {
  static _instances = {};

  static async get(id) {
    if (!this._instances[id]) {
      let calendar = await messenger.calendar.calendars.get(id);
      if (!calendar || calendar.type != "ext-" + messenger.runtime.id) {
        throw new Error(`Requesting invalid calendar type ${calendar?.type} with id ${id}`);
      }
      this._instances[id] = new calGoogleCalendar(calendar);
    }
    return this._instances[id];
  }

  static initListeners() {
    messenger.calendar.provider.onItemCreated.addListener(
      (calendar, item, options) => {
        return this.get(calendar.id).then(instance => instance.onItemCreated(item, options));
      },
      { returnFormat: "jcal" }
    );
    messenger.calendar.provider.onItemUpdated.addListener(
      (calendar, item, oldItem, options) => {
        return this.get(calendar.id).then(instance => instance.onItemUpdated(item, oldItem, options));
      },
      { returnFormat: "jcal" }
    );
    messenger.calendar.provider.onItemRemoved.addListener(
      (calendar, id, options) => {
        return this.get(calendar.id).then(instance => instance.onItemRemoved(id, options));
      },
      { returnFormat: "jcal" }
    );

    messenger.calendar.provider.onInit.addListener(calendar => {
      return this.get(calendar.id).then(instance => instance.onInit());
    });
    messenger.calendar.provider.onSync.addListener(calendar => {
      return this.get(calendar.id).then(instance => instance.onSync());
    });
    messenger.calendar.provider.onResetSync.addListener(calendar => {
      return this.get(calendar.id).then(instance => instance.onResetSync());
    });

    messenger.calendar.provider.onDetectCalendars.addListener(
      (username, password, location, savePassword, extraProperties) => {
        return this.onDetectCalendars(username, password, location, savePassword, extraProperties);
      }
    );
  }

  static async onDetectCalendars(username, password, location, savePassword, extraProperties) {
    let session = sessions.byId(username, true);

    let [
      { value: calendars = [], reason: calendarError },
      { value: tasks = [], reason: tasksError },
    ] = await Promise.allSettled([session.getCalendarList(), session.getTasksList()]);

    if (calendarError) {
      console.warn("Error retrieving calendar list:", calendarError);
    }
    if (tasksError) {
      console.warn("Error retrieving task list:", tasksError);
    }

    calendars = calendars.map(gcal => {
      return {
        name: gcal.summary,
        type: "ext-" + messenger.runtime.id,
        url: `googleapi://${username}/?calendar=${encodeURIComponent(gcal.id)}`,
        capabilities: {
          mutable: gcal.accessRole != "freeBusyReader" && gcal.accessRole != "reader",
        },
        color: gcal.backgroundColor,
      };
    });

    tasks = tasks.map(gcal => {
      return {
        name: gcal.title,
        type: "ext-" + messenger.runtime.id,
        url: `googleapi://${username}/?tasks=${encodeURIComponent(gcal.id)}`,
      };
    });

    return calendars.concat(tasks);
  }

  defaultReminders = [];

  constructor(calendar) {
    this.id = calendar.id;
    this.cacheId = calendar.cacheId;
    this.url = new URL(calendar.url);
    this.session = sessions.byCalendar(this, true);
    this.console = new Console(`calGoogleCalendar(${this.id})`);
  }

  get isDefaultCalendar() {
    return !this.calendarName?.endsWith("@group.calendar.google.com");
  }

  async onInit() {
    let matchpath = this.url.pathname.match(GCAL_PATH_RE);
    if (this.url.protocol == "googleapi:") {
      // new format:  googleapi://session-id/?calendar=calhash@group.calendar.google.com&tasks=taskhash
      this.calendarName = this.url.searchParams.get("calendar");
      this.tasklistName = this.url.searchParams.get("tasks");
      if (!this.calendarName && !this.tasklistName) {
        let urlSession = sessionIdFromUrl(this.url);
        if (isEmail(urlSession)) {
          this.calendarName = urlSession;
          this.tasklistName = this.isDefaultCalendar ? "@default" : null;
        }
      }
    } else if (
      ["http:", "https:", "webcal:", "webcals:"].includes(this.url.protocol) &&
      this.url.host == "www.google.com" &&
      matchpath
    ) {
      this.calendarName = decodeURIComponent(matchpath[2]);
      let googleUserPref = "googleUser." + this.calendarName;
      let prefs = await messenger.storage.local.get({ [googleUserPref]: null });
      let googleUser = prefs[googleUserPref];

      let newUrlParams = new URLSearchParams({ calendar: this.calendarName });
      if (googleUser == this.calendarName) {
        newUrlParams.set("tasks", "@default");
        this.tasklistName = "@default";
      }

      let newUrl = `googleapi://${googleUser || this.calendarName}/?` + newUrlParams;

      this.console.log(`Migrating url format from ${this.url} to ${newUrl}`);
      this.url = new URL(newUrl);
      await messenger.calendar.calendars.update(this.id, { url: this.url });
      this.session = sessions.byCalendar(this, true);
    }

    if (this.calendarName) {
      await messenger.calendar.calendars.update(this.id, {
        capabilities: {
          organizer: this.calendarName,
        },
      });
    }
  }

  createEventsURI(...extraParts) {
    let eventsURI = null;
    if (this.calendarName) {
      let encodedName = encodeURIComponent(this.calendarName);
      let parts = ["calendars", encodedName].concat(extraParts.filter(Boolean));
      eventsURI = API_BASE.EVENTS + parts.join("/");
    }
    return eventsURI;
  }

  createUsersURI(...extraParts) {
    let parts = ["users", "me"].concat(extraParts).map(encodeURIComponent);
    return API_BASE.EVENTS + parts.join("/");
  }

  createTasksURI(...extraParts) {
    let tasksURI = null;
    if (this.tasklistName) {
      let encodedName = encodeURIComponent(this.tasklistName);
      let parts = ["lists", encodedName].concat(extraParts.filter(Boolean));
      tasksURI = API_BASE.TASKS + parts.join("/");
    }
    return tasksURI;
  }

  async getCalendarPref(pref, defaultValue = null) {
    let prefName = `calendars.${this.id}.${pref}`;
    let prefs = await messenger.storage.local.get({ [prefName]: defaultValue });
    return prefs[prefName];
  }
  async setCalendarPref(pref, value) {
    let prefName = `calendars.${this.id}.${pref}`;
    await messenger.storage.local.set({ [prefName]: value });
  }

  // TODO itip/imip

  async onItemCreated(item, options = {}) {
    this.console.log(
      `Adding ${options.offline ? "offline " : ""}${options.invitation ? "invitation" : "regular"} ` +
      `${item.type} ${item.title}`
    );

    let uri;
    let itemData = itemToJson(item, this, options.invitation);

    /* istanbul ignore else - unreachable */
    if (item.type == "event") {
      uri = this.createEventsURI("events", options.invitation && "import");
      let prefs = await messenger.storage.local.get({ "settings.sendEventNotifications": false });
      if (prefs["settings.sendEventNotifications"]) {
        uri += "?sendUpdates=all";
      }
    } else if (item.type == "task") {
      uri = this.createTasksURI("tasks");
      delete itemData.id;
    }

    let request = new calGoogleRequest({
      method: "POST",
      uri,
      json: itemData,
      calendar: this,
    });

    let data = await request.commit(this.session);

    let timeZone = await this.getCalendarPref("timeZone");
    let accessRole = await this.getCalendarPref("accessRole");
    let defaultTimezone = TimezoneService.get(timeZone);

    let newItem = await jsonToItem({
      entry: data,
      calendar: this,
      accessRole,
      defaultTimezone,
      defaultReminders: this.defaultReminders
    });

    if (data.organizer?.self) {
      // We found ourselves, remember the display name
      await messenger.calendar.calendars.update(this.id, {
        capabilities: {
          organizerName: data.organizer.displayName,
        },
      });
    }

    if (newItem) {
      this.console.log(`Adding item ${newItem.id} (${item.title}) succeeded`);
    } else {
      this.console.log(`Adding item ${item.id} (${item.title}) failed`);
    }

    return newItem;
  }

  async onItemUpdated(item, oldItem, options = {}) {
    let uri;

    /* istanbul ignore else - caught in patchItem */
    if (item.type == "event") {
      uri = this.createEventsURI("events", getGoogleId(item));
      let prefs = await messenger.storage.local.get({ "settings.sendEventNotifications": false });
      if (prefs["settings.sendEventNotifications"]) {
        uri += "?sendUpdates=all";
      }
    } else if (item.type == "task") {
      uri = this.createTasksURI("tasks", item.id);
    }

    let itemData = patchItem(item, oldItem);

    let request = new calGoogleRequest({
      method: "PATCH",
      uri,
      json: itemData,
      headers: {
        "If-Match": options.force ? "*" : oldItem.metadata.etag || "*",
      },
      calendar: this,
    });

    let data;

    try {
      data = await request.commit(this.session);
    } catch (e) {
      if (e instanceof ItemError) {
        return { error: e.itemErrorCode };
      }
      throw e;
    }

    let timeZone = await this.getCalendarPref("timeZone");
    let accessRole = await this.getCalendarPref("accessRole");
    let defaultTimezone = TimezoneService.get(timeZone);

    let newItem = await jsonToItem({
      entry: data,
      calendar: this,
      accessRole,
      defaultTimezone,
      defaultReminders: this.defaultReminders,
    });

    // TODO
    //  // Make sure to update the etag. Do so before switching to the
    //  // parent item, as google saves its own etags for changed
    //  // instances.
    //  migrateItemMetadata(this.offlineStorage, aOldItem, item, metaData);
    //
    //  if (item.recurrenceId) {
    //    // If we only modified an exception item, then we need to
    //    // set the parent item and modify the exception.
    //    let modifiedItem = aNewItem.parentItem.clone();
    //    if (item.status == "CANCELLED") {
    //      // Canceled means the occurrence is an EXDATE.
    //      modifiedItem.recurrenceInfo.removeOccurrenceAt(item.recurrenceId);
    //    } else {
    //      // Not canceled means the occurrence was modified.
    //      modifiedItem.recurrenceInfo.modifyException(item, true);
    //    }
    //    item = modifiedItem;
    //  }

    return newItem;
  }

  async onItemRemoved(item, options = {}) {
    let uri;
    if (item.type == "event") {
      uri = this.createEventsURI("events", getGoogleId(item));
      let prefs = await messenger.storage.local.get({ "settings.sendEventNotifications": false });
      if (prefs["settings.sendEventNotifications"]) {
        uri += "?sendUpdates=all";
      }
    } else if (item.type == "task") {
      uri = this.createTasksURI("tasks", item.id);
    } else {
      throw new Error("Unknown item type: " + item.type);
    }

    let request = new calGoogleRequest({
      method: "DELETE",
      uri,
      headers: {
        "If-Match": options.force ? "*" : (item.metadata.etag || "*"),
      },
      calendar: this,
    });

    try {
      await request.commit(this.session);
    } catch (e) {
      if (e instanceof ResourceGoneError) {
        // The item was deleted on the server and locally, no need to notify the user about this.
        return null;
      } else if (e instanceof ItemError) {
        return { error: e.itemErrorCode };
      }
      throw e;
    }

    return null;
  }

  async onResetSync() {
    this.console.log("Resetting last updated counter");
    await this.setCalendarPref("eventSyncToken", null);
    await this.setCalendarPref("tasksLastUpdated", null);

    await messenger.calendar.calendars.clear(this.cacheId);
  }

  async onSync(retry = true) {
    let prefs = await messenger.storage.local.get({
      "settings.idleTime": 300,
      "settings.maxResultsPerRequest": null,
    });

    let idleState = await messenger.idle.queryState(prefs["settings.idleTime"] * 1000);

    if (idleState != "active") {
      this.console.log("Skipping refresh since user is idle");
      return;
    }

    let promises = [];

    if (this.calendarName) {
      promises.push(
        (async () => {
          let request = new calGoogleRequest({
            uri: this.createUsersURI("calendarList", this.calendarName),
            method: "GET",
            calendar: this,
          });
          let data = await request.commit(this.session);
          this.defaultReminders = (data.defaultReminders || []).map(alarm =>
            jsonToAlarm(alarm, true)
          );

          let settings = [
            "accessRole",
            "backgroundColor",
            "description",
            "foregroundColor",
            "location",
            "primary",
            "summary",
            "summaryOverride",
            "timeZone",
          ];

          await Promise.all(
            settings.map(name => this.setCalendarPref(name, data[name]))
          );
          await this.setCalendarPref(
            "defaultReminders",
            JSON.stringify(data.defaultReminders)
          );

          let isReadOnly = data.accessRole == "freeBusyReader" || data.accessRole == "reader";
          await messenger.calendar.calendars.update(this.id, {
            capabilities: {
              mutable: !isReadOnly
            }
          });
        })()
      );

      promises.push(
        (async () => {
          let syncToken = await this.getCalendarPref("eventSyncToken");
          let request = new calGoogleRequest({
            method: "GET",
            uri: this.createEventsURI("events"),
            params: {
              maxResults: prefs["settings.maxResultsPerRequest"],
              eventTypes: ["default", "focusTime", "outOfOffice"],
              showDeleted: syncToken ? "true" : "false",
              syncToken: syncToken,
            },
            calendar: this,
          });

          let saver = new ItemSaver(this);

          await this.session.paginatedRequest(
            request,
            null,
            data => saver.parseItemStream(data),
            async data => {
              await saver.complete();
              /* istanbul ignore else - being on the safe side, there should always be a token */
              if (data.nextSyncToken) {
                this.console.log("New sync token is now " + data.nextSyncToken);
                await this.setCalendarPref("eventSyncToken", data.nextSyncToken);
              }
            }
          );
        })()
      );
    }

    if (this.tasklistName) {
      promises.push(
        (async () => {
          let updatedMin = await this.getCalendarPref("tasksLastUpdated");
          let request = new calGoogleRequest({
            method: "GET",
            uri: this.createTasksURI("tasks"),
            params: {
              maxResults: prefs["settings.maxResultsPerRequest"],
              showDeleted: updatedMin ? "true" : "false",
              showHidden: true,
              showCompleted: true,
              updatedMin: updatedMin,
            },
            calendar: this,
          });

          let saver = new ItemSaver(this);
          let newLastUpdated;

          await this.session.paginatedRequest(
            request,
            data => (newLastUpdated = request.responseDate),
            data => saver.parseItemStream(data),
            async data => {
              await saver.complete();
              this.console.log("Last tasks sync date is now " + newLastUpdated);
              await this.setCalendarPref("tasksLastUpdated", newLastUpdated);
            }
          );
        })()
      );
    }

    try {
      await Promise.all(promises);
      this.session.resetBackoff();
    } catch (e) {
      if (e instanceof QuotaFailureError) {
        this.session.backoff();
      } else if (e instanceof ResourceGoneError) {
        this.console.log("Server did not accept incremental update, resetting");
        await this.onResetSync();
        if (retry) {
          await this.onSync(false);
          return;
        } else {
          console.error("Incremental update failed twice, not trying again");
        }
      }
      throw e;
    }
  }
}
