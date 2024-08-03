import TimezoneService from "../../src/background/timezone.js";
import createMessenger from "./helpers/webext-api.js";
import ICAL from "../../src/background/libs/ical.js";

beforeEach(() => {
  global.messenger = createMessenger();
});

test("service", () => {
  expect(TimezoneService.get("UTC")).toBeNull();
  TimezoneService.init();
  expect(TimezoneService.get("UTC")).toBe(ICAL.Timezone.utcTimezone);
  expect(TimezoneService.get("Z")).toBe(ICAL.Timezone.utcTimezone);

  expect(TimezoneService.get("Europe/Berlin")).toBeInstanceOf(ICAL.Timezone);
});
