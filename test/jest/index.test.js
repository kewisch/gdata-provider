import { jest } from "@jest/globals";
import createMessenger from "./helpers/webext-api.js";
import { migrateLegacyPrefs, initMessageListener } from "../../src/background/index";

beforeEach(() => {
  global.messenger = createMessenger();
});

test("migrateLegacyPrefs", async () => {
  messenger.calendar.calendars.query = jest.fn(async () => []);
  messenger.calendar.calendars.create = jest.fn(async () => []);
  messenger.gdata.getLegacyPrefs = jest.fn(async () => ({ prefs: true }));
  messenger.gdata.purgeLegacyPrefs = jest.fn(async () => {});
  jest.spyOn(global.console, "log").mockImplementation(() => {});

  await migrateLegacyPrefs();

  expect(await messenger.storage.local.get({ prefs: null })).toEqual({ prefs: true });
  expect(messenger.gdata.purgeLegacyPrefs).toHaveBeenCalled();
});

test("migrate no prefs", async () => {
  messenger.calendar.calendars.query = jest.fn(async () => []);
  messenger.calendar.calendars.create = jest.fn(async () => []);
  messenger.gdata.getLegacyPrefs = jest.fn(async () => null);
  messenger.gdata.purgeLegacyPrefs = jest.fn(async () => {});
  jest.spyOn(global.console, "log").mockImplementation(() => {});

  await migrateLegacyPrefs();

  expect(Object.keys(messenger.storage.local.storage).length).toBe(0);
  expect(messenger.gdata.purgeLegacyPrefs).not.toHaveBeenCalled();
});

test("message listener", async () => {
  // Most covered in the content tests
  await initMessageListener();

  expect(await messenger.runtime.sendMessage({ something: "else" })).toBe(null);
});
