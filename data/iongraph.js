function assert(b) {
  if (!b)
    throw "Assertion failed!";
}

var graphToDot = {};
graphToDot.Node = function(name) {
  this.props = {};
  this.name = name;
};

graphToDot.Edge = function(from, to) {
  this.props = {};
  this.from = from;
  this.to = to;
};

graphToDot.Graph = function(name, type) {
  this.props = {};
  this.name = name;
  this.type = "" + type;
  this.nodes = [];
  this.edges = [];
};

graphToDot.Graph.prototype.addNode = function (n) {
  assert(n instanceof graphToDot.Node);
  this.nodes.push(n);
}

graphToDot.Graph.prototype.addEdge = function (e) {
  assert(e instanceof graphToDot.Edge);
  this.edges.push(e);
}

graphToDot.Node.prototype.write = function () {
  var i;
  var props = `[${[`${i}=${this.props[i]}` for (i in this.props)].join(",")}]`;
  return ` "${this.name}" ${props == "[]" ? "" : props};`;
}

graphToDot.Edge.prototype.write = function () {
  var i;
  var props = `[${[`${i}=${this.props[i]}` for (i in this.props)].join(",")}]`;
  return `  "${this.from}" -> "${this.to}"  ${props == "[]" ? "" : props};`;
}

graphToDot.Graph.prototype.write = function () {
  var i;
  return `digraph ${this.name} {
${[`  ${i}=${this.props[i]};` for (i in this.props)].join("\n")}

${[n.write() for (n of this.nodes)].join("\n")}

${[e.write() for (e of this.edges)].join("\n")}
}`;
}

const htmlMap = {
  "&": "&amp;",
  '"': "&quot;",
  '<': "&lt;",
  '>': "&gt;",
};
graphToDot.convertText = function (text) {
  return text.replace(/[<&>"]/g, match => {
    // return "#" + match.charCodeAt(0).toString(16).toUpperCase();
    return htmlMap[match];
  });
}


graphToDot.convertResumePoint = function (rp, mode) {
  if (!rp)
    return "";
  if (mode && mode != rp.mode)
    return "";
  return `
  <tr>
    ${"caller" in rp ? `<td align="left">&#40;&#40;${rp.caller}&#41;&#41;</td>` : `<td align="left"></td>`}
    <td align="left">
      <font color="grey50">resumepoint ${rp.operands.join(" ")}
      </font>
    </td>
    <td></td>
  </tr>`;
}

graphToDot.convertInstruction = function (ins) {
  return `
  ${graphToDot.convertResumePoint(ins.resumePoint, "At")}
  <tr>
    <td align="left" port="i${ins.id}">${ins.id}</td>
    <td align="left">
      ${(() => {
        var r = graphToDot.convertText(ins.opcode);
        if (ins.attributes) {
          if (ins.attributes.indexOf("RecoveredOnBailout") != -1)
            r = `<font color="gray50">${r}</font>`;
          else if (ins.attributes.indexOf("Movable") != -1)
            r = `<font color="blue">${r}</font>`;
          if (ins.attributes.indexOf("NeverHoisted") != -1)
            r = `<u>${r}</u>`;
        }
        return r;
      })()}
    </td>
    <td  align="right">${ins.type && ins.type != "None" ? graphToDot.convertText(ins.type) : ""}</td>
  </tr>
  ${!ins.memInputs || !ins.memInputs.length ? "" : `
  <tr>
    <td align="left"></td>
    <td align="left"><font color="grey50">memory ${ins.memInputs.join(" ")}</font></td>
    <td></td>
  </tr>`}
  ${graphToDot.convertResumePoint(ins.resumePoint, "After")}
`;
}

graphToDot.convert = function (scripts, graph, select) {
  var g = new graphToDot.Graph(select);
  g.props['rankdir'] = 'TB';
  g.props['splines'] = 'true';

  graph[select].blocks.forEach((block, bidx) => {
    var n = new graphToDot.Node(`Block${block.number}`);
    n.props['shape'] = 'box';
    var ins;
    n.props['label'] = `
<<table border="0" cellborder="0" cellpadding="1">
  <tr>
    <td align="center" bgcolor="black" colspan="3">
      <font color="white">Block ${block.number}</font>
    </td>
  </tr>
  ${graphToDot.convertResumePoint(block.resumePoint)}
  ${[graphToDot.convertInstruction(ins) for (ins of block.instructions)].join("")}
</table>>
    `.replace("\n", " ").replace(/\s+</g, "<").replace(/>\s+/g, ">");

    var bmir = graph.mir.blocks[bidx];
    if (bmir.attributes.indexOf('backedge') != -1)
      n.props['color'] = 'red';
    if (bmir.attributes.indexOf('loopheader') != -1)
      n.props['color'] = 'green';
    if (bmir.attributes.indexOf('splitedge') != -1)
      n.props['style'] = 'dashed';

    g.addNode(n);

    bmir.successors.forEach((succ, index) => {
      var e = new graphToDot.Edge(n.name, `Block${succ}`);

      if (bmir.successors.length == 2)
        e.props["label"] = index == 0 ? "1" : "0";

      g.addEdge(e);
    })
  });

  return g.write();
}
