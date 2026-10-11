/* Zotero 7 bootstrap entry point. */
var ReviewStudio;
var reviewStudioChromeHandle;

function install() {}

async function startup({ id, version, rootURI }) {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  const manager = Components.classes[
    '@mozilla.org/addons/addon-manager-startup;1'
  ].getService(Components.interfaces.amIAddonManagerStartup);
  reviewStudioChromeHandle = manager.registerChrome(
    Services.io.newURI(rootURI + 'manifest.json'),
    [['content', 'zoteroreviewstudio', rootURI + 'content/']]
  );
  Services.scriptloader.loadSubScript(rootURI + 'content/plugin.js');
  await ReviewStudio.init({ id, version, rootURI });
}

function onMainWindowLoad({ window }) {
  ReviewStudio?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  ReviewStudio?.removeFromWindow(window);
}

async function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;
  if (ReviewStudio) {
    await ReviewStudio.shutdown();
    ReviewStudio = null;
  }
  if (reviewStudioChromeHandle) {
    reviewStudioChromeHandle.destruct();
    reviewStudioChromeHandle = null;
  }
}

function uninstall() {}
