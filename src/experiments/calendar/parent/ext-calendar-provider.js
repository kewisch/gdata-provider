/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");

var { ExtensionAPI, EventManager } = ExtensionCommon;

class ExtCalendarProvider extends cal.provider.BaseClass {
  QueryInterface = ChromeUtils.generateQI(["calICalendar", "calIChangeLog", "calISchedulingSupport"]);

  static register(extension) {
    let calmgr = cal.getCalendarManager();
    let type = "ext-" + extension.id;

    calmgr.registerCalendarProvider(
      type,
      class extends ExtCalendarProvider {
        constructor() {
          super();
          this.type = type;
          this.extension = extension;
          this.capabilities = extension.manifest.calendar_provider.capabilities || {};
        }
      }
    );
  }
  static unregister(extension) {
    let calmgr = cal.getCalendarManager();
    calmgr.unregisterCalendarProvider("ext-" + extension.id, true);
  }

  constructor() {
    super();
    this.initProviderBase();
  }

  get providerID() {
    return this.extension.id;
  }

  canRefresh = true;

  get id() {
    return super.id;
  }
  set id(val) {
    super.id = val;
    if (this.id && this.uri) {
      this.extension.emit("calendar.provider.onInit", this);
    }
  }
  get uri() {
    return super.uri;
  }
  set uri(val) {
    super.uri = val;
    if (this.id && this.uri) {
      this.extension.emit("calendar.provider.onInit", this);
    }
  }

  setProperty(name, value) {
    if (name === "readOnly" && this.capabilities.mutable === false) {
      return; // prevent change
    }
    super.setProperty(name, value);
  }

  getProperty(name) {
    switch (name) {
      case "cache.supported":
      case "cache.enabled":
      case "cache.always":
        return true;

      case "organizerId":
        if (this.capabilities.organizer) {
          return this.capabilities.organizer;
        }
        break;

      case "readOnly":
        if (this.capabilities.mutable === false) {
          return true;
        }
        break;

      case "capabilities.timezones.floating.supported":
        return !(this.capabilities.timezones?.floating === false);
      case "capabilities.timezones.UTC.supported":
        return !(this.capabilities.timezones?.UTC === false);
      case "capabilities.attachments.supported":
        return !(this.capabilities.attachments === false);
      case "capabilities.priority.supported":
        return !(this.capabilities.priority === false);
      case "capabilities.privacy.supported":
        return !(this.capabilities.privacy === false);
      case "capabilities.privacy.values":
        return Array.isArray(this.capabilities.privacy)
          ? this.capabilities.privacy?.map(val => val.toUpperCase())
          : ["PUBLIC", "CONFIDENTIAL", "PRIVATE"];
      case "capabilities.categories.maxCount":
        return Number.isInteger(this.capabilities.categories?.count)
          && this.capabilities.categories.count >= 0
          ? this.capabilities.categories?.count
          : null;
      case "capabilities.alarms.maxCount":
        return Number.isInteger(this.capabilities.alarms?.count)
          ? this.capabilities.alarms?.count
          : undefined;
      case "capabilities.alarms.actionValues":
        return this.capabilities.alarms?.actions?.map(val => val.toUpperCase()) || ["DISPLAY"];
      case "capabilities.tasks.supported":
        return !(this.capabilities.tasks === false);
      case "capabilities.events.supported":
        return !(this.capabilities.events === false);
      case "capabilities.removeModes":
        return Array.isArray(this.capabilities.remove_modes)
          ? this.capabilities.remove_modes
          : ["unsubscribe"];
      case "requiresNetwork":
        return !(this.capabilities.requires_network === false);
    }

    return super.getProperty(name);
  }

  addItem(aItem, aListener) {
    return this.adoptItem(aItem.clone(), aListener);
  }
  async adoptItem(aItem, aListener) {
    try {
      let items = await this.extension.emit("calendar.provider.onItemCreated", this, aItem);
      let { item, metadata } = items.find(props => props.item) || {};
      if (!item) {
        throw new Components.Exception("Did not receive item from extension", Cr.NS_ERROR_FAILURE);
      }

      if (metadata) {
        this.offlineStorage.setMetaData(item.id, JSON.stringify(metadata));
      }

      if (!item.calendar) {
        item.calendar = this.superCalendar;
      }
      this.observers.notify("onAddItem", [item]);
      this.notifyOperationComplete(
        aListener,
        Cr.NS_OK,
        Ci.calIOperationListener.ADD,
        item.id,
        item
      );
    } catch (e) {
      let code = e.result || Cr.NS_ERROR_FAILURE;
      this.notifyPureOperationComplete(
        aListener,
        code,
        Ci.calIOperationListener.ADD,
        aItem.id,
        e.message
      );
    }
  }

