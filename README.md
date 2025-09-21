Provider for Google Calendar
============================

[![Build Status](https://github.com/kewisch/gdata-provider/actions/workflows/main.yml/badge.svg)](https://github.com/kewisch/gdata-provider/actions/workflows/main.yml)
[![Coverage Status](https://coveralls.io/repos/github/kewisch/gdata-provider/badge.svg?branch=main)](https://coveralls.io/github/kewisch/gdata-provider?branch=main)

These are the sources for the [Provider for Google Calendar](https://addons.thunderbird.net/thunderbird/addon/provider-for-google-calendar/).

Development
-----------

The Provider for Google Calendar is written as a WebExtension, which means most code is very familiar to (vanilla)
website development with a few additional APIs to call.

Additionally, it uses an experiment API to provider calendaring functionality which hopefully will
become part of Thunderbird. Ideally yo do not have to touch anything in the `src/experiments/` or `src/legacy/`
directory. If you do need to touch `src/experiments/calendar`, then please send a pull request to
https://github.com/thunderbird/webext-experiments in addition.

Test are written with jest and use a custom mock for the WebExtensions API.

```bash
$ npm run test
```

You should also run the linters. This will run eslint and check your commit messages. Please format
your messages according to [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary):

```bash
$ npm run lint
```

You can then run the build step to package the xpi in `dist/gdata-provider.xpi`

```bash
$ npm run build 
```

Translation
-----------

This project uses Weblate for its translations, you can contribute by visiting
https://hosted.weblate.org/engage/provider-for-google-calendar/

Weblate is a continuous localization platform used by over 2,500 libre software projects. Learn more about Weblate at
https://weblate.org/

Report Issues
-------------
First of all, make sure you are the latest version of the Provider for Google Calendar.

For debugging, please enable calendar.debug.log and calendar.debug.log.verbose in the advanced
config editor (`Options > Advanced > General > Config Editor`) and check the logs in the error console
(`Tools > Error Console`) for what is happening when your error occurs.

Please check the [FAQ](https://github.com/kewisch/gdata-provider/wiki/FAQ) to see if your question may already be
answered. If you have a support question, please visit
[the support forum](https://groups.google.com/forum/#!forum/provider-for-google-calendar).

If you are unsure if it is a bug, please use the [discussions](https://github.com/kewisch/gdata-provider/discussions)
first, otherwise you can [file an issue](https://github.com/kewisch/gdata-provider/issues).
