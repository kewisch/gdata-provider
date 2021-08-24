/**
 * @jest-environment jsdom
 */

import fs from "fs";
import { jest } from "@jest/globals";
import createMessenger from "./webext-api";
import jestDom from "@testing-library/jest-dom";
import {
  main as migrateMain,
  clickAccept,
  clickCancel,
} from "../../src/content/migration-wizard.js";

const html = fs.readFileSync(
  new URL("../../src/content/migration-wizard.html", import.meta.url),
  "utf-8"
);

function qs(id) {
  return document.querySelector(id);
}
async function getStoragePref(name, defaultValue = null) {
  let prefs = await messenger.storage.local.get({ [name]: defaultValue });
  return prefs[name];
}

beforeEach(async () => {
  document.documentElement.innerHTML = html;
  jest.spyOn(window, "close").mockImplementation(() => {});

  global.messenger = createMessenger();
  global.messenger.calendar.calendars._calendars = [
    {
      id: "id1",
      type: "ics",
      name: "user@example.com",
      color: "#FFFFFF",
      url: "https://calendar.google.com/calendar/ical/user@example.com/private/full.ics",
    },
  ];
});

test("init", async () => {
  expect(qs("#gdata-migration-description")?.textContent).toBe("");
  expect(await getStoragePref("settings.migrate")).toBe(null);

  await migrateMain();

  let accept = qs("#accept");
  let cancel = qs("#cancel");

  expect(document.title).toEqual("gdata.migration.title[]");
  expect(qs("#gdata-migration-description")).toHaveTextContent("gdata.migration.description[]");
  expect(accept).toHaveTextContent("gdata.migration.upgrade.label[]");
  expect(accept).toHaveAttribute("accesskey", "gdata.migration.upgrade.accesskey[]");

  expect(cancel).toHaveTextContent("gdata.migration.cancel.label[]");
  expect(cancel).toHaveAttribute("accesskey", "gdata.migration.cancel.accesskey[]");

  expect(qs("#always-check-label")).toHaveTextContent("gdata.migration.showagain.label[]");
  expect(qs("#calendar-listbox").children.length).toBe(1);
  expect(qs("#calendar-listbox > .calendar-listbox-item > input")).toHaveAttribute("value", "id1");
  expect(qs("#calendar-listbox > .calendar-listbox-item").lastChild.nodeValue).toBe(
    "user@example.com"
  );
  expect(qs("#calendar-listbox > .calendar-listbox-item > .colordot").style.backgroundColor).toBe(
    "rgb(255, 255, 255)"
  );

  expect(await getStoragePref("settings.migrate")).toBe(null);
  expect(qs("#always-check")).toBeChecked();
});

test("cancel migrate true", async () => {
  let alwaysCheck = qs("#always-check");
  let cancel = qs("#cancel");

  expect(await getStoragePref("settings.migrate")).toBe(null);

  await migrateMain();
  await clickCancel();

  expect(window.close).toHaveBeenCalledTimes(1);
  expect(await getStoragePref("settings.migrate")).toBe(true);
});

test("cancel migrate false", async () => {
  let alwaysCheck = qs("#always-check");
  let cancel = qs("#cancel");

  expect(await getStoragePref("settings.migrate")).toBe(null);

  await migrateMain();
  alwaysCheck.click();
  await clickCancel();

  expect(window.close).toHaveBeenCalledTimes(1);
  expect(await getStoragePref("settings.migrate")).toBe(false);
});

test("accept no calendars", async () => {
  let accept = qs("#accept");

  expect(await getStoragePref("settings.migrate")).toBe(null);

  await migrateMain();
  await clickAccept();

  expect(window.close).toHaveBeenCalledTimes(1);
  expect(messenger.calendar.calendars.create).toHaveBeenCalledTimes(0);
  expect(messenger.calendar.calendars.remove).toHaveBeenCalledTimes(0);

  expect(await getStoragePref("settings.migrate")).toBe(true);
});

test("accept with calendars", async () => {
  let accept = qs("#accept");

  expect(await getStoragePref("settings.migrate")).toBe(null);

  await migrateMain();
  qs("#calendar-listbox input").click();
  await clickAccept();

  expect(window.close).toHaveBeenCalledTimes(1);
  expect(messenger.calendar.calendars.create).toHaveBeenCalledTimes(1);
  expect(messenger.calendar.calendars.create).toHaveBeenCalledWith({
    color: "#FFFFFF",
    type: "ext-" + messenger.runtime.id,
    name: "user@example.com",
    url: "https://calendar.google.com/calendar/ical/user@example.com/private/full.ics",
  });

  expect(messenger.calendar.calendars.remove).toHaveBeenCalledTimes(1);
  expect(messenger.calendar.calendars.remove).toHaveBeenCalledWith("id1");

  expect(await getStoragePref("settings.migrate")).toBe(true);
});
