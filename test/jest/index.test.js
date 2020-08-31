import { jest } from "@jest/globals";
import { WebExtStorage, WebExtListener } from "./utils";

global.messenger = {
  gdata: {
    getLegacyPrefs: jest.fn(),
    purgeLegacyPrefs: jest.fn(),
  },
  storage: {},
  calendar: {
    calendars: {},
    provider: {
      onItemCreated: new WebExtListener(),
      onItemUpdated: new WebExtListener(),
      onItemRemoved: new WebExtListener(),
      onSync: new WebExtListener(),
      onInit: new WebExtListener(),
      onResetSync: new WebExtListener(),
    },
  },
  runtime: {
    id: "runtimeId",
  },
};

let migrate;

beforeAll(async () => {
  let syms = await import("../../src/background/index");
  migrate = syms.migrate;
});
beforeEach(() => {
  global.messenger.storage.local = new WebExtStorage();
});

test("migrate", async () => {
  messenger.calendar.calendars.query = jest.fn(async () => []);
  messenger.calendar.calendars.create = jest.fn(async () => []);
  messenger.gdata.getLegacyPrefs = jest.fn(async () => ({ prefs: true }));
  messenger.gdata.purgeLegacyPrefs = jest.fn(async () => {});
  jest.spyOn(global.console, "log").mockImplementation(() => {});

  await migrate();

  expect(await messenger.storage.local.get({ prefs: null })).toEqual({ prefs: true });
  expect(messenger.gdata.purgeLegacyPrefs).toHaveBeenCalled();
});

test("migrate no prefs", async () => {
  messenger.calendar.calendars.query = jest.fn(async () => []);
  messenger.calendar.calendars.create = jest.fn(async () => []);
  messenger.gdata.getLegacyPrefs = jest.fn(async () => null);
  messenger.gdata.purgeLegacyPrefs = jest.fn(async () => {});
  jest.spyOn(global.console, "log").mockImplementation(() => {});

  await migrate();

  expect(Object.keys(messenger.storage.local.storage).length).toBe(0);
  expect(messenger.gdata.purgeLegacyPrefs).not.toHaveBeenCalled();
});
