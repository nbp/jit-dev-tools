/* See license.txt for terms of usage */

"use strict";

const { JitDevToolsExtension } = require("./jit-devtools-extension.js");
const { JitPanel } = require("./jit-panel.js");

/**
 * Application entry point. Read MDN to learn more about Add-on SDK:
 * https://developer.mozilla.org/en-US/Add-ons/SDK
 */
function main(options, callbacks) {
  // Initialize extension object (singleton).
  JitDevToolsExtension.initialize(options);
}

function onUnload(reason) {
  JitDevToolsExtension.shutdown(reason);
}

// Exports from this module
exports.main = main;
exports.onUnload = onUnload;
