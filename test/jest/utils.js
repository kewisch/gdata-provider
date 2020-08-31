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
    if (this._listeners.size && this._mockArgs.length) {
      for (let args of this._mockArgs) {
        for (let listener of this._listeners) {
          await listener(...args);
        }
      }
      this._mockArgs = [];
    }
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
    let result = this._calendars.find(calendar => (calendar.id = id));
    return result ? Object.assign({}, result) : null;
  }

  async create(calendar) {
    let clone = Object.assign({}, calendar);
    clone.id = "id" + (this._calendars.length + 1);
    this._calendars.push(clone);
  }

  async remove(id) {
    let idx = this._calendars.findIndex(elem => elem.id == id);
    this._calendars.splice(idx, 1);
  }
}

export class WebExtI18n {
  getMessage(key, ...args) {
    return `${key}[${args.join(",")}]`;
  }
}
