# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
# Portions Copyright (C) Philipp Kewisch, 2019

ROOT_DIR := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))

dist: force
	$(RM) dist/gdata-provider.xpi
	(cd src && zip -9r ../dist/gdata-provider.xpi *)

force: ;

test:
	GITHUB_WORKSPACE=$(ROOT_DIR) \
		GITHUB_REPOSITORY=kewisch/gdata-provider \
		INPUT_CHANNEL=nightly \
		INPUT_LIGHTNING=true \
		INPUT_XPCSHELL=test/xpcshell/xpcshell.ini \
		RUNNER_TEMP=build/tmp \
		RUNNER_TOOL_CACHE=build/cache \
		node node_modules/action-thunderbird-tests/src/loader.js

clean:
	$(RM) -r build/* dist/*


node_modules:
	npm install

lint: node_modules
	node_modules/.bin/eslint .
