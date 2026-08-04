import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Specimen from "./Specimen";
import "./styles.css";

// `?specimen` opens the design specimen instead of the app (see DESIGN.md). It
// needs no Tauri host, so `pnpm dev` plus a browser is enough to review the
// design — and it is lazy only in the sense that it is never reached otherwise.
const showSpecimen = new URLSearchParams(window.location.search).has("specimen");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{showSpecimen ? <Specimen /> : <App />}</React.StrictMode>,
);
