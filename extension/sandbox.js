function annotate(channel) {
  const send = (type, data = {}) =>
    parent.postMessage(
      { schema: "artifact-threads/frame", channel, type, ...data },
      "*",
    );
  const host = document.createElement("div");
  host.id = "artifact-threads-overlay";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ":host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none}button{position:fixed;pointer-events:auto;width:27px;height:27px;border:2px solid white;border-radius:50%;background:#17634e;color:white;font:600 11px system-ui;box-shadow:0 1px 5px #0005;cursor:pointer}.box{position:fixed;box-sizing:border-box;border:2px solid #237e66;background:#237e6612;pointer-events:none}.hover{border-style:dashed}";
  shadow.append(style);
  document.documentElement.append(host);
  let mode = false,
    threads = [],
    records = [];
  const hover = document.createElement("div");
  hover.className = "box hover";
  hover.hidden = true;
  shadow.append(hover);
  const hash = (text) => {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++)
      value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16);
  };
  const own = (node) => node === host || host.contains(node);
  function selector(element) {
    if (element.id) return "#" + CSS.escape(element.id);
    const parts = [];
    let node = element;
    while (node && node !== document.body && parts.length < 10) {
      const name = node.localName;
      const index =
        [...node.parentElement.children]
          .filter((child) => child.localName === name)
          .indexOf(node) + 1;
      parts.unshift(name + ":nth-of-type(" + index + ")");
      node = node.parentElement;
    }
    return (node === document.body ? "body > " : "") + parts.join(" > ");
  }
  function fingerprint(element) {
    if (element.tagName === "IMG")
      return hash(
        "IMG:" +
          element.getAttribute("src") +
          ":" +
          element.getAttribute("alt"),
      );
    if (element.tagName === "CANVAS") {
      try {
        return hash(element.toDataURL());
      } catch {
        return "";
      }
    }
    if (element.closest("svg")) return hash(element.outerHTML);
    return hash(
      element.tagName + ":" + element.textContent.trim().slice(0, 2000),
    );
  }
  function stream(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest("script,style,noscript") ||
          own(node.parentElement)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let text = "",
      node;
    while ((node = walker.nextNode())) {
      nodes.push({
        node,
        start: text.length,
        end: text.length + node.textContent.length,
      });
      text += node.textContent;
    }
    return { nodes, text };
  }
  function elementFor(target) {
    try {
      return target.id
        ? document.getElementById(target.id)
        : document.querySelector(target.selector);
    } catch {
      return null;
    }
  }
  function locate(target) {
    const element = elementFor(target);
    if (target.kind === "element") {
      if (
        !element ||
        element.tagName !== target.tag ||
        !target.fingerprint ||
        fingerprint(element) !== target.fingerprint
      )
        return { state: "missing" };
      return {
        state: "attached",
        element,
        rect: () => {
          const rect = element.getBoundingClientRect();
          if (!rect.width && !rect.height) return rect;
          const x = rect.left + rect.width * target.point.x,
            y = rect.top + rect.height * target.point.y;
          return { left: x, right: x, top: y, width: 1, height: 1 };
        },
      };
    }
    const roots = element ? [element, document.body] : [document.body];
    for (const root of roots) {
      const { nodes, text } = stream(root);
      const exact = target.quote.exact;
      const matches = [];
      let index = text.indexOf(exact);
      while (index !== -1) {
        matches.push(index);
        index = text.indexOf(exact, index + 1);
        if (matches.length > 100) return { state: "ambiguous" };
      }
      const contextual = matches.filter(
        (start) =>
          (!target.quote.prefix ||
            text.slice(
              Math.max(0, start - target.quote.prefix.length),
              start,
            ) === target.quote.prefix) &&
          (!target.quote.suffix ||
            text.slice(
              start + exact.length,
              start + exact.length + target.quote.suffix.length,
            ) === target.quote.suffix),
      );
      const candidates = contextual.length ? contextual : matches;
      if (candidates.length !== 1) {
        if (root === document.body)
          return { state: candidates.length ? "ambiguous" : "missing" };
        continue;
      }
      const start = candidates[0],
        end = start + exact.length;
      const first = nodes.find((item) => item.end > start),
        last = nodes.find((item) => item.end >= end);
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      return {
        state: "attached",
        element: first.node.parentElement,
        rect: () => range.getBoundingClientRect(),
      };
    }
    return { state: "missing" };
  }
  function position() {
    for (const record of records) {
      const rect = record.location.rect();
      record.pin.style.left =
        Math.max(0, Math.min(innerWidth - 29, rect.right - 12)) + "px";
      record.pin.style.top = Math.max(-30, rect.top - 10) + "px";
      record.pin.hidden = rect.width === 0 && rect.height === 0;
    }
  }
  function refresh() {
    for (const record of records) record.pin.remove();
    records = [];
    const locations = [];
    for (const thread of threads) {
      const location = locate(thread.target);
      locations.push({ number: thread.number, state: location.state });
      if (location.state !== "attached") continue;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = String(thread.number);
      pin.title = "Open thread #" + thread.number;
      pin.setAttribute("aria-label", "Open annotation thread " + thread.number);
      pin.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        send("thread.select", { number: thread.number });
      };
      shadow.append(pin);
      records.push({ pin, location, number: thread.number });
    }
    position();
    send("locations", { locations });
  }
  function chooseElement(event) {
    const svg = event.target.closest("svg"),
      identified = event.target.closest("[id]");
    const element =
      event.target.closest("img,canvas,video") ||
      (svg
        ? identified && svg.contains(identified)
          ? identified
          : event.target
        : event.target.closest(
            "[id],figure,button,p,li,h1,h2,h3,h4,td,th,pre",
          ) || event.target);
    if (
      !element ||
      own(element) ||
      element === document.body ||
      element === document.documentElement
    )
      return null;
    return element;
  }
  document.addEventListener(
    "mousemove",
    (event) => {
      if (!mode) return;
      const element = chooseElement(event);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      hover.hidden = false;
      Object.assign(hover.style, {
        left: rect.left + "px",
        top: rect.top + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
    },
    true,
  );
  document.addEventListener(
    "mouseup",
    (event) => {
      if (!mode || own(event.target)) return;
      const selection = getSelection();
      if (!selection || selection.isCollapsed) return;
      const exact = selection.toString();
      if (!exact.trim()) return;
      if (exact.length > 2000) {
        send("selection.error", { message: "Select up to 2,000 characters." });
        return;
      }
      const range = selection.getRangeAt(0);
      let element =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      if (own(element)) return;
      const scoped = stream(element);
      const before = document.createRange();
      before.selectNodeContents(element);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const target = {
        kind: "text",
        tag: element.tagName,
        id: element.id || "",
        selector: selector(element),
        quote: {
          exact,
          prefix: scoped.text.slice(Math.max(0, start - 80), start),
          suffix: scoped.text.slice(
            start + exact.length,
            start + exact.length + 80,
          ),
        },
      };
      send("target", { target });
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!mode || own(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (getSelection()?.toString().trim()) return;
      const element = chooseElement(event);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      send("target", {
        target: {
          kind: "element",
          tag: element.tagName,
          id: element.id || "",
          selector: selector(element),
          fingerprint: fingerprint(element),
          preview:
            element.getAttribute("alt") ||
            element.textContent.trim().slice(0, 300) ||
            element.tagName,
          point: {
            x: (event.clientX - rect.left) / Math.max(1, rect.width),
            y: (event.clientY - rect.top) / Math.max(1, rect.height),
          },
        },
      });
    },
    true,
  );
  addEventListener("message", (event) => {
    const data = event.data;
    if (
      event.source !== parent ||
      data?.channel !== channel ||
      data.schema !== "artifact-threads/host"
    )
      return;
    if (data.type === "mode") {
      mode = Boolean(data.enabled);
      hover.hidden = true;
      if (!mode) getSelection()?.removeAllRanges();
    }
    if (data.type === "threads" && Array.isArray(data.threads)) {
      threads = data.threads;
      refresh();
    }
    if (data.type === "jump") {
      const record = records.find((item) => item.number === data.number);
      if (record) {
        let ancestor = record.location.element;
        while (ancestor) {
          if (ancestor.tagName === "DETAILS") ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
        record.location.element.scrollIntoView({ block: "center" });
        position();
        if (!record.location.rect().width && !record.location.rect().height)
          send("selection.error", {
            message:
              "This node is hidden by the artifact’s current interactive state. Reveal that section, then show the pin again.",
          });
      } else
        send("selection.error", {
          message:
            "This target is missing or ambiguous in the displayed version. Open the original version from the thread.",
        });
    }
  });
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      position();
    });
  }
  addEventListener("scroll", schedule, true);
  addEventListener("resize", schedule);
  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(refresh, 200);
  });
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "open", "class"],
  });
  send("ready", { title: document.title });
}
addEventListener("message", (event) => {
  const data = event.data;
  if (
    event.source !== parent ||
    data?.schema !== "artifact-threads/bootstrap" ||
    typeof data.html !== "string" ||
    typeof data.channel !== "string"
  )
    return;
  const script =
    "(" + annotate.toString() + ")(" + JSON.stringify(data.channel) + ");";
  document.open();
  document.write(
    data.html +
      "<script>" +
      script.replace(/<\/script/gi, "<\\/script") +
      "<\/script>",
  );
  document.close();
});
parent.postMessage({ schema: "artifact-threads/boot" }, "*");
