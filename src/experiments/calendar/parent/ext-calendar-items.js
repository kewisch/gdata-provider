/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  ExtensionCommon: { ExtensionAPI, EventManager }
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var {
  ExtensionUtils: { ExtensionError }
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

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
    } = ChromeUtils.importESModule("resource://tb-experiments-calendar/experiments/calendar/ext-calendar-utils.sys.mjs");

    return {
      calendar: {
        items: {
          query: async function(queryProps) {
            let calendars = [];
            if (typeof queryProps.calendarId == "string") {
              calendars = [getResolvedCalendarById(context.extension, queryProps.calendarId)];
            } else if (Array.isArray(queryProps.calendarId)) {
              calendars = queryProps.calendarId.map(calendarId => getResolvedCalendarById(context.extension, calendarId));
            } else {
              calendars = cal.manager.getCalendars().filter(calendar => !calendar.getProperty("disabled"));
            }


            let calendarItems;
            if (queryProps.id) {
              calendarItems = await Promise.all(calendars.map(calendar => calendar.getItem(queryProps.id)));
            } else {
              calendarItems = await Promise.all(calendars.map(async calendar => {
                let filter = Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
                if (queryProps.type == "event") {
                  filter |= Ci.calICalendar.ITEM_FILTER_TYPE_EVENT;
                } else if (queryProps.type == "task") {
                  filter |= Ci.calICalendar.ITEM_FILTER_TYPE_TODO;
                } else {
                  filter |= Ci.calICalendar.ITEM_FILTER_TYPE_ALL;
                }

                if (queryProps.expand) {
                  filter |= Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES;
                }

                let rangeStart = queryProps.rangeStart ? cal.createDateTime(queryProps.rangeStart) : null;
                let rangeEnd = queryProps.rangeEnd ? cal.createDateTime(queryProps.rangeEnd) : null;

                return calendar.getItemsAsArray(filter, queryProps.limit ?? 0, rangeStart, rangeEnd);
              }));
            }

            return calendarItems.flat().map(item => convertItem(item, queryProps, context.extension));
          },
          get: async function(calendarId, id, options) {
            let calendar = getResolvedCalendarById(context.extension, calendarId);
            let item = await calendar.getItem(id);
            return convertItem(item, options, context.extension);
          },
          create: async function(calendarId, createProperties) {
            let calendar = getResolvedCalendarById(context.extension, calendarId);
            let item = propsToItem(createProperties);
            item.calendar = calendar.superCalendar;

            if (createProperties.metadata && isOwnCalendar(calendar, context.extension)) {
              let cache = getCachedCalendar(calendar);
              cache.setMetaData(item.id, JSON.stringify(createProperties.metadata));
            }

            let createdItem;
            if (isCachedCalendar(calendarId)) {
              createdItem = await calendar.modifyItem(item, null);
            } else {
              createdItem = await calendar.adoptItem(item);
            }

            return convertItem(createdItem, createProperties, context.extension);
          },
          update: async function(calendarId, id, updateProperties) {
            let calendar = getResolvedCalendarById(context.extension, calendarId);

            let oldItem = await calendar.getItem(id);
            if (!oldItem) {
              throw new ExtensionError("Could not find item " + id);
            }
            if (oldItem.isEvent()) {
              updateProperties.type = "event";
            } else if (oldItem.isTodo()) {
              updateProperties.type = "task";
            } else {
              throw new ExtensionError(`Encountered unknown item type for ${calendarId}/${id}`);
            }

            let newItem = propsToItem(updateProperties, oldItem?.clone());
            newItem.calendar = calendar.superCalendar;

            if (updateProperties.metadata && isOwnCalendar(calendar, context.extension)) {
              // TODO merge or replace?
              let cache = getCachedCalendar(calendar);
              cache.setMetaData(newItem.id, JSON.stringify(updateProperties.metadata));
            }

            let modifiedItem = await calendar.modifyItem(newItem, oldItem);
            return convertItem(modifiedItem, updateProperties, context.extension);
          },
          move: async function(fromCalendarId, id, toCalendarId) {
            if (fromCalendarId == toCalendarId) {
              return;
            }

            let fromCalendar = cal.manager.getCalendarById(fromCalendarId);
            let toCalendar = cal.manager.getCalendarById(toCalendarId);
            let item = await fromCalendar.getItem(id);

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

            let item = await calendar.getItem(id);
            if (!item) {
              throw new ExtensionError("Could not find item " + id);
            }
            await calendar.deleteItem(item);
          },

          getCurrent: async function(options) {
            try {
              // This seems risky, could be null depending on remoteness
              let item = context.browsingContext.embedderElement.ownerGlobal.calendarItem;
              return convertItem(item, options, context.extension);
            } catch (e) {
              console.error(e);
              return null;
            }
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

              cal.manager.addCalendarObserver(observer);
              return () => {
                cal.manager.removeCalendarObserver(observer);
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

              cal.manager.addCalendarObserver(observer);
              return () => {
                cal.manager.removeCalendarObserver(observer);
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

              cal.manager.addCalendarObserver(observer);
              return () => {
                cal.manager.removeCalendarObserver(observer);
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
