/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
});

function getWXAPI(extension, name, sync = false) {
  function implementation(api) {
    let context = {
      extension,
      active: true,
      unloaded: false,
      callOnClose: () => {},
      logActivity: () => {},
    };
    let impl = api.getAPI(context)[name];

    if (name == "storage") {
      impl.local.get = (...args) => impl.local.callMethodInParentProcess("get", args);
      impl.local.set = (...args) => impl.local.callMethodInParentProcess("set", args);
      impl.local.remove = (...args) => impl.local.callMethodInParentProcess("remove", args);
      impl.local.clear = (...args) => impl.local.callMethodInParentProcess("clear", args);
    }
    return impl;
  }

  if (sync) {
    let api = extension.apiManager.getAPI(name, extension, "addon_parent");
    return implementation(api);
  } else {
    return extension.apiManager.asyncGetAPI(name, extension, "addon_parent").then(api => {
      return implementation(api);
    });
  }
}

var messengerInstance;

export function getMessenger(extension) {
  if (messengerInstance) {
    return messengerInstance;
  }

  if (!extension) {
    extension = lazy.ExtensionParent.GlobalManager.getExtension(
      "{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}"
    );
  }

  messengerInstance = {};
  ChromeUtils.defineLazyGetter(messengerInstance, "i18n", () => getWXAPI(extension, "i18n", true));
  ChromeUtils.defineLazyGetter(messengerInstance, "storage", () =>
    getWXAPI(extension, "storage", true)
  );
  return messengerInstance;
}

/**
 * Monkey patch the function with the name x on obj and overwrite it with func.
 * The first parameter of this function is the original function that can be
 * called at any time.
 *
 * @param obj           The object the function is on.
 * @param name          The string name of the function.
 * @param func          The function to monkey patch with.
 */
export function monkeyPatch(obj, x, func) {
  let old = obj[x];
  obj[x] = function() {
    let parent = old.bind(obj);
    let args = Array.from(arguments);
    args.unshift(parent);
    try {
      return func.apply(obj, args);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };
}
