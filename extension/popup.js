import { parseArtifact } from "./core.js";
document.getElementById("review").onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    parseArtifact(tab.url);
    const clean = new URL(tab.url);
    clean.search = "";
    await chrome.tabs.create({
      url:
        chrome.runtime.getURL("viewer.html") +
        "?source=" +
        encodeURIComponent(clean.href),
    });
    window.close();
  } catch (error) {
    document.getElementById("status").textContent = error.message;
  }
};
document.getElementById("settings").onclick = () =>
  chrome.tabs.create({
    url: chrome.runtime.getURL("viewer.html") + "#settings",
  });
