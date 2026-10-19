// Suggestions live only in the trusted workspace, never in the artifact frame.
export function attachMentions(input, context, loadUsers) {
  const list = document.createElement("div");
  list.id = input.id + "-mentions";
  list.className = "mention-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "GitHub mention suggestions");
  list.hidden = true;
  const status = document.createElement("p");
  status.className = "small";
  status.setAttribute("role", "status");
  input.parentElement.after(list, status);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  let generation = 0,
    matches = [],
    active = 0,
    selection = null;
  function hide() {
    generation++;
    list.hidden = true;
    status.textContent = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function fragment() {
    if (input.selectionStart !== input.selectionEnd) return null;
    const end = input.selectionStart;
    const match = input.value.slice(0, end).match(/(?:^|[\s(])@([a-z\d-]*)$/i);
    return match
      ? { start: end - match[1].length - 1, end, query: match[1] }
      : null;
  }
  function choose(index) {
    const current = fragment();
    if (
      !selection ||
      !matches[index] ||
      selection.repo !== context() ||
      current?.start !== selection.start ||
      current?.end !== selection.end ||
      current?.query !== selection.query
    )
      return hide();
    input.setRangeText(
      "@" + matches[index] + " ",
      selection.start,
      selection.end,
      "end",
    );
    hide();
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function highlight() {
    [...list.children].forEach((button, index) =>
      button.setAttribute("aria-selected", String(index === active)),
    );
    input.setAttribute("aria-activedescendant", list.id + "-" + active);
  }
  async function update() {
    hide();
    const part = fragment(),
      repo = context();
    if (!part || !repo || document.activeElement !== input) return;
    const request = generation;
    status.textContent = "Loading repository mention suggestions…";
    try {
      const result = await loadUsers();
      if (
        request !== generation ||
        repo !== context() ||
        document.activeElement !== input
      )
        return;
      selection = { ...part, repo };
      matches = result.users
        .filter((login) =>
          login.toLowerCase().startsWith(part.query.toLowerCase()),
        )
        .slice(0, 10);
      active = 0;
      list.replaceChildren();
      for (const [index, login] of matches.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.id = list.id + "-" + index;
        button.setAttribute("role", "option");
        button.tabIndex = -1;
        button.textContent = "@" + login;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.onclick = () => choose(index);
        list.append(button);
      }
      list.hidden = !matches.length;
      input.setAttribute("aria-expanded", String(!!matches.length));
      if (matches.length) highlight();
      status.textContent =
        (matches.length
          ? "↑/↓ to choose, Enter or Tab to insert. "
          : "No matching suggestions. ") +
        (result.truncated ? "First 1,000 repository assignees only. " : "") +
        "You can also type any @username or @organization/team.";
    } catch {
      if (request === generation)
        status.textContent =
          "Suggestions unavailable. You can still type an @mention.";
    }
  }
  input.addEventListener("input", update);
  input.addEventListener("click", update);
  input.addEventListener("blur", hide);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape" || (event.key === "Tab" && event.shiftKey)) {
      hide();
      return;
    }
    if (
      !list.hidden &&
      ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)
    ) {
      event.preventDefault();
      if (["Enter", "Tab"].includes(event.key)) choose(active);
      else {
        active =
          (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
          matches.length;
        highlight();
      }
    } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      hide();
  });
}