  async modifyItem(aNewItem, aOldItem, aListener) {
    try {
      let items = await this.extension.emit(
        "calendar.provider.onItemUpdated",
        this,
        aNewItem,
        aOldItem
      );
      let { item, metadata } = items.find(props => props.item) || {};
      if (!item) {
        throw new Components.Exception("Did not receive item from extension", Cr.NS_ERROR_FAILURE);
      }

      if (metadata) {
        this.offlineStorage.setMetaData(item.id, JSON.stringify(metadata));
      }

      if (!item.calendar) {
        item.calendar = this.superCalendar;
      }
      this.observers.notify("onModifyItem", [item, aOldItem]);
      this.notifyOperationComplete(
        aListener,
        Cr.NS_OK,
        Ci.calIOperationListener.MODIFY,
        item.id,
        item
      );
    } catch (e) {
      let code = e.result || Cr.NS_ERROR_FAILURE;
      this.notifyPureOperationComplete(
        aListener,
        code,
        Ci.calIOperationListener.MODIFY,
        aNewItem.id,
        e.message
      );
    }
  }

  async deleteItem(aItem, aListener) {
    try {
      let results = await this.extension.emit("calendar.provider.onItemRemoved", this, aItem);
      if (!results.length) {
        throw new Components.Exception(
          "Extension did not consume item deletion",
          Cr.NS_ERROR_FAILURE
        );
      }

      this.observers.notify("onDeleteItem", [aItem]);
      this.notifyOperationComplete(
        aListener,
        Cr.NS_OK,
        Ci.calIOperationListener.DELETE,
        aItem.id,
        aItem
      );
    } catch (e) {
      let code = e.result || Cr.NS_ERROR_FAILURE;
      this.notifyPureOperationComplete(
        aListener,
        code,
        Ci.calIOperationListener.DELETE,
        aItem.id,
        e.message
      );
    }
  }

  getItem(aId, aListener) {
    this.offlineStorage.getItem(...arguments);
  }

  getItems(aFilter, aCount, aRangeStart, aRangeEnd, aListener) {
    this.offlineStorage.getItems(...arguments);
  }

  refresh() {
    this.mObservers.notify("onLoad", [this]);
  }

  resetLog() {
    // TODO may need to make this .finally()
    this.extension.emit("calendar.provider.onResetSync", this).then(() => {
      this.mObservers.notify("onLoad", [this]);
    });
  }

  async replayChangesOn(aListener) {
    this.offlineStorage.startBatch();
    try {
      await this.extension.emit("calendar.provider.onSync", this);
      aListener.onResult({ status: Cr.NS_OK }, null);
    } catch (e) {
      console.error(e);
      aListener.onResult({ status: e.result || Cr.NS_ERROR_FAILURE }, e.message || e);
    } finally {
      this.offlineStorage.endBatch();
    }
  }
}

class ExtFreeBusyProvider {
  QueryInterface = ChromeUtils.generateQI(["calIFreeBusyProvider"]);

  constructor(fire) {
    this.fire = fire;
  }

  async getFreeBusyIntervals(aCalId, aRangeStart, aRangeEnd, aBusyTypes, aListener) {
    try {
      const TYPE_MAP = {
        free: Ci.calIFreeBusyInterval.FREE,
        busy: Ci.calIFreeBusyInterval.BUSY,
        unavailable: Ci.calIFreeBusyInterval.BUSY_UNAVAILABLE,
        tentative: Ci.calIFreeBusyInterval.BUSY_TENTATIVE,
      };
      let attendee = aCalId.replace(/^mailto:/, "");
      let start = aRangeStart.icalString;
      let end = aRangeEnd.icalString;
      let types = ["free", "busy", "unavailable", "tentative"].filter((type, index) => aBusyTypes & 1 << index);
      let results = await this.fire.async({ attendee, start, end, types });
      aListener.onResult({ status: Cr.NS_OK }, results.map(interval =>
        new cal.provider.FreeBusyInterval(aCalId,
                                          TYPE_MAP[interval.type],
                                          cal.createDateTime(interval.start),
                                          cal.createDateTime(interval.end))));
    } catch (e) {
      console.error(e);
      aListener.onResult({ status: e.result || Cr.NS_ERROR_FAILURE }, e.message || e);
    }
  }
}

