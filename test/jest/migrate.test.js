import { jest } from "@jest/globals";
import { getMigratableCalendars, migrateCalendars } from "../../src/background/migrate";
import createMessenger from "./webext-api";

beforeEach(() => {
  global.messenger = createMessenger();
});

test("getMigratableCalendars", async () => {
  global.messenger.calendar.calendars._calendars = [
    { id: "id1", type: "ics", url: "https://example.com/feed.ics" },
    {
      id: "id2",
      type: "ics",
      url: "https://calendar.google.com/calendar/ical/user@example.com/private/full.ics",
    },
  ];

  let calendars = await getMigratableCalendars();

  expect(calendars.length).toBe(1);
  expect(calendars[0].url).toBe(
    "https://calendar.google.com/calendar/ical/user@example.com/private/full.ics"
  );
  expect(messenger.calendar.calendars.query).toBeCalledWith({
    type: "ics",
    url: "*://*.google.com/calendar/ical/*",
  });
});

test("migrateCalendars", async () => {
  messenger.calendar.calendars._calendars = [
    { id: "id1", type: "ics", url: "https://example.com/?id=id1" },
    { id: "id2", type: "ics", url: "https://example.com/?id=id2" },
    { id: "id3", type: "ics", url: "https://example.com/?id=id3" },
  ];

  messenger.calendar.calendars.remove = jest.fn(async () => {});
  messenger.calendar.calendars.create = jest.fn(async () => {});

  await migrateCalendars(["id1", "id2", "id3"]);

  expect(messenger.calendar.calendars.get).toHaveBeenCalledTimes(3);
  expect(messenger.calendar.calendars.get).toHaveBeenCalledWith("id1");
  expect(messenger.calendar.calendars.get).toHaveBeenCalledWith("id2");
  expect(messenger.calendar.calendars.get).toHaveBeenCalledWith("id3");

  expect(messenger.calendar.calendars.remove).toHaveBeenCalledTimes(3);
  expect(messenger.calendar.calendars.remove).toHaveBeenCalledWith("id1");
  expect(messenger.calendar.calendars.remove).toHaveBeenCalledWith("id2");
  expect(messenger.calendar.calendars.remove).toHaveBeenCalledWith("id3");

  expect(messenger.calendar.calendars.create).toHaveBeenCalledTimes(3);
  expect(messenger.calendar.calendars.create).toHaveBeenCalledWith({
    type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
    url: "https://example.com/?id=id1",
  });
  expect(messenger.calendar.calendars.create).toHaveBeenCalledWith({
    type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
    url: "https://example.com/?id=id2",
  });
  expect(messenger.calendar.calendars.create).toHaveBeenCalledWith({
    type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
    url: "https://example.com/?id=id3",
  });
});
