/* See license.txt for terms of usage */

"use strict";

/**
 * This object implements two communication channels. One allows sending
 * messages to the current 'debuggee' (RDP server side) and the other
 * can be used to send messages to the chrome scope where the rest
 * of this extension lives, e.g. {@MyPanel} object.
 */
function Connection(win) {
  this.win = win;
  this.doc = win.document;
}

Connection.prototype = {
  // Direct communication channel to 'debuggee' (RDP server side).
  debuggee: null,

  // Communication channel to the chrome scope.
  chrome: null,

  /**
   * Initialization steps.
   */
  initialize: function() {
    // The initialization sequence is based on a message sent
    // from {@MyPanel.onReady}. It passes the channel ports
    // to the Debuggee and Chrome scope.
    return new Promise((resolve, reject) => {
      this.win.addEventListener("message", event => {
        console.log("connection.initialize; ", event);

        this.debuggee = event.ports[0];
        this.chrome = event.ports[1];

        // Register channel event handlers
        this.debuggee.onmessage = this.onDebuggeeMessage.bind(this);
        this.chrome.onmessage = this.onChromeMessage.bind(this);

        resolve(event);
      });
    });
  },

  /**
   * Send message to the chrome scope. It's handled by
   * {@MyPanel.onContentMessage} method.
   */
  sendChromeMessage: function(packet) {
    this.chrome.postMessage(packet);
  },

  /**
   * Send message to the RDP server. It's handled by {@Debuggee}
   * and forwarded to the server implementation in the platform.
   */
  sendDebuggeeMessage: function(packet) {
    return new Promise((resolve, reject) => {
      console.log("connection.sendDebuggeeMessage; packet: ", packet);

      this.debuggee.postMessage(packet);
      this.debuggee.onmessage = function(event) {
        resolve(event);
      };
    });
  },

  /**
   * Handle message coming from the Debuggee (server side).
   */
  onDebuggeeMessage: function(event) {
    console.log("connection.onDebuggeeMessage", event);

    /*var parentNode = this.doc.getElementById("content");
    var item = this.doc.createElement("pre");
    item.textContent = JSON.stringify(event.data, 2, 2);
    parentNode.appendChild(item);*/
  },

  /**
   * Handle message coming from the chrome scope.
   */
  onChromeMessage: function(event) {
    var data = JSON.parse(event.data);
    // console.log("connection.onChromeMessage", data.type);
    switch (data.type) {
      case "record-compilation": {
        var item = graphContent.genScriptInfo(this.doc, data.scripts[0], "script-" + data.id, selectCompilation);
        var scriptInline = this.doc.createElement("div");
        scriptInline.className = "script-inline script-list";
        var list = this.doc.createElement("ul");
        var last = data.scripts[0];
        this.doc.getElementById("compilation-instances-list").appendChild(item);
        break;
      };
      case "compilation-graph": {
        graphContent.displayGraph(data.scripts, data.graph);
        break;
      }
      default: {
        /*
        var parentNode = this.doc.getElementById("graph-view");
        var item = this.doc.createElement("pre");
        item.textContent = JSON.stringify(event.data, 2, 2);
        parentNode.appendChild(item);
        */
        break;
      }
    }
  }
};

// Create and initialize the connection object. The initialization
// is asynchronous and depends on an 'initialization' message
// sent from {@MyPanel}.
var connection = new Connection(window);
connection.initialize().then(event => {
  connection.sendChromeMessage({type: "connect"});

  // Send a message back to the chrome scope. The data is
  // send as JSON packet (string).
  connection.sendChromeMessage({
    type: "message",
    msg: "Hello from the content scope!"
  });
});

// When should we call this function ?!
function onUnregisterActor() {
  connection.sendChromeMessage({type: "disconnect"});
}

var selectedFillValue = "var(--theme-selection-background)";
var getScriptBlockStyle = (function () {
  var style = null;

  function createStyleSheet() {
    if (style)
      return;
    style = document.createElement("style");
    document.head.appendChild(style);
  };

  function createRule(i) {
    style.sheet.insertRule("g.style-script-" + i + " > polygon:nth-child(3) {}", i);
  };

  function styleIndex(classlist) {
    for (var c of classlist) {
      if (c.indexOf("style-script-") == 0) {
        return c.replace("style-script-", "") | 0;
      }
    }
    return 0;
  }

  return function (classlist) {
    var i = styleIndex(classlist);

    createStyleSheet();
    while (style.sheet.cssRules.length <= i)
      createRule(style.sheet.cssRules.length);

    return style.sheet.cssRules[i].style;
  };
})();

var lastInline = null;
function selectInlineScript() {
  // li > div.script-box
  var p = this.parentNode;
  if (lastInline === p)
    return;
  var classname = "";
  if (lastInline) {
    lastInline.classList.remove("script-highlight");
    getScriptBlockStyle(lastInline.classList).fill = "";
  }
  p.classList.add("script-highlight");
  lastInline = p;
  getScriptBlockStyle(lastInline.classList).fill = selectedFillValue;
}

// function used to forward clicks from the list of compilations to request the
// graph, and display it.
var lastSelected = null;
function selectCompilation() {
  // li > div.script-box
  var p = this.parentNode;
  if (lastSelected === p) {
    selectInlineScript.call(this);
    return;
  }
  connection.sendChromeMessage({
    type: "select-compilation",
    id: p.id.replace("script-", "") | 0
  });
  if (lastSelected) {
    lastSelected.classList.remove("script-expand");
    lastSelected.getElementsByTagName("ul")[0].InnerHTML = ""; // Remove all inlined scripts.
  }
  p.classList.add("script-expand");
  lastSelected = p;
  selectInlineScript.call(this);
}

