/**
 * @jest-environment jsdom
 */

import fs from "fs";
import { jest } from "@jest/globals";
import createMessenger from "./webext-api";
import { main as creationMain, clickAuth, onCreate } from "../../src/content/calendar-creation.js";
import { initMessageListener } from "../../src/background/index.js";
import sessions from "../../src/background/session.js";

const html = fs.readFileSync(
  new URL("../../src/content/calendar-creation.html", import.meta.url),
  "utf-8"
);

function qs(id) {
  return document.querySelector(id);
}

beforeEach(async () => {
  jest.spyOn(global.console, "log").mockImplementation(() => {});
  document.documentElement.innerHTML = html;
  global.messenger = createMessenger();
  await initMessageListener();
});

test("init", async () => {
  sessions.byId("sessionId", true);
  await creationMain();

  let sessionContainer = qs("#gdata-existing-sessions");
  expect(sessionContainer.children.length).toBe(1);

  expect(qs("#gdata-existing-sessions > label").textContent).toBe("sessionId");
  expect(qs("#gdata-existing-sessions > label > input").value).toBe("sessionId");
});

test("auth", async () => {
  await creationMain();
  let session = sessions.byId("sessionId", true);
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
  session.getCalendarList = jest.fn(async () => {
    return [{ id: "id1", summary: "calendar1" }];
  });
  session.getTasksList = jest.fn(async () => {
    return [{ id: "id2", summary: "tasks1" }];
  });

  document.getElementById("gdata-session-name").value = "sessionId";
  await clickAuth();

  expect(qs("#calendar-list").children.length).toBe(1);
  expect(qs("#calendar-list > li > label").textContent).toBe("calendar1");
  expect(qs("#calendar-list > li > label > input").value).toBe("id1");
});

test("create", async () => {
  await creationMain();
  let session = sessions.byId("sessionId", true);
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
  session.getCalendarList = jest.fn(async () => {
    return [{ id: "id1", summary: "calendar1" }];
  });
  session.getTasksList = jest.fn(async () => {
    return [{ id: "id2", summary: "tasks1" }];
  });

  document.getElementById("gdata-session-name").value = "sessionId";
  await clickAuth();

  qs("#calendar-list > li > label > input").checked = true;

  await onCreate({ data: "create" });

  expect(messenger.calendar.calendars.create).toHaveBeenCalledWith({
    name: "calendar1",
    type: "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}",
    url: "googleapi://sessionId/?calendar=id1",
  });
});

test("invalid message", async () => {
  await onCreate({ data: "something else" });
  expect(messenger.calendar.calendars.create).not.toHaveBeenCalled();
});
