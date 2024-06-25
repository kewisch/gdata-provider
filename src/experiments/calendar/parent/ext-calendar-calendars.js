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

this.calendar_calendars = class extends ExtensionAPI {
  getAPI(context) {
    const {
      unwrapCalendar,
      getResolvedCalendarById,
      isOwnCalendar,
      convertCalendar,
    } = ChromeUtils.importESModule("resource://tb-experiments-calendar/experiments/calendar/ext-calendar-utils.sys.mjs");

    return {
      calendar: {
        calendars: {
          query: async function({ type, url, name, color, readOnly, enabled }) {
            let calendars = cal.manager.getCalendars();

            let pattern = null;
            if (url) {
              try {
                pattern = new MatchPattern(url, { restrictSchemes: false });
              } catch {
                throw new ExtensionError(`Invalid url pattern: ${url}`);
              }
            }

            return calendars
              .filter(calendar => {
                let matches = true;

                if (type && calendar.type != type) {
                  matches = false;
                }

                if (url && !pattern.matches(calendar.uri)) {
                  matches = false;
                }

                if (name && !new MatchGlob(name).matches(calendar.name)) {
                  matches = false;
                }

                if (color && color != calendar.getProperty("color")) {
                  // TODO need to normalize the color, including null to default color
                  matches = false;
                }

                if (enabled != null && calendar.getProperty("disabled") == enabled) {
                  matches = false;
                }

                if (readOnly != null && calendar.readOnly != readOnly) {
                  matches = false;
                }

                return matches;
              })
              .map(calendar => convertCalendar(context.extension, calendar));
          },
          get: async function(id) {
            // TODO find a better way to determine cache id
            if (id.endsWith("#cache")) {
              let calendar = unwrapCalendar(cal.manager.getCalendarById(id.substring(0, id.length - 6)));
              let own = calendar.offlineStorage && isOwnCalendar(calendar, context.extension);
              return own ? convertCalendar(context.extension, calendar.offlineStorage) : null;
            } else {
              let calendar = cal.manager.getCalendarById(id);
              return convertCalendar(context.extension, calendar);
            }
          },
          create: async function(createProperties) {
            let calendar = cal.manager.createCalendar(
              createProperties.type,
              Services.io.newURI(createProperties.url)
            );
            if (!calendar) {
              throw new ExtensionError(`Calendar type ${createProperties.type} is unknown`);
            }

            calendar.name = createProperties.name;
            if (typeof createProperties.color != "undefined") {
              calendar.setProperty("color", createProperties.color);
            }

            cal.manager.registerCalendar(calendar);

            calendar = cal.manager.getCalendarById(calendar.id);
            return convertCalendar(context.extension, calendar);
          },
          update: async function(id, updateProperties) {
            let calendar = cal.manager.getCalendarById(id);
            if (!calendar) {
              throw new ExtensionError(`Invalid calendar id: ${id}`);
            }

            if (updateProperties.capabilities && !isOwnCalendar(calendar, context.extension)) {
              throw new ExtensionError("Cannot update capabilities for foreign calendars");
            }
            if (updateProperties.url && !isOwnCalendar(calendar, context.extension)) {
              throw new ExtensionError("Cannot update url for foreign calendars");
            }

            if (updateProperties.url) {
              calendar.uri = Services.io.newURI(updateProperties.url);
            }

            if (updateProperties.enabled != null) {
              calendar.setProperty("disabled", !updateProperties.enabled);
            }

            for (let prop of ["readOnly", "name", "color"]) {
              if (updateProperties[prop] != null) {
                calendar.setProperty(prop, updateProperties[prop]);
              }
            }

            if (updateProperties.capabilities) {
              // TODO validate capability names
              let unwrappedCalendar = calendar.wrappedJSObject.mUncachedCalendar.wrappedJSObject;
              unwrappedCalendar.capabilities = Object.assign({}, unwrappedCalendar.capabilities, updateProperties.capabilities);
            }

            if (updateProperties.lastError !== undefined) {
              if (updateProperties.lastError === null) {
                calendar.setProperty("currentStatus", Cr.NS_ERROR_FAILURE);
                calendar.setProperty("lastErrorMessage", updateProperties.lastError);
              } else {
                calendar.setProperty("currentStatus", Cr.NS_OK);
                calendar.setProperty("lastErrorMessage", "");
              }
            }
          },
          remove: async function(id) {
            let calendar = cal.manager.getCalendarById(id);
            if (!calendar) {
              throw new ExtensionError(`Invalid calendar id: ${id}`);
            }

            cal.manager.unregisterCalendar(calendar);
          },
          clear: async function(id) {
            if (!id.endsWith("#cache")) {
              throw new ExtensionError("Cannot clear non-cached calendar");
            }

            let offlineStorage = getResolvedCalendarById(context.extension, id);
            let calendar = cal.manager.getCalendarById(id.substring(0, id.length - 6));

            if (!isOwnCalendar(calendar, context.extension)) {
              throw new ExtensionError("Cannot clear foreign calendar");
            }

            await new Promise((resolve, reject) => {
              let listener = {
                onDeleteCalendar(aCalendar, aStatus, aDetail) {
                  if (Components.isSuccessCode(aStatus)) {
                    resolve();
                  } else {
                    reject(aDetail);
                  }
                },
              };
              offlineStorage
                .QueryInterface(Ci.calICalendarProvider)
                .deleteCalendar(offlineStorage, listener);
            });

            calendar.wrappedJSObject.mObservers.notify("onLoad", [calendar]);
          },

          synchronize: function(ids) {
            let calendars = [];
            if (ids) {
              if (!Array.isArray(ids)) {
                ids = [ids];
              }
              for (let id of ids) {
                let calendar = cal.manager.getCalendarById(id);
                if (!calendar) {
                  throw new ExtensionError(`Invalid calendar id: ${id}`);
                }
                calendars.push(calendar);
              }
            } else {
              for (let calendar of cal.manager.getCalendars()) {
                if (calendar.getProperty("calendar-main-in-composite")) {
                  calendars.push(calendar);
                }
              }
            }
            for (let calendar of calendars) {
              if (!calendar.getProperty("disabled") && calendar.canRefresh) {
                calendar.refresh();
              }
            }
          },

          onCreated: new EventManager({
            context,
            name: "calendar.calendars.onCreated",
            register: fire => {
              let observer = {
                QueryInterface: ChromeUtils.generateQI(["calICalendarManagerObserver"]),
                onCalendarRegistered(calendar) {
                  fire.sync(convertCalendar(context.extension, calendar));
                },
                onCalendarUnregistering(calendar) {},
                onCalendarDeleting(calendar) {},
              };

              cal.manager.addObserver(observer);
              return () => {
                cal.manager.removeObserver(observer);
              };
            },
          }).api(),

          onUpdated: new EventManager({
            context,
            name: "calendar.calendars.onUpdated",
            register: fire => {
              let observer = cal.createAdapter(Ci.calIObserver, {
                onPropertyChanged(calendar, name, value, oldValue) {
                  let converted = convertCalendar(context.extension, calendar);
                  switch (name) {
                    case "name":
                    case "color":
                    case "readOnly":
                      fire.sync(converted, { [name]: value });
                      break;
                    case "uri":
                      fire.sync(converted, { url: value?.spec });
                      break;
                    case "disabled":
                      fire.sync(converted, { enabled: !value });
                      break;
                  }
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
            name: "calendar.calendars.onRemoved",
            register: fire => {
              let observer = {
                QueryInterface: ChromeUtils.generateQI(["calICalendarManagerObserver"]),
                onCalendarRegistered(calendar) {},
                onCalendarUnregistering(calendar) {
                  fire.sync(calendar.id);
                },
                onCalendarDeleting(calendar) {},
              };

              cal.manager.addObserver(observer);
              return () => {
                cal.manager.removeObserver(observer);
              };
            },
          }).api(),
        },
      },
    };
  }
};
