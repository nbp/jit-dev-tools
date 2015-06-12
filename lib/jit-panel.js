/* See license.txt for terms of usage */

"use strict";

const self = require("sdk/self");

const { Cu, Ci } = require("chrome");
const { Panel } = require("dev/panel.js");
const { Class } = require("sdk/core/heritage");
const { Tool } = require("dev/toolbox");

const { JitActorFront } = require("./jit-actor.js");
const { viewFor } = require("sdk/view/core");
const { MessageChannel } = require("sdk/messaging");

const { gDevTools } = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});

const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { ActorRegistryFront } = devtools["require"]("devtools/server/actors/actor-registry");

/**
 * This object represents a new {@Toolbox} panel
 */
const JitPanel = Class(
/** @lends JitPanel */
{
  extends: Panel,

  label: "Jit",
  tooltip: "JavaScript Internal Inspector",
  icon: "./icon-16.png",
  url: "./jit-panel.html",
  inMenu: true,

  /**
   * Executed by the framework when an instance of this panel is created.
   * There is one instance of this panel per {@Toolbox}. The panel is
   * instantiated when selected in the toolbox for the first time.
   */
  initialize: function(options) {
    this.clearCompilationList();
  },

 /**
  * Executed by the framework when the panel content iframe is
  * constructed. Allows e.g to connect the backend through
  * `debuggee` object
  */
  setup: function({debuggee}) {
    let frame = viewFor(this);
    let parentWin = frame.ownerDocument.defaultView;

    this.toolbox = getToolbox(parentWin);
    this.debuggee = debuggee;
  },

  /**
   * Executed by the framework when the panel is destroyed.
   */
  dispose: function() {
    this.disconnect();
    this.debuggee = null;
  },

  onReady: function() {
    const { port1, port2 } = new MessageChannel();
    this.content = port1;

    // Listen for messages sent from the panel content.
    this.content.onmessage = this.onContentMessage.bind(this);

    // Start up channels
    this.content.start();
    this.debuggee.start();

    // Pass channels to the panel content scope (myPanelContent.js).
    // The content scope can send messages back to the chrome or
    // directly to the debugger server.
    this.postMessage("initialize", [this.debuggee, port2]);
  },

  onContentMessage: function(event) {
    console.log("onContentMessage", event);

    switch (event.data.type) {
    case "connect":
      this.connect();
      break;
    case "disconnect":
      this.disconnect();
      break;
    case "select-compilation":
      this.selectCompilation(event.data.id | 0);
      break;
    case "remove-compilation":
      this.removeCompilation(event.data.id | 0);
      break;
    case "message":
      console.log("Message from connection.js; " + event.data.msg);
      break;
    }
  },

  /**
   * Connect to our custom {@JitActor} actor.
   */
  connect: function() {
    console.log("Connect to the backend actor; " + this.jitActorHandle);

    let target = this.toolbox.target;
    target.client.listTabs((response) => {

      // The actor might be already registered on the backend.
      let { tabs, selected } = response;
      let tab = tabs[selected];
      if (tab[JitActorFront.prototype.typeName]) {
        console.log("actor already registered, so use it", tab);

        this.attachActor(target, tab);
        return;
      }

      // Register actor.
      this.registerActor(target, response);
    });
  },

  /**
   * Disconnect to our custom {@JitActor} actor.
   */
  disconnect: function() {
    console.log("Disconnect from the backend actor; " + this.jitActorHandle);

    // Unregistration isn't done right, see also:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1146889
    // If an actor is unregistered and then immediately registered
    // there is the following exception:
    // Error: Wrong State: Expected 'detached', but current state is 'attached'
    // It's because the existing actor instance in the server side pool
    // isn't removed during the unregistration process.
    // The user needs to close and open the toolbox to re-establish
    // connection (to ensure clean actor pools).
    if (this.jitActorHandle) {
      this.jitActorHandle.unregister().then(() => {
        console.log("my actor unregistered");
        this.jitActor.detach().then(() => {
          console.log("my actor detached");
          this.content.postMessage(JSON.stringify({ type: "detached" }));
          this.jitActor = null;
        });
      });
      this.jitActorHandle = null;

      this.content.postMessage(JSON.stringify({ type: "unregistered" }));
    }
  },

  registerActor: function(target, response) {
    // The actor is registered as 'tab' actor (an instance created for
    // every browser tab).
    let options = {
      prefix: JitActorFront.prototype.typeName,
      constructor: "JitActor",
      type: { tab: true }
    };

    let actorModuleUrl = self.data.url("../lib/jit-actor.js");

    let registry = target.client.getActor(response["actorRegistryActor"]);
    if (!registry) {
      registry = ActorRegistryFront(target.client, response);
    }

    registry.registerActor(actorModuleUrl, options).then(jitActorHandle => {
      console.log("My actor registered");

      // Remember, so we can unregister the actor later.
      this.jitActorHandle = jitActorHandle;

      // Post message to the panel content.
      this.content.postMessage(JSON.stringify({ type: "registered" }));

      target.client.listTabs(({ tabs, selected }) => {
        console.log("listTabs; " + selected);
        this.attachActor(target, tabs[selected]);
      });
    });
  },

  attachActor: function(target, form) {
    let jitActor = JitActorFront(target.client, form);
    this.jitActor = jitActor;
    jitActor.attach().then(() => {
      console.log("My actor attached");

      this.content.postMessage(JSON.stringify({ type: "attached" }));

      // Finally, execute remote method on the actor!
      /*
      jitActor.hello().then(response => {
        console.log("Response from the actor: " + response.msg, response);

        this.content.postMessage(JSON.stringify({
          type: "message", msg: response.msg
        }));
      });
      */

      jitActor.on("on-ion-compilation", graph => {
        // console.log("Yeah, we compiled: " + graph.scripts[0].displayName);
        var id = this.getNewCompilationId(graph);

        // Post message to the panel content.
        this.content.postMessage(JSON.stringify({
          type: "record-compilation",
          id: id,
          scripts: graph.scripts
        }));
      })
    });
  },

  selectCompilation(id) {
    var magic = -123456789;
    var graph = this._compilationResults[id];
    var msg = {
      type: "compilation-graph",
      id: id,
      scripts: graph.scripts,
      graph: magic
    };
    msg = JSON.stringify(msg);
    msg = msg.replace("" + magic, graph.json);
    this.content.postMessage(msg);
  },

  removeCompilation(id) {
    this._compilationResults[id] = null;
  },

  getNewCompilationId(graph) {
    var id = this._compilationResults.length;
    this._compilationResults.push(graph);
    return id;
  },

  clearCompilationList() {
    this._compilationResults = [];
  }

});

function getToolbox(win) {
  let tab = getCurrentTab(win);
  if (tab) {
    let target = devtools.TargetFactory.forTab(tab);
    return gDevTools.getToolbox(target);
  }
}

function getCurrentTab(win) {
  if (win) {
    let browserDoc = win.top.document;
    let browser = browserDoc.getElementById("content");
    return browser.selectedTab;
  }
}

const myTool = new Tool({
  name: "JitTool",
  panels: {
    jitPanel: JitPanel
  }
});
