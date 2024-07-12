/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

/* eslint-disable jest/no-standalone-expect */
export default class FetchMocks {
  requestCount = 0;

  constructor(data) {
    fetch.mockResponse(this.request.bind(this));
    this.data = data;
  }

  async request(req) {
    this.requestCount++;

    let reqdata = this.data[this.requestCount - 1];
    // console.debug(`Checking request ${this.requestCount -1}`, reqdata, req);

    if (!reqdata) {
      throw new Error(`Unhandled Request:\n${req.method} ${req.url}\n\n${await req.text()}`);
    }

    expect(req.url.toString()).toEqual(reqdata.request.url);
    expect(req.method).toEqual(reqdata.request.method);

    let normalizedHeaders = Object.entries((reqdata.request.headers || {})).reduce((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});

    expect(Object.fromEntries(req.headers)).toEqual(expect.objectContaining(normalizedHeaders));

    let body = req.body;
    if (req.body instanceof URLSearchParams) {
      body = Object.fromEntries(req.body.entries());
    } else if (req.headers.get("Content-Type") == "application/json") {
      body = await req.json();
    } else if (req.headers.get("Content-Type") == "application/x-www-form-urlencoded;charset=utf-8") {
      body = Object.fromEntries(new URLSearchParams(await req.text()));
    }

    expect(body).toEqual(reqdata.request.body ?? null);

    return reqdata.response;
  }

  expectFetchCount() {
    expect(this.requestCount).toEqual(this.data.length);
  }
}
/* eslint-enable jest/no-standalone-expect */
