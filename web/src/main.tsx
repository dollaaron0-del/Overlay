import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setupServiceWorkerUpdates } from "./pwa/sw-update";
import "./styles/index.css";

setupServiceWorkerUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
