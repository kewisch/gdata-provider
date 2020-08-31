/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

export default class Console {
  constructor(name) {
    this.name = name;
  }

  log(...args) {
    console.log(`[${this.name}]`, ...args);
  }
  error(...args) {
    console.error(`[${this.name}]`, ...args);
  }
  warn(...args) {
    console.warn(`[${this.name}]`, ...args);
  }
}
