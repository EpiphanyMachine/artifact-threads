// Size the trusted shell through its own stylesheet, without inline styles.
export function panelLayout(onSettled) {
  const divider = document.getElementById("panel-divider");
  const workspace = document.querySelector(".workspace");
  const preview = document.querySelector(".preview");
  const stacked = matchMedia("(max-width: 959px)");
  const sheet = [...document.styleSheets].find((s) =>
    s.href?.endsWith("/viewer.css"),
  );
  const index = sheet.insertRule(":root {}", sheet.cssRules.length);
  const sizes = sheet.cssRules[index].style;
  let width = 390,
    height = innerHeight * 0.45,
    settling,
    drag;
  function limits() {
    return stacked.matches
      ? { min: 180, max: Math.max(180, innerHeight - 188) }
      : { min: 300, max: Math.min(640, Math.max(300, innerWidth - 428)) };
  }
  function update(value) {
    const { min, max } = limits();
    value = Math.round(Math.max(min, Math.min(max, value)));
    if (stacked.matches) {
      height = value;
      sizes.setProperty("--review-height", value + "px");
    } else {
      width = value;
      sizes.setProperty("--review-width", value + "px");
    }
    divider.setAttribute(
      "aria-orientation",
      stacked.matches ? "horizontal" : "vertical",
    );
    divider.setAttribute("aria-valuemin", String(min));
    divider.setAttribute("aria-valuemax", String(max));
    divider.setAttribute("aria-valuenow", String(value));
    divider.setAttribute(
      "aria-valuetext",
      value + (stacked.matches ? " pixels high" : " pixels wide"),
    );
  }
  function settled() {
    clearTimeout(settling);
    settling = setTimeout(() => {
      if (workspace.classList.contains("drawer-open")) onSettled();
    }, 100);
  }
  function sync() {
    update(stacked.matches ? height : width);
    settled();
  }
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      coordinate: stacked.matches ? event.clientY : event.clientX,
      size: stacked.matches ? height : width,
    };
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    divider.focus();
    event.preventDefault();
  });
  divider.addEventListener("pointermove", (event) => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    if (drag)
      update(
        drag.size +
          drag.coordinate -
          (stacked.matches ? event.clientY : event.clientX),
      );
  });
  function stop(event) {
    drag = null;
    if (divider.hasPointerCapture(event.pointerId))
      divider.releasePointerCapture(event.pointerId);
    document.body.classList.remove("resizing");
    settled();
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    divider.addEventListener(type, stop);
  divider.addEventListener("keydown", (event) => {
    const keys = stacked.matches
      ? ["ArrowUp", "ArrowDown"]
      : ["ArrowLeft", "ArrowRight"];
    if (![...keys, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = stacked.matches ? height : width;
    const { min, max } = limits();
    update(
      event.key === "Home"
        ? min
        : event.key === "End"
          ? max
          : current +
            (event.key === keys[0] ? 1 : -1) * (event.shiftKey ? 50 : 20),
    );
    settled();
  });
  stacked.addEventListener("change", sync);
  addEventListener("resize", sync);
  new ResizeObserver(settled).observe(preview);
  sync();
  return { settled };
}
