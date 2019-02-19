(function() {
  const svg = d3.select("svg");
  const width = +svg.attr("width");
  const height = +svg.attr("height");

  let nodeMap, groupMap;
  let originalLinks;
  let data;
  let nodes, links, hulls;
  let node, link, hull;

  const collapse = {}; // Track collapse status of each group

  const hullOffset = 10;

  const color = d3
    .scaleOrdinal()
    .range([
      "#5F4690",
      "#1D6996",
      "#38A6A5",
      "#0F8554",
      "#73AF48",
      "#EDAD08",
      "#E17C05",
      "#CC503E",
      "#94346E",
      "#6F4070",
      "#994E95",
      "#666666"
    ]);

  function r(d) {
    if (d.isGroupNode) {
      return 10 + Math.sqrt(d.size);
    } else {
      return 5;
    }
  }

  const curve = d3.line().curve(d3.curveCardinalClosed.tension(0.5));

  const simulation = d3
    .forceSimulation()
    .force(
      "link",
      d3
        .forceLink()
        .id(d => d.id)
        .distance(link => {
          const sourceNode = link.source;
          const targetNode = link.target;

          // Increase distance if source and target nodes are from different groups
          const differentGroupFactor =
            sourceNode.group !== targetNode.group ? 1 : 0;

          return 20 + 120 * differentGroupFactor;
        })
    )
    .force("charge", d3.forceManyBody())
    .force("center", d3.forceCenter())
    .on("tick", ticked);
  simulation.stop();

  const g = svg
    .append("g")
    .attr("transform", `translate(${width / 2},${height / 2})`);

  const gHull = g.append("g").attr("class", "hulls");

  const gLink = g.append("g").attr("class", "links");

  const gNode = g.append("g").attr("class", "nodes");

  function processData(graph) {
    graph.nodes.forEach(d => {
      d.group = d.group.toString();
      d.size = 1;
      d.isGroupNode = false;
    });

    nodeMap = d3.map(graph.nodes, d => d.id);

    groupMap = d3.map(
      d3
        .nest()
        .key(d => d.group)
        .entries(graph.nodes)
        .map(d => ({
          id: d.key,
          group: d.key,
          nodes: d.values,
          outerLinkCount: 0,
          size: d.values.length,
          isGroupNode: true
        })),
      d => d.id
    );

    graph.links.forEach(link => {
      const sourceNode = nodeMap.get(link.source);
      const targetNode = nodeMap.get(link.target);
      link.sourceGroup = sourceNode.group;
      link.targetGroup = targetNode.group;
    });

    originalLinks = graph.links;
  }

  function generateNetworkData(prev) {
    // Nodes centroids depend on previous data
    const nodesCentroid = {};
    if (prev) {
      d3.nest()
        .key(d => d.group)
        .map(prev.nodes)
        .each((nodes, group) => {
          if (nodes.length === 1 && nodes[0].isGroupNode) {
            // The group is previously collapsed
            const x = nodes[0].x;
            const y = nodes[0].y;
            if (collapse[group]) {
              // The group is now collapsed
              nodesCentroid[group] = { x: x, y: y };
            } else {
              // The group is now expanded
              nodes[0].nodes.forEach(node => {
                nodesCentroid[node.id] = { x: x, y: y };
              });
            }
          } else {
            // The group is previously expanded
            if (collapse[group]) {
              // The group is now collapsed
              const x = d3.mean(nodes, d => d.x);
              const y = d3.mean(nodes, d => d.y);
              nodesCentroid[group] = { x: x, y: y };
            } else {
              // The group is now expanded
              nodes.forEach(node => {
                nodesCentroid[node.id] = { x: node.x, y: node.y };
              });
            }
          }
        });
    }

    // Nodes
    const nodes = {};
    groupMap.each((d, id) => {
      if (collapse[id]) {
        // The group is now collapsed
        // Push a groupNode for this group
        let x = 0;
        let y = 0;
        if (nodesCentroid[id]) {
          x = nodesCentroid[id].x;
          y = nodesCentroid[id].y;
        }
        nodes[id] = Object.assign({}, d, { x: x, y: y });
      } else {
        // The group is now expanded
        // Push individual nodes for this group
        d.nodes.forEach(node => {
          let x = 0;
          let y = 0;
          const id = node.id;
          if (nodesCentroid[id]) {
            x = nodesCentroid[id].x;
            y = nodesCentroid[id].y;
          }
          nodes[id] = Object.assign({}, node, { x: x, y: y });
        });
      }
    });

    // Links
    const links = {};
    originalLinks.forEach(oLink => {
      const source = collapse[oLink.sourceGroup]
        ? nodes[oLink.sourceGroup]
        : nodes[oLink.source];
      const target = collapse[oLink.targetGroup]
        ? nodes[oLink.targetGroup]
        : nodes[oLink.target];
      const id =
        source.id < target.id
          ? `${source.id}-${target.id}`
          : `${target.id}-${source.id}`;
      const link =
        links[id] ||
        (links[id] = { id: id, source: source, target: target, size: 0 });
      link.size++;
    });

    return { nodes: Object.values(nodes), links: Object.values(links) };
  }

  function updateChart() {
    simulation.stop();

    data = generateNetworkData(data);

    nodes = data.nodes;
    links = data.links;

    hulls = d3
      .nest()
      .key(d => d.group)
      .entries(nodes.filter(d => !d.isGroupNode))
      .map(d => ({
        group: d.key,
        nodes: d.values,
        points: generateHullPoints(d.values)
      }));

    hull = gHull.selectAll(".hull").data(hulls, d => d.group);

    hull.exit().remove();

    hull = hull
      .enter()
      .append("path")
      .attr("class", "hull")
      .attr("fill-opacity", 0.1)
      .attr("fill", d => color(d.group))
      .attr("d", d => curve(d.points))
      .on("click", d => {
        collapse[d.group] = true;
        updateChart();
      })
      .merge(hull);

    link = gLink.selectAll(".link").data(links, d => d.id);

    link.exit().remove();

    link = link
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("stroke-width", d => d.size)
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y)
      .merge(link);

    node = gNode.selectAll(".node").data(nodes, d => d.id);

    node.exit().remove();

    node = node
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", r)
      .attr("fill", d => color(d.group))
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .call(
        d3
          .drag()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended)
      )
      .on("click", d => {
        if (d.isGroupNode) {
          collapse[d.id] = false;
          updateChart();
        }
      })
      .merge(node);

    simulation.nodes(nodes);
    simulation.force("link").links(links);
    simulation.alpha(0.7).restart();
  }

  function ticked() {
    hulls.forEach(d => {
      d.points = generateHullPoints(d.nodes);
    });

    hull.attr("d", d => curve(d.points));

    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node.attr("cx", d => d.x).attr("cy", d => d.y);
  }

  d3.json("miserables.json").then(graph => {
    processData(graph);
    color.domain(groupMap.keys());
    updateChart();
  });

  function dragstarted(d) {
    if (!d3.event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
  }

  function dragended(d) {
    if (!d3.event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  function generateHullPoints(nodes) {
    const points = [];
    nodes.forEach(node => {
      points.push([node.x - hullOffset, node.y - hullOffset]);
      points.push([node.x - hullOffset, node.y + hullOffset]);
      points.push([node.x + hullOffset, node.y - hullOffset]);
      points.push([node.x + hullOffset, node.y + hullOffset]);
    });
    const hullPoints = d3.polygonHull(points);
    return hullPoints;
  }
})();
