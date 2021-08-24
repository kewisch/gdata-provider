import {
  isEmail,
  addVCalendar,
  getGoogleId,
  categoriesStringToArray,
  arrayToCategoriesString,
  isTesting,
} from "../../src/background/utils";

import ICAL from "ical.js";

test("isEmail", () => {
  expect(isEmail("test@example.com")).toBe(true);
  expect(isEmail("example.com")).toBe(false);
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

test("getGoogleId", () => {
  let item = {
    metadata: null,
    id: "foo@google.com",
    formats: {
      jcal: ["vevent", [], []],
    },
  };
  expect(getGoogleId(item)).toBe("foo");

  item = {
    metadata: null,
    id: "@google.com-foo",
    formats: {
      jcal: ["vevent", [], []],
    },
  };
  expect(getGoogleId(item)).toBe("@google.com-foo");

  item = {
    metadata: { path: "bar" },
    id: "foo@google.com",
    formats: {
      jcal: ["vevent", [], []],
    },
  };
  expect(getGoogleId(item)).toBe("bar");

  item = {
    metadata: null,
    id: "foo@google.com",
    formats: {
      jcal: ["vevent", [["recurrence-id", {}, "date-time", "2021-01-01T02:03:04"]], []],
    },
  };
  expect(getGoogleId(item)).toBe("foo_20210101T020304Z");
});

test("categoriesStringToArray", () => {
  expect(categoriesStringToArray(null)).toEqual([]);
  expect(categoriesStringToArray("")).toEqual([]);
  expect(categoriesStringToArray("foo,bar")).toEqual(["foo", "bar"]);
});

test("arrayToCategoriesString", () => {
  expect(arrayToCategoriesString([])).toBe(null);
});

test("isTesting", async () => {
  expect(await isTesting()).toBe(true);
});
