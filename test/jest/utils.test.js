import {
  isEmail,
  getGoogleId,
  categoriesStringToArray,
  arrayToCategoriesString,
  isTesting,
} from "../../src/background/utils";

test("isEmail", () => {
  expect(isEmail("test@example.com")).toBe(true);
  expect(isEmail("example.com")).toBe(false);
});

test("getGoogleId", () => {
  let item = {
    metadata: null,
    id: "foo@google.com",
  };
  expect(getGoogleId(item)).toBe("foo");

  item = {
    metadata: null,
    id: "@google.com-foo",
  };
  expect(getGoogleId(item)).toBe("@google.com-foo");

  item = {
    metadata: { path: "bar" },
    id: "foo@google.com",
  };
  expect(getGoogleId(item)).toBe("bar");
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
