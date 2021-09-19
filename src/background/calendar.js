/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import sessions from "./session.js";
import calGoogleRequest from "./request.js";
import Console from "./log.js";

import { getGoogleId, sessionIdFromUrl, GCAL_PATH_RE, API_BASE } from "./utils.js";
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
      (calendar, item) => {
        return this.get(calendar.id).then(instance => instance.onItemCreated(item));
      },
      { returnFormat: "jcal" }
    );
    messenger.calendar.provider.onItemUpdated.addListener(
      (calendar, item, oldItem) => {
        return this.get(calendar.id).then(instance => instance.onItemUpdated(item, oldItem));
      },
      { returnFormat: "jcal" }
    );
    messenger.calendar.provider.onItemRemoved.addListener((calendar, id) => {
      return this.get(calendar.id).then(instance => instance.onItemRemoved(id));
    });

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
      this.console.warn("Error retrieving calendar list:", calendarError);
    }
    if (tasksError) {
      this.console.warn("Error retrieving task list:", tasksError);
    }

    calendars = calendars.map(gcal => {
      return {
        name: gcal.summary,
        type: "ext-" + messenger.runtime.id,
        url: `googleapi://${username}/?calendar=${encodeURIComponent(gcal.id)}`,
        readOnly: gcal.accessRole == "freeBusyReader" || gcal.accessRole == "reader",
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
        // TODO this could be a random id and it will fail
        this.calendarName = sessionIdFromUrl(this.url);
        this.tasklistName = this.isDefaultCalendar ? "@default" : null;
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

  async getUpdatedMin() {
    let updatedMin;
    let lastUpdated = await this.getCalendarPref("tasksLastUpdated");
    if (lastUpdated) {
      updatedMin = new Date(lastUpdated);
      let lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);

      if (updatedMin <= lastWeek) {
        this.console.log("Last updated time for tasks is more than a week ago, doing full sync");
        // TODO a calendar that is both tasks and calendars may fail if both RESOURCE_GONE and no
        // updated min. calendars would be cleared twice.
        await messenger.calendar.calendars.clear(this.cacheId);
        updatedMin = null;
      }
    }
    return updatedMin;
  }

  // TODO throttle requests
  // TODO itip/imip

  async onItemCreated(item) {
    // TODO start
    // Now this sucks...both invitations and the offline cache send over
    // items with the id set, but we have no way to figure out which is
    // happening just by inspecting the item. Adding offline items should
    // not be an import, but invitations should.
    // let isImport = aItem.id && (aItem.id == "xpcshell-import" || stackContains("calItipUtils.jsm"));
    // TODO end
    let isImport = false;

    let itemData = itemToJson(item, this, isImport);

    let uri;
    this.console.log(`Adding ${isImport ? "invitation" : "regular"} ${item.type} ${item.title}`);

    /* istanbul ignore else - unreachable */
    if (item.type == "event") {
      uri = this.createEventsURI("events", isImport && "import");
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
    });

    let data = await request.commit(this.session);

    let newItem = await jsonToItem(
      data,
      this,
      this.defaultReminders,
      null,
      /* TODO metaData */ null
    );

    if (data.organizer?.self) {
      // We found ourselves, remember the display name
      await messenger.calendar.calendars.update(this.id, {
        capabilities: {
          organizerName: data.organizer.displayName,
        },
      });
    }

    this.console.log(`Adding ${item.title} succeeded`);

    return newItem;
  }

  async onItemUpdated(item, oldItem) {
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
        "If-Match": (oldItem || item).metadata.etag || "*",
      },
    });

    // TODO resolve conflicts

    let data = await request.commit(this.session);

    let newItem = await jsonToItem(
      data,
      this,
      this.defaultReminders,
      item,
      /* TODO metaData */ null
    );

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

  async onItemRemoved(item) {
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
        "If-Match": item.metadata.etag || "*",
      },
    });

    await request.commit(this.session);
    // TODO resolve conflict and try/catch
  }

  async onResetSync() {
    this.console.log("Resetting last updated counter");
    await this.setCalendarPref("eventsSyncToken", null);
    await this.setCalendarPref("tasksLastUpdated", null);
    // TODO reset throttle

    await messenger.calendar.calendars.clear(this.cacheId);
  }

  async onSync(retry = true) {
    let prefs = await messenger.storage.local.get({
      "settings.idleTime": 300,
      "settings.maxResultsPerRequest": null,
    });

    let idleState = await messenger.idle.queryState(prefs["settings.idleTime"] * 1000);

    if (idleState != "active") {
      console.log("Skipping refresh since user is idle");
      return;
    }

    let promises = [];

    if (this.calendarName) {
      // TODO checkThrottle
      promises.push(
        (async () => {
          let request = new calGoogleRequest({
            uri: this.createUsersURI("calendarList", this.calendarName),
            method: "GET",
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
            settings.map(name => this.setCalendarPref("settings." + name, data[name]))
          );
          await this.setCalendarPref(
            "settings.defaultReminders",
            JSON.stringify(data.defaultReminders)
          );

          if (data.accessRole == "freeBusyReader" || data.accessRole == "reader") {
            await messenger.calendar.calendars.update(this.id, { readOnly: true });
          }
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
              showDeleted: syncToken ? "true" : "false",
              syncToken: syncToken,
            },
          });

          let saver = new ItemSaver(this);

          // TODO checkThrottle("events");
          await this.session.paginatedRequest(
            request,
            null,
            data => saver.parseItemStream(data),
            async data => {
              await saver.complete();
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
          let updatedMin = await this.getUpdatedMin();
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
          });

          let saver = new ItemSaver(this);
          let newLastUpdated;

          // TODO checkThrottle("events");
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
      let res = await Promise.all(promises);
    } catch (e) {
      if (e.message == "RESOURCE_GONE") {
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
