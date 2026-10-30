import { createElement } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return createElement("h1", null, "Moneytrap binary spike");
}

const container = document.getElementById("app");
if (!container) throw new Error("Missing app element");
createRoot(container).render(createElement(App));