this.calendar_provider = class extends ExtensionAPI {
  onStartup() {
    if (this.extension.manifest.calendar_provider) {
      this.onManifestEntry("calendar_provider");
    }
  }
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }

    if (this.extension.manifest.calendar_provider) {
      ExtCalendarProvider.unregister(this.extension);
    }

    Cu.unload(this.extension.rootURI.resolve("experiments/calendar/ext-calendar-utils.jsm"));
    Services.obs.notifyObservers(null, "startupcache-invalidate", null);
  }

  onManifestEntry(entryName) {
    if (entryName != "calendar_provider") {
      return;
    }
    let manifest = this.extension.manifest;

    if (!manifest.browser_specific_settings?.gecko?.id && !manifest.applications?.gecko?.id) {
      console.warn(
        "Registering a calendar provider with a temporary id. Calendars created for this provider won't persist restarts"
      );
    }

    // Defer registering the provider until the background page has started. We want the first set
    // of listeners to be connected before we initialize.
    // TODO this works, but if there is an async IIFE then that doesn't have the provider registered
    // yet.
    this.extension.on("background-page-started", () => {
      ExtCalendarProvider.register(this.extension);
    });
  }

  getAPI(context) {
    const {
      propsToItem,
      convertItem,
      convertCalendar,
    } = ChromeUtils.import(this.extension.rootURI.resolve("experiments/calendar/ext-calendar-utils.jsm"));

    return {
      calendar: {
        provider: {
          onItemCreated: new EventManager({
            context,
            name: "calendar.provider.onItemCreated",
            register: (fire, options) => {
              let listener = async (event, calendar, item) => {
                let props = await fire.async(
                  convertCalendar(context.extension, calendar),
                  convertItem(item, options, context.extension)
                );
                if (props?.type) {
                  item = propsToItem(props, item);
                }
                if (!item.id) {
                  item.id = cal.getUUID();
                }
                return { item, metadata: props?.metadata };
              };

              context.extension.on("calendar.provider.onItemCreated", listener);
              return () => {
                context.extension.off("calendar.provider.onItemCreated", listener);
              };
            },
          }).api(),

          onItemUpdated: new EventManager({
            context,
            name: "calendar.provider.onItemUpdated",
            register: (fire, options) => {
              let listener = async (event, calendar, item, oldItem) => {
                let props = await fire.async(
                  convertCalendar(context.extension, calendar),
                  convertItem(item, options, context.extension),
                  convertItem(oldItem, options, context.extension)
                );
                if (props?.type) {
                  item = propsToItem(props, item);
                }
                return { item, metadata: props?.metadata };
              };

              context.extension.on("calendar.provider.onItemUpdated", listener);
              return () => {
                context.extension.off("calendar.provider.onItemUpdated", listener);
              };
            },
          }).api(),

          onItemRemoved: new EventManager({
            context,
            name: "calendar.provider.onItemRemoved",
            register: (fire, options) => {
              let listener = (event, calendar, item) => {
                return fire.async(
                  convertCalendar(context.extension, calendar),
                  convertItem(item, options, context.extension)
                );
              };

              context.extension.on("calendar.provider.onItemRemoved", listener);
              return () => {
                context.extension.off("calendar.provider.onItemRemoved", listener);
              };
            },
          }).api(),

          onInit: new EventManager({
            context,
            name: "calendar.provider.onInit",
            register: fire => {
              let listener = (event, calendar) => {
                return fire.async(convertCalendar(context.extension, calendar));
              };

              context.extension.on("calendar.provider.onInit", listener);
              return () => {
                context.extension.off("calendar.provider.onInit", listener);
              };
            },
          }).api(),

          onSync: new EventManager({
            context,
            name: "calendar.provider.onSync",
            register: fire => {
              let listener = (event, calendar) => {
                return fire.async(convertCalendar(context.extension, calendar));
              };

              context.extension.on("calendar.provider.onSync", listener);
              return () => {
                context.extension.off("calendar.provider.onSync", listener);
              };
            },
          }).api(),

          onResetSync: new EventManager({
            context,
            name: "calendar.provider.onResetSync",
            register: fire => {
              let listener = (event, calendar) => {
                return fire.async(convertCalendar(context.extension, calendar));
              };

              context.extension.on("calendar.provider.onResetSync", listener);
              return () => {
                context.extension.off("calendar.provider.onResetSync", listener);
              };
            },
          }).api(),

          onFreeBusy: new EventManager({
            context,
            name: "calendar.provider.onFreeBusy",
            register: fire => {
              let provider = new ExtFreeBusyProvider(fire);
              cal.getFreeBusyService().addProvider(provider);

              return () => {
                cal.getFreeBusyService().removeProvider(provider);
              };
            },
          }).api(),
        },
      },
    };
  }
};
