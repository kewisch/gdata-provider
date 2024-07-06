/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  ExtensionUtils: { ExtensionError, promiseEvent }
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
var { CalEvent } = ChromeUtils.importESModule("resource:///modules/CalEvent.sys.mjs");
var { CalTodo } = ChromeUtils.importESModule("resource:///modules/CalTodo.sys.mjs");
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

var { default: ICAL } = ChromeUtils.importESModule("resource:///modules/calendar/Ical.sys.mjs");

export function isOwnCalendar(calendar, extension) {
  return calendar.superCalendar.type == "ext-" + extension.id;
}

export function unwrapCalendar(calendar) {
  let unwrapped = calendar.wrappedJSObject;

  if (unwrapped.mUncachedCalendar) {
    unwrapped = unwrapped.mUncachedCalendar.wrappedJSObject;
  }

  return unwrapped;
}

export function getResolvedCalendarById(extension, id) {
  let calendar;
  if (id.endsWith("#cache")) {
    let cached = cal.manager.getCalendarById(id.substring(0, id.length - 6));
    calendar = cached && isOwnCalendar(cached, extension) && cached.wrappedJSObject.mCachedCalendar;
  } else {
    calendar = cal.manager.getCalendarById(id);
  }

  if (!calendar) {
    throw new ExtensionError("Invalid calendar: " + id);
  }
  return calendar;
}

export function getCachedCalendar(calendar) {
  return calendar.wrappedJSObject.mCachedCalendar || calendar;
}

export function isCachedCalendar(id) {
  // TODO make this better
  return id.endsWith("#cache");
}

export function convertCalendar(extension, calendar) {
  if (!calendar) {
    return null;
  }

  let props = {
    id: calendar.id,
    type: calendar.type,
    name: calendar.name,
    url: calendar.uri.spec,
    readOnly: calendar.readOnly,
    enabled: !calendar.getProperty("disabled"),
    color: calendar.getProperty("color") || "#A8C2E1",
  };

  if (isOwnCalendar(calendar, extension)) {
    // TODO find a better way to define the cache id
    props.cacheId = calendar.superCalendar.id + "#cache";
    props.capabilities = unwrapCalendar(calendar.superCalendar).capabilities; // TODO needs deep clone?
  }

  return props;
}

export function propsToItem(props, baseItem) {
  let item;
  if (baseItem) {
    item = baseItem;
  } else if (props.type == "event") {
    item = new CalEvent();
    cal.dtz.setDefaultStartEndHour(item);
  } else if (props.type == "task") {
    item = new CalTodo();
    cal.dtz.setDefaultStartEndHour(item);
  } else {
    throw new ExtensionError("Invalid item type: " + props.type);
  }

  if (props.formats?.use == "ical") {
    item.icalString = props.formats.ical;
  } else if (props.formats?.use == "jcal") {
    try {
      item.icalString = ICAL.stringify(props.formats.jcal);
    } catch (e) {
      let jsonstring;
      try {
        jsonstring = JSON.stringify(props.formats.jcal, null, 2);
      } catch {
        jsonstring = props.formats.jcal;
      }

      throw new ExtensionError("Could not parse jCal: " + e + "\n" + jsonstring);
    }
  } else {
    if (props.id) {
      item.id = props.id;
    }
    if (props.title) {
      item.title = props.title;
    }
    if (props.description) {
      item.setProperty("description", props.description);
    }
    if (props.location) {
      item.setProperty("location", props.location);
    }
    if (props.categories) {
      item.setCategories(props.categories);
    }

    if (props.type == "event") {
      // TODO need to do something about timezone
      if (props.startDate) {
        item.startDate = cal.createDateTime(props.startDate);
      }
      if (props.endDate) {
        item.endDate = cal.createDateTime(props.endDate);
      }
    } else if (props.type == "task") {
      // entryDate, dueDate, completedDate, isCompleted, duration
    }
  }
  return item;
}

