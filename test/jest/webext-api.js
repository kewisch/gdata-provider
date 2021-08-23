import { jest } from "@jest/globals";

export class WebExtListener {
  _mockArgs = [];
  _listeners = new Set();

  constructor() {
    this.addListener = jest.fn(this.addListener.bind(this));
    this.removeListener = jest.fn(this.removeListener.bind(this));
  }

  addListener(listener, ...extraArgs) {
    this._listeners.add(listener);
    this.trigger();
  }

  removeListener(listener) {
    this._listeners.delete(listener);
  }

  async trigger() {
    let lastResponse = null;
    if (this._listeners.size && this._mockArgs.length) {
      for (let args of this._mockArgs) {
        for (let listener of this._listeners) {
          lastResponse = await listener(...args);
        }
      }
      this._mockArgs = [];
    }
    return lastResponse;
  }

  mockResponse(...args) {
    this._mockArgs.push(args);
    return this.trigger();
  }
}

export class WebExtStorage {
  storage = {};

  async get(obj) {
    let prefs = {};
    for (let [key, value] of Object.entries(obj)) {
      prefs[key] = this.storage[key] ?? value;
    }
    return prefs;
  }
  async set(obj) {
    for (let [key, value] of Object.entries(obj)) {
      this.storage[key] = value;
    }
  }
}

export class WebExtCalendars {
  _calendars = [];

  constructor(calendars) {
    this._calendars = calendars || [];

    this.query = jest.fn(this.query.bind(this));
    this.get = jest.fn(this.get.bind(this));
    this.create = jest.fn(this.create.bind(this));
    this.remove = jest.fn(this.remove.bind(this));
    this.update = jest.fn(this.update.bind(this));
    this.clear = jest.fn();
  }

  async query(opts) {
    return this._calendars
      .filter(calendar => {
        // Major shortcut here, beware when writing tests
        if (opts.type && calendar.type != opts.type) {
          return false;
        }
        return true;
      })
      .map(calendar => Object.assign({}, calendar));
  }

  async get(id) {
    let result = this._calendars.find(calendar => calendar.id == id);
    return result ? Object.assign({}, result) : null;
  }

  async create(calendar) {
    let clone = Object.assign({}, calendar);
    clone.id = "id" + (this._calendars.length + 1);
    this._calendars.push(clone);
    return clone;
  }

  async update(id, update) {
    let calendar = this._calendars.find(cal => cal.id == id);
    if (!calendar) {
      throw new Error("Could not find calendar");
    }
    Object.assign(calendar, update);
    return calendar;
  }

  async remove(id) {
    let idx = this._calendars.findIndex(elem => elem.id == id);
    this._calendars.splice(idx, 1);
  }
}

export class WebExtCalendarItems {
  constructor() {
    this._calendars = {};

    this.create = jest.fn(this._create.bind(this));
    this.remove = jest.fn(this._remove.bind(this));
    this.get = jest.fn(this.get.bind(this));
  }

  _ensureCalendar(calendarId) {
    if (!(calendarId in this._calendars)) {
      this._calendars[calendarId] = {};
    }
  }

  async _create(calendarId, item) {
    this._ensureCalendar(calendarId);
    this._calendars[calendarId][item.id] = item;
  }

  async _remove(calendarId, id) {
    this._ensureCalendar(calendarId);
    delete this._calendars[calendarId][id];
  }

  async get(calendarId, id) {
    return this._calendars?.[calendarId]?.[id];
  }
}

export default function createMessenger() {
  let messenger = {
    calendar: {
      calendars: new WebExtCalendars(),
      items: new WebExtCalendarItems(),
      provider: {
        onFreeBusy: new WebExtListener(),
        onItemCreated: new WebExtListener(),
        onItemUpdated: new WebExtListener(),
        onItemRemoved: new WebExtListener(),
        onInit: new WebExtListener(),
        onSync: new WebExtListener(),
        onResetSync: new WebExtListener(),
        onDetectCalendars: new WebExtListener(),
      },
    },
    gdata: {
      _token: "token",
      getOAuthToken: jest.fn(async () => {
        return messenger.gdata._token;
      }),

      setOAuthToken: jest.fn(async val => {
        messenger.gdata._token = val;
      }),
    },
    runtime: {
      id: "{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
      onMessage: new WebExtListener(),
      sendMessage: jest.fn(message => {
        return messenger.runtime.onMessage.mockResponse(message, {}, null);
      }),
    },
    i18n: {
      getMessage(key, ...args) {
        return `${key}[${args.join(",")}]`;
      },
      getUILanguage: function() {
        return "klingon";
      },
    },
    storage: {
      local: new WebExtStorage(),
    },
    idle: {
      _idleState: "active",
      queryState: jest.fn(async () => {
        return messenger.idle._idleState;
      }),
    },
    notifications: {
      create: jest.fn(async () => {}),
    },
    webRequest: {
      onBeforeRequest: new WebExtListener(),
    },
    windows: {
      create: jest.fn(async () => {
        return { id: "windowId" };
      }),
      remove: jest.fn(async () => {}),
      onRemoved: new WebExtListener(),
    },
  };
  return messenger;
}
