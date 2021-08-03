import jestFetchMock from "jest-fetch-mock";
jestFetchMock.enableFetchMocks();

import { jest } from "@jest/globals";

import calGoogleRequest from "../../src/background/request";

beforeEach(() => {
  jestFetchMock.doMock();
});

let session = {
  id: "tests@example.com",
  ensureLogin: jest.fn(async () => {}),
  notifyOutdated: jest.fn(),
  notifyQuotaExceeded: jest.fn(),
  invalidate: jest.fn(async () => {}),
};

function mockErrorResponse(status, error) {
  jest.spyOn(global.console, "log").mockImplementation(() => {});
  fetch.mockResponseOnce(JSON.stringify({ error: { errors: [error] } }), {
    status: status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("commit basics", async () => {
  let request = new calGoogleRequest({
    method: "GET",
    uri: "https://localhost/test",
  });

  fetch.mockResponseOnce(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
  let res = await request.commit(session);
  expect(session.ensureLogin).toHaveBeenCalled();
  expect(res).toEqual({});

  request = new calGoogleRequest({
    method: "POST",
    uri: "https://localhost/test",
    params: { undef: null, foo: "bar" },
    json: { foo: "bar" },
  });

  fetch.mockResponseOnce(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
  res = await request.commit(session);
  expect(fetch.mock.calls[fetch.mock.calls.length - 1][1].body).toBe('{"foo":"bar"}');
  expect(fetch).toBeCalledWith(
    new URL("https://localhost/test?foo=bar"),
    expect.objectContaining({
      method: "POST",
      body: '{"foo":"bar"}',
    })
  );
});

test("commit invalid response", async () => {
  let request = new calGoogleRequest({
    method: "POST",
    uri: "https://localhost/test",
    params: { undef: null, foo: "bar" },
    json: { foo: "bar" },
  });

  jest.spyOn(global.console, "error").mockImplementation(() => {});
  fetch.mockResponseOnce("wrong");
  await expect(request.commit(session)).rejects.toThrow("Received plain response: wrong...");
});

test("status code 201", async () => {
  let request = new calGoogleRequest({
    method: "POST",
    uri: "https://localhost/test",
    params: { undef: null, foo: "bar" },
    json: { foo: "bar" },
  });
  fetch.mockResponseOnce(JSON.stringify({ result: 1 }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
  let res = await request.commit(session);
  expect(res).toEqual({ result: 1 });
  expect(request.response.status).toBe(201);
});

test("status code 204", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
    json: { foo: "bar" },
  });
  fetch.mockResponseOnce(null, {
    status: 204,
    headers: { "Content-Length": 0 },
  });
  let res = await request.commit(session);
  expect(res).toEqual({ status: "No Content" });
  expect(request.response.status).toBe(204);
});

test("status code 304", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
    json: { foo: "bar" },
  });
  fetch.mockResponseOnce(null, {
    headers: { "Content-Length": 0 },
    status: 304,
  });
  await expect(request.commit(session)).rejects.toThrow("NOT_MODIFIED");
  expect(request.response.status).toBe(304);
});

test("status code 404", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
  });
  fetch.mockResponseOnce(null, {
    headers: { "Content-Length": 0 },
    status: 404,
  });
  await expect(request.commit(session)).rejects.toThrow("CONFLICT_DELETED");
  expect(request.response.status).toBe(404);
});

test("status code 409", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
  });
  fetch.mockResponseOnce(null, {
    headers: { "Content-Length": 0 },
    status: 409,
  });
  await expect(request.commit(session)).rejects.toThrow("CONFLICT_MODIFY");
  expect(request.response.status).toBe(409);
});

test("status code 410", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
  });
  fetch.mockResponseOnce(null, {
    headers: { "Content-Length": 0 },
    status: 410,
  });
  await expect(request.commit(session)).rejects.toThrow("RESOURCE_GONE");
  expect(request.response.status).toBe(410);
});

test("status code 412", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
  });
  fetch.mockResponseOnce(null, {
    headers: { "Content-Length": 0 },
    status: 412,
  });
  await expect(request.commit(session)).rejects.toThrow("CONFLICT_MODIFY");
  expect(request.response.status).toBe(412);
});

test("status code 400 sync token", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
  });
  mockErrorResponse(400, { message: "Invalid sync token value." });
  await expect(request.commit(session)).rejects.toThrow("RESOURCE_GONE");
  expect(request.response.status).toBe(400);
});

test("status code 400 other", async () => {
  let request = new calGoogleRequest({
    method: "PUT",
    uri: "https://localhost/test",
  });
  mockErrorResponse(400, { message: "tests" });
  await expect(request.commit(session)).rejects.toThrow("NS_ERROR_NOT_AVAILABLE");
  expect(request.response.status).toBe(400);
});

