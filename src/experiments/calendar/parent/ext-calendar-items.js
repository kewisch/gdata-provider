/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { ExtensionUtils } = ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");
var { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
var { PromiseUtils } = ChromeUtils.import("resource://gre/modules/PromiseUtils.jsm");

var { ExtensionAPI, EventManager } = ExtensionCommon;
var { ExtensionError } = ExtensionUtils;

this.calendar_items = class extends ExtensionAPI {
  getAPI(context) {
    const {
      getResolvedCalendarById,
      getCachedCalendar,
      isCachedCalendar,
      isOwnCalendar,
      propsToItem,
      convertItem,
      convertAlarm,
    } = ChromeUtils.import(this.extension.rootURI.resolve("experiments/calendar/ext-calendar-utils.jsm"));

    return {
      calendar: {
        items: {
          get: async function(calendarId, id, options) {
            let calendar = getResolvedCalendarById(context.extension, calendarId);

            // TODO for some reason using promisifyCalendar directly causes an error
            // "proxy must report the same value for the non-writable, non-configurable property"
            // Patch Lightning to proxy an empty object instead. https://github.com/azu/proxy-frozen-object
            // let pcal = cal.async.promisifyCalendar(calendar.wrappedJSObject);
            // let [item] = await pcal.getItem(id);
            let deferred = PromiseUtils.defer();
            let listener = cal.async.promiseOperationListener(deferred);
            calendar.getItem(id, listener);
            let [item] = await deferred.promise;

            return convertItem(item, options, context.extension);
          },
          create: async function(calendarId, createProperties) {
            let calendar = getResolvedCalendarById(context.extension, calendarId);
            let pcal = cal.async.promisifyCalendar(calendar);
            let item = propsToItem(createProperties);
            item.calendar = calendar.superCalendar;

            if (createProperties.metadata && isOwnCalendar(calendar, context.extension)) {
              let cache = getCachedCalendar(calendar);
              cache.setMetaData(item.id, JSON.stringify(createProperties.metadata));
            }

            let createdItem;
            if (isCachedCalendar(calendarId)) {
              createdItem = await pcal.modifyItem(item, null);
            } else {
              createdItem = await pcal.adoptItem(item);
            }

            return convertItem(createdItem, createProperties, context.extension);
          },
          update: async function(calendarId, id, updateProperties) {
            let calendar = getResolvedCalendarById(context.extension, calendarId);
            let pcal = cal.async.promisifyCalendar(calendar);

            let [oldItem] = await pcal.getItem(id);
            if (!oldItem) {
              throw new ExtensionError("Could not find item " + id);
            }
            if (oldItem instanceof Ci.calIEvent) {
              updateProperties.type = "event";
            } else if (oldItem instanceof Ci.calITodo) {
              updateProperties.type = "todo";
            }
            let newItem = propsToItem(updateProperties, oldItem?.clone());
            newItem.calendar = calendar.superCalendar;

            if (updateProperties.metadata && isOwnCalendar(calendar, context.extension)) {
              // TODO merge or replace?
              let cache = getCachedCalendar(calendar);
              cache.setMetaData(newItem.id, JSON.stringify(updateProperties.metadata));
            }

            let modifiedItem = await pcal.modifyItem(newItem, oldItem);
            return convertItem(modifiedItem, updateProperties, context.extension);
          },
          move: async function(fromCalendarId, id, toCalendarId) {
            if (fromCalendarId == toCalendarId) {
              return;
            }

            let calmgr = cal.getCalendarManager();
            let fromCalendar = cal.async.promisifyCalendar(calmgr.getCalendarById(fromCalendarId));
            let toCalendar = cal.async.promisifyCalendar(calmgr.getCalendarById(toCalendarId));
            let [item] = await fromCalendar.getItem(id);

            if (!item) {
              throw new ExtensionError("Could not find item " + id);
            }

            if (isOwnCalendar(toCalendar, context.extension) && isOwnCalendar(fromCalendar, context.extension)) {
              // TODO doing this first, the item may not be in the db and it will fail. Doing this
              // after addItem, the metadata will not be available for the onCreated listener
              let fromCache = getCachedCalendar(fromCalendar);
              let toCache = getCachedCalendar(toCalendar);
              toCache.setMetaData(item.id, fromCache.getMetaData(item.id));
            }
            await toCalendar.addItem(item);
            await fromCalendar.deleteItem(item);
          },
          remove: async function(calendarId, id) {
            let calendar = getResolvedCalendarById(context.extension, calendarId);
            let pcal = cal.async.promisifyCalendar(calendar);

            let [item] = await pcal.getItem(id);
            if (!item) {
              throw new ExtensionError("Could not find item " + id);
            }
            await pcal.deleteItem(item);
          },

          onCreated: new EventManager({
            context,
            name: "calendar.items.onCreated",
            register: (fire, options) => {
              let observer = cal.createAdapter(Ci.calIObserver, {
                onAddItem: item => {
                  fire.sync(convertItem(item, options, context.extension));
                },
              });

              cal.getCalendarManager().addCalendarObserver(observer);
              return () => {
                cal.getCalendarManager().removeCalendarObserver(observer);
              };
            },
          }).api(),

          onUpdated: new EventManager({
            context,
            name: "calendar.items.onUpdated",
            register: (fire, options) => {
              let observer = cal.createAdapter(Ci.calIObserver, {
                onModifyItem: (newItem, oldItem) => {
                  // TODO calculate changeInfo
                  let changeInfo = {};
                  fire.sync(convertItem(newItem, options, context.extension), changeInfo);
                },
              });

              cal.getCalendarManager().addCalendarObserver(observer);
              return () => {
                cal.getCalendarManager().removeCalendarObserver(observer);
              };
            },
          }).api(),

          onRemoved: new EventManager({
            context,
            name: "calendar.items.onRemoved",
            register: fire => {
              let observer = cal.createAdapter(Ci.calIObserver, {
                onDeleteItem: item => {
                  fire.sync(item.calendar.id, item.id);
                },
              });

              cal.getCalendarManager().addCalendarObserver(observer);
              return () => {
                cal.getCalendarManager().removeCalendarObserver(observer);
              };
            },
          }).api(),

          onAlarm: new EventManager({
            context,
            name: "calendar.items.onAlarm",
            register: (fire, options) => {
              let observer = {
                QueryInterface: ChromeUtils.generateQI(["calIAlarmServiceObserver"]),
                onAlarm(item, alarm) {
                  fire.sync(convertItem(item, options, context.extension), convertAlarm(item, alarm));
                },
                onRemoveAlarmsByItem(item) {},
                onRemoveAlarmsByCalendar(calendar) {},
                onAlarmsLoaded(calendar) {},
              };

              let alarmsvc = Cc["@mozilla.org/calendar/alarm-service;1"].getService(
                Ci.calIAlarmService
              );

              alarmsvc.addObserver(observer);
              return () => {
                alarmsvc.removeObserver(observer);
              };
            },
          }).api(),
        },
      },
    };
  }
};
