import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./app/error-boundary";
import { createAppQueryClient } from "./app/query-client";
import { createAppRouter } from "./app/router";
import "./styles.css";

const queryClient = createAppQueryClient();
const router = createAppRouter(createBrowserHistory());

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </AppErrorBoundary>,
);