describe("auth error", () => {
  test("401 invalid_client", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    mockErrorResponse(401, { reason: "invalid_client" });
    await expect(request.commit(session)).rejects.toThrow("TOKEN_FAILURE");
    expect(session.notifyOutdated).toHaveBeenCalled();
    expect(request.response.status).toBe(401);
  });

  test("401 unauthorized_client", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    jest.spyOn(global.console, "log").mockImplementation(() => {});
    fetch.mockResponses(
      [
        JSON.stringify({ error: { errors: [{ reason: "unauthorized_client" }] } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ],
      [
        JSON.stringify({ result: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ]
    );
    let res = await request.commit(session);
    expect(request.response.status).toBe(200);
    expect(request.reauthenticate).toBe(false);
    expect(res).toEqual({ result: 1 });
    expect(session.notifyOutdated).not.toHaveBeenCalled();
  });

  test("401 unauthorized_client and outdated", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    jest.spyOn(global.console, "log").mockImplementation(() => {});
    fetch.mockResponses(
      [
        JSON.stringify({ error: { errors: [{ reason: "unauthorized_client" }] } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ],
      [
        JSON.stringify({ error: { errors: [{ reason: "invalid_grant" }] } }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ]
    );
    await expect(request.commit(session)).rejects.toThrow("TOKEN_FAILURE");

    expect(request.response.status).toBe(403);
    expect(request.reauthenticate).toBe(false);
    expect(session.notifyOutdated).toHaveBeenCalled();
  });

  test("403 variableTermLimitExceeded", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    mockErrorResponse(403, { reason: "variableTermLimitExceeded" });
    await expect(request.commit(session)).rejects.toThrow("QUOTA_FAILURE");
    expect(session.notifyQuotaExceeded).toHaveBeenCalled();
    expect(request.response.status).toBe(403);
  });

  test("403 userRateLimitExceeded", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    mockErrorResponse(403, { reason: "userRateLimitExceeded" });
    await expect(request.commit(session)).rejects.toThrow("QUOTA_FAILURE");
    expect(session.notifyQuotaExceeded).toHaveBeenCalled();
    expect(request.response.status).toBe(403);
  });

  test("403 dailyLimitExceeded", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    mockErrorResponse(403, { reason: "dailyLimitExceeded" });
    await expect(request.commit(session)).rejects.toThrow("QUOTA_FAILURE");
    expect(session.notifyQuotaExceeded).toHaveBeenCalled();
    expect(request.response.status).toBe(403);
  });

  test("403 quotaExceeded", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    mockErrorResponse(403, { reason: "quotaExceeded" });
    await expect(request.commit(session)).rejects.toThrow("QUOTA_FAILURE");
    expect(session.notifyQuotaExceeded).toHaveBeenCalled();
    expect(request.response.status).toBe(403);
  });

  test("403 insufficientPermissions GET", async () => {
    let request = new calGoogleRequest({
      method: "GET",
      uri: "https://localhost/test",
    });
    mockErrorResponse(403, { reason: "insufficientPermissions" });
    await expect(request.commit(session)).rejects.toThrow("READ_FAILED");
    expect(request.response.status).toBe(403);
  });

  test("403 insufficientPermissions PUT", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    mockErrorResponse(403, { reason: "insufficientPermissions" });
    await expect(request.commit(session)).rejects.toThrow("MODIFICATION_FAILED");
    expect(request.response.status).toBe(403);
  });

  test("401 authError", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    jest.spyOn(global.console, "log").mockImplementation(() => {});
    fetch.mockResponses(
      [
        JSON.stringify({ error: { errors: [{ reason: "authError" }] } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ],
      [
        JSON.stringify({ result: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ]
    );
    let res = await request.commit(session);
    expect(request.response.status).toBe(200);
    expect(request.reauthenticate).toBe(false);
    expect(res).toEqual({ result: 1 });
    expect(session.invalidate).toHaveBeenCalled();
  });

  test("401 authError and login failed", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    jest.spyOn(global.console, "log").mockImplementation(() => {});
    fetch.mockResponses(
      [
        JSON.stringify({ error: { errors: [{ reason: "authError" }] } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ],
      [
        JSON.stringify({ error: { errors: [{ reason: "invalidCredentials" }] } }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ]
    );
    await expect(request.commit(session)).rejects.toThrow("LOGIN_FAILED");
    expect(request.response.status).toBe(403);
    expect(request.reauthenticate).toBe(false);
    expect(session.invalidate).toHaveBeenCalled();
  });

  test("403 unknown", async () => {
    let request = new calGoogleRequest({
      method: "PUT",
      uri: "https://localhost/test",
    });
    mockErrorResponse(403, { reason: "karma" });
    await expect(request.commit(session)).rejects.toThrow("NS_ERROR_FAILURE");
    expect(request.response.status).toBe(403);
  });
});