// function used to request the removal on an entry.
function requestRemoval(event) {
  // li > div.script-box > div.close-button
  var p = this.parentNode.parentNode;
  connection.sendChromeMessage({
    type: "remove-compilation",
    id: p.id.replace("script-", "") | 0
  });

  // TODO: We should do some sort of transition before removing the element.

  // Remove the element from the list of compiled scripts.
  p.parentNode.removeChild(p);

  // The close-button is within the script-box which has a handler to request
  // the script to be displayed. To display and transfer the graph of each
  // script, we stop the event propagation.
  event.stopPropagation();
}

var graphContent = {
  scripts: null,
  graph: null,
  mode: "mir",
  numScriptStyle: 0,
  document: this.document,

  initialize: function () {
    this.initialize = function () {};
    document.getElementById("graph-button-mir").onclick = this.update;
    document.getElementById("graph-button-lir").onclick = this.update;
    document.getElementById("graph-button-src").onclick = this.update;
  },

  update: function () {
    if (this !== graphContent) {
      document.getElementById("graph-button-" + graphContent.mode).className = "";
      graphContent.mode = this.id.replace("graph-button-", "");
    }
    document.getElementById("graph-button-" + graphContent.mode).className = "script-expand";
    graphContent.generateContent();
  },

  generateContent: function () {
    var view = document.getElementById("graph-content-box");
    var dot = graphToDot.convert(this.scripts, this.graph, this.mode);
    // console.log(dot);
    var svg = Viz(dot, "svg");
    view.innerHTML = "<center>" + svg + "</center>";
    var nodes = view.getElementsByClassName("node");
    var blocks = [ ];

    lastSelected.getElementsByTagName("ul")[0].innerHTML = "";
    lastSelected.classList.add("style-script-0");
    getScriptBlockStyle(lastSelected.classList).fill = selectedFillValue;
    var styleScriptId = 1;

    var n, b;
    function styleScript(classlist) {
      for (var c of classlist) {
        if (c.indexOf("style-script-") == 0) {
          return c;
        }
      }
      return "no-style-script";
    }

    function recordBlock(item) {
      blocks.push(item);
      n.classList.add(styleScript(item.classList));
    }

    for (var bidx = 0; bidx < this.graph.mir.blocks.length; bidx++) {
      n = nodes["node" + (bidx + 1)];
      b = this.graph.mir.blocks[bidx];

      var item;
      if (!("caller" in b.resumePoint)) {
        recordBlock(lastSelected);
        continue;
      }

      // Find predecessor.
      var bp = b, p;
      do {
        p = bp.predecessors[0];
        item = blocks[p];
        bp = this.graph.mir.blocks[p];
      } while(!("resumePoint" in bp));

      var bc = b.resumePoint.caller;
      if ("caller" in bp.resumePoint) {
        var bpc = bp.resumePoint.caller;

        // The previous block caller is the same as the current block caller.
        // As we have no continuation yet, this can only mean that we are still
        // in the same function.
        if (bc == bpc) {
          recordBlock(item);
          continue;
        }

        // The caller of the previous block caller's is the same as the current
        // one, this means that we exited the previous inlined script.
        p = bpc;
        item = blocks[p];
        bp = this.graph.mir.blocks[p];
        if ("caller" in bp.resumePoint && bc == bp.resumePoint.caller) {
          recordBlock(item);
          continue;
        }
      }

      var caller = blocks[bc];
      item = this.genScriptInfo(this.document, this.scripts[bidx], "", selectInlineScript);
      item.classList.add("style-script-" + styleScriptId);
      caller.getElementsByTagName("ul")[0].appendChild(item);
      recordBlock(item);

      getScriptBlockStyle(item.classList).fill = "";
      styleScriptId += 1;
    }
  },

  displayGraph: function (scripts, graph) {
    this.scripts = scripts;
    this.graph = graph;
    this.initialize();
    this.update();
  },

  genScriptInfo: function (document, script, id, ev) {
    var item = document.createElement("li");
    if (id !== "") {
      item.id = id;
    }
    item.className = "side-menu-widget-item";

    var closeButton = document.createElement("div");
    closeButton.className = "empty-button";
    if (id !== "") {
      closeButton.className = "close-button";
      closeButton.onclick = requestRemoval;
    }

    var scriptBox = document.createElement("div");
    scriptBox.className = "script-box";
    scriptBox.onclick = ev;

    var scriptInfo = document.createElement("div");
    scriptInfo.className = "script-info";

    var spanName = document.createElement("span");
    spanName.appendChild(document.createTextNode(script.displayName));

    var spanLoc = document.createElement("span");
    var loc = script.url.split('/');
    spanLoc.textContent = loc[loc.length - 1] + ":" + script.startLine;

    var scriptInline = document.createElement("div");
    scriptInline.className = "script-inline";

    var scriptList = document.createElement("div");
    scriptList.className = "script-list";

    var ul = document.createElement("ul");

    scriptInfo.appendChild(spanName);
    scriptInfo.appendChild(spanLoc);

    scriptBox.appendChild(closeButton);
    scriptBox.appendChild(scriptInfo);

    scriptList.appendChild(ul);

    scriptInline.appendChild(scriptList);

    item.appendChild(scriptBox);
    item.appendChild(scriptInline);

    return item;
  }
};
