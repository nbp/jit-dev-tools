/* See license.txt for terms of usage */

"use strict";

const { Cc, Ci, Cu } = require("chrome");
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});

const events = require("sdk/event/core");
let protocol = devtools["require"]("devtools/server/protocol");
let { method, Arg, RetVal, ActorClass, FrontClass, Front, Actor } = protocol;

dump("\n\n\n\n\t\tjit-actor.js is being loaded\n\n\n\n\n");

/**
 * This new type is the type of arguments returned by onIonCompilation
 * argument.  The only difference is that the Debugger.Scripts have to be
 * filtered ahead such that not all properties are accessed.
 *
 * The try catch is needed because this file is imported twice, once by the
 * sdk, where it is used to define the JitFront, and a second time by the
 * actor registery, which load this file on the remote to define the
 * JitActor. Sadly, when the remote is on the same runtime, then we have an
 * issue about the Type which already exists.
 */
try {
  protocol.types.addDictType("compilationgraph", {
    scripts: "json",
    json: "string" // "longstring" does not seems to work well.
  });
} catch (e) {
}

/**
 * A method decorator that ensures the actor is in the expected state before
 * proceeding. If the actor is not in the expected state, the decorated method
 * returns a rejected promise.
 *
 * @param String expectedState
 *        The expected state.
 *
 * @param Function method
 *        The actor method to proceed with when the actor is in the expected
 *        state.
 *
 * @returns Function
 *          The decorated method.
 */
function expectState(expectedState, method) {
  return function(...args) {
    if (this.state !== expectedState) {
      const msg = "Wrong State: Expected '" + expectedState + "', but current "
                + "state is '" + this.state + "'";
      return Promise.reject(new Error(msg));
    }

    return method.apply(this, args);
  };
}


/**
 * The Jit Actor provide an interface over the onIonCompilation hook of the
 * Debugger.  Once initialized and attached, one can watch for IonMonkey
 * compilation results as they happen.
 */
let JitActor = ActorClass({
  typeName: "jitActor",

  events: {
    "on-ion-compilation": {
      type: "onIonCompilation",
      graph: Arg(0, "compilationgraph"),
    },
  },

  get dbg() {
    if (!this._dbg) {
      this._dbg = this.parent.makeDebugger();
    }
    return this._dbg;
  },

  initialize: function(conn, parent) {
    dump("JitActor: initialize\n");
    Actor.prototype.initialize.call(this, conn);

    this.parent = parent;
    this.state = "detached";
    this._dbg = null;
  },

  destroy: function() {
    dump("JitActor: destroy\n");
    if (this.state === "attached") {
      this.detach();
    }

    Actor.prototype.destroy.call(this);
  },

  /**
   * Attach to this actor.
   */
  attach: method(expectState("detached", function() {
    dump("JitActor: attach\n");
    this.dbg.onIonCompilation = this.onIonCompilation.bind(this);
    this.dbg.addDebuggees();
    this.dbg.enabled = true;
    this.state = "attached";
  }), {
    request: {},
    response: {
      type: "attached"
    }
  }),

  /**
   * Detach from this actor.
   */
  detach: method(expectState("attached", function() {
    dump("JitActor: detach\n");
    this.dbg.removeAllDebuggees();
    this.dbg.enabled = false;
    this._dbg = null;
    this.state = "detached";
  }), {
    request: {},
    response: {
      type: "detached"
    }
  }),

  /**
   * A test remote method.
   */
  hello: method(function() {
    dump("JitActor: hello\n");
    let result = {
      msg: "Hello from the backend!"
    };

    return result;
  }, {
    request: {},
    response: RetVal("json"),
  }),

  /**
   * Add onIonCompilation hook to the Debugger.
   */
  onIonCompilation: function(graph) {
    var {scripts, json} = graph;
    dump("JitActor: onIonCompilation hook called \\o/\n");
    events.emit(this, "on-ion-compilation", {
      scripts: scripts.map(this._registerScript),
      json: json
    });
  },

  /**
   * Record each script, and collect the source such that we can find it
   * later, when requested by the interface.
   */
  _registerScript: function(s) {
    // For the moment this function does nothing except getting rid of the
    // Debugger object. We should record this script, and its source.
    return {
      displayName: s.displayName,
      url: s.url,
      startLine: s.startLine,
      lineCount: s.lineCount,
      sourceStart: s.sourceStart,
      sourceLength: s.sourceLength,
    }
  },

});

exports.JitActor = JitActor;

exports.JitActorFront = FrontClass(JitActor, {
  initialize: function(client, form) {
    Front.prototype.initialize.call(this, client, form);

    this.actorID = form[JitActor.prototype.typeName];
    this.manage(this);
  }
});
