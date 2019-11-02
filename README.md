Provider for Google Calendar
============================

![Build Status](https://github.com/kewisch/gdata-provider/workflows/Provider%20for%20Google%20Calendar/badge.svg)

These are the sources for the [Provider for Google Calendar](https://addons.thunderbird.net/thunderbird/addon/provider-for-google-calendar/).

Development
-----------

The Provider for Google Calendar uses an xpcshell test originally from the Thunderbird test harness.

To run the tests locally you can use this command. Note that the tests use the dist xpi, so you'll need to build first.

```bash
$ npm test
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

Note that the tests will fail if something is up with the Thunderbird test harness, so best
[check treeherder](https://treeherder.mozilla.org/#/jobs?repo=comm-central) first.

This may also affect your pull request checks, as the test are also running via Github Actions CI


Report Issues
-------------
First of all, make sure you are using the version of the Provider for Google Calendar that matches
your Thunderbird. If there is no such version available, please take the next lower release number.

For debugging, please enable calendar.debug.log and calendar.debug.log.verbose in the advanced
config editor (`Options > Advanced > General > Config Editor`) and check the logs in the error console
(`Tools > Error Console`) for what is happening when your error occurs.

Please check the [FAQ](https://github.com/kewisch/gdata-provider/wiki/FAQ) to see if your question may already be answered. If you have a support question, please visit [the support forum](https://groups.google.com/forum/#!forum/provider-for-google-calendar).

If you would like to file a development issue, please use the Github issue tracker.
