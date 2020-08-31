import { jest } from "@jest/globals";
import Console from "../../src/background/log";

test("console", () => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();

  let con = new Console("test");

  con.log("one", "two");
  expect(console.log).toHaveBeenLastCalledWith("[test]", "one", "two");
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();

  con.warn("three", "four");
  expect(console.log).toHaveBeenLastCalledWith("[test]", "one", "two");
  expect(console.warn).toHaveBeenLastCalledWith("[test]", "three", "four");
  expect(console.error).not.toHaveBeenCalled();

  con.error("five", "six");
  expect(console.log).toHaveBeenLastCalledWith("[test]", "one", "two");
  expect(console.warn).toHaveBeenLastCalledWith("[test]", "three", "four");
  expect(console.error).toHaveBeenLastCalledWith("[test]", "five", "six");
});
