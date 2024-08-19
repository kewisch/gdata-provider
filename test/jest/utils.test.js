import {
  isEmail,
  stripFractional,
  addVCalendar,
  getItemPath,
  getItemEtag,
  categoriesStringToArray,
  categoriesArrayToString,
  isTesting,
} from "../../src/background/utils";

import ICAL from "../../src/background/libs/ical.js";

test("isEmail", () => {
  expect(isEmail("test@example.com")).toBe(true);
  expect(isEmail("example.com")).toBe(false);
});

test("stripFractional", () => {
  expect(stripFractional(false)).toBeNull();
  expect(stripFractional("2024-01-01T02:03:04")).toEqual("2024-01-01T02:03:04");
  expect(stripFractional("2024-01-01T02:03:04Z")).toEqual("2024-01-01T02:03:04Z");
  expect(stripFractional("2024-01-01T02:03:04.123")).toEqual("2024-01-01T02:03:04");
  expect(stripFractional("2024-01-01T02:03:04.123Z")).toEqual("2024-01-01T02:03:04Z");
});

test("addVCalendar", () => {
  let vcomp = ["vevent", [], []];
  expect(addVCalendar(vcomp)).toEqual(["vcalendar", expect.anything(), [vcomp]]);

  vcomp = ["vcalendar", [], []];
  expect(addVCalendar(vcomp)).toBe(vcomp);

  expect(() => {
    addVCalendar(null);
  }).toThrow("Invalid base component: undefined");
});

test("getItemPath", () => {
  let item = {
    metadata: null,
    id: "foo@google.com",
    format: "jcal",
    item: ["vevent", [], []]
  };
  expect(getItemPath(item)).toBe("foo");

  item = {
    metadata: null,
    id: "@google.com-foo",
    format: "jcal",
    item: ["vevent", [], []],
  };
  expect(getItemPath(item)).toBe("@google.com-foo");

  item = {
    metadata: { path: "bar" },
    id: "foo@google.com",
    format: "jcal",
    item: ["vevent", [], []],
  };
  expect(getItemPath(item)).toBe("bar");

  item = {
    metadata: null,
    id: "foo@google.com",
    format: "jcal",
    item: ["vevent", [["recurrence-id", {}, "date-time", "2021-01-01T02:03:04"]], []]
  };
  expect(getItemPath(item)).toBe("foo_20210101T020304Z");
});

test("categoriesStringToArray", () => {
  expect(categoriesStringToArray(null)).toEqual([]);
  expect(categoriesStringToArray("")).toEqual([]);
  expect(categoriesStringToArray("foo,bar")).toEqual(["foo", "bar"]);
});

test("categoriesArrayToString", () => {
  expect(categoriesArrayToString([])).toBe(null);
  expect(categoriesArrayToString(["foo", "bar"])).toEqual("foo,bar");
});

test("isTesting", async () => {
  expect(await isTesting()).toBe(true);
});