export function convertItem(item, options, extension) {
  if (!item) {
    return null;
  }

  let props = {};

  if (item instanceof Ci.calIEvent) {
    props.type = "event";
  } else if (item instanceof Ci.calITodo) {
    props.type = "task";
  }

  props.id = item.id;
  props.calendarId = item.calendar.superCalendar.id;
  props.title = item.title || "";
  props.description = item.getProperty("description") || "";
  props.location = item.getProperty("location") || "";
  props.categories = item.getCategories();

  if (isOwnCalendar(item.calendar, extension)) {
    props.metadata = {};
    let cache = getCachedCalendar(item.calendar);
    try {
      // TODO This is a sync operation. Not great. Can we optimize this?
      props.metadata = JSON.parse(cache.getMetaData(item.id)) ?? {};
    } catch {
      // Ignore json parse errors
    }
  }

  if (options?.returnFormat) {
    props.formats = { use: null };
    let formats = options.returnFormat;
    if (!Array.isArray(formats)) {
      formats = [formats];
    }

    for (let format of formats) {
      switch (format) {
        case "ical":
          props.formats.ical = item.icalString;
          break;
        case "jcal":
          // TODO shortcut when using icaljs backend
          props.formats.jcal = ICAL.parse(item.icalString);
          break;
        default:
          throw new ExtensionError("Invalid format specified: " + format);
      }
    }
  }

  if (props.type == "event") {
    props.startDate = item.startDate.icalString;
    props.endDate = item.endDate.icalString;
  } else if (props.type == "task") {
    // TODO extra properties
  }

  return props;
}

export function convertAlarm(item, alarm) {
  const ALARM_RELATED_MAP = {
    [Ci.calIAlarm.ALARM_RELATED_ABSOLUTE]: "absolute",
    [Ci.calIAlarm.ALARM_RELATED_START]: "start",
    [Ci.calIAlarm.ALARM_RELATED_END]: "end",
  };

  return {
    itemId: item.id,
    action: alarm.action.toLowerCase(),
    date: alarm.alarmDate?.icalString,
    offset: alarm.offset?.icalString,
    related: ALARM_RELATED_MAP[alarm.related],
  };
}

export async function setupE10sBrowser(extension, browser, parent, initOptions={}) {
  browser.setAttribute("type", "content");
  browser.setAttribute("disableglobalhistory", "true");
  browser.setAttribute("messagemanagergroup", "webext-browsers");
  browser.setAttribute("class", "webextension-popup-browser");
  browser.setAttribute("webextension-view-type", "subview");

  browser.setAttribute("initialBrowsingContextGroupId", extension.policy.browsingContextGroupId);
  if (extension.remote) {
    browser.setAttribute("remote", "true");
    browser.setAttribute("remoteType", extension.remoteType);
    browser.setAttribute("maychangeremoteness", "true");
  }

  let readyPromise;
  if (extension.remote) {
    readyPromise = promiseEvent(browser, "XULFrameLoaderCreated");
  } else {
    readyPromise = promiseEvent(browser, "load");
  }

  parent.appendChild(browser);

  if (!extension.remote) {
    // FIXME: bug 1494029 - this code used to rely on the browser binding
    // accessing browser.contentWindow. This is a stopgap to continue doing
    // that, but we should get rid of it in the long term.
    browser.contentwindow; // eslint-disable-line no-unused-expressions
  }

  let sheets = [];
  if (initOptions.browser_style) {
    delete initOptions.browser_style;
    sheets.push("chrome://browser/content/extension.css");
  }
  sheets.push("chrome://browser/content/extension-popup-panel.css");

  const initBrowser = () => {
    ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
    let mm = browser.messageManager;
    mm.loadFrameScript(
      "chrome://extensions/content/ext-browser-content.js",
      false,
      true
    );
    let options = Object.assign({
      allowScriptsToClose: true,
      blockParser: false,
      maxWidth: 800,
      maxHeight: 600,
      stylesheets: sheets
    }, initOptions);
    mm.sendAsyncMessage("Extension:InitBrowser", options);
  };
  browser.addEventListener("DidChangeBrowserRemoteness", initBrowser);

  return readyPromise.then(initBrowser);
}
