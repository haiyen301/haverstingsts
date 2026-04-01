import { createBrowserRouter } from "react-router";
import { Home } from "./pages/Home";
import { HarvestInput } from "./pages/HarvestInput";
import { ProjectInput } from "./pages/ProjectInput";
import { Dashboard } from "./pages/Dashboard";
import { Harvests } from "./pages/Harvests";
import { Projects } from "./pages/Projects";
import { Planning } from "./pages/Planning";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
  },
  {
    path: "/harvest/new",
    Component: HarvestInput,
  },
  {
    path: "/project/new",
    Component: ProjectInput,
  },
  {
    path: "/dashboard",
    Component: Dashboard,
  },
  {
    path: "/harvests",
    Component: Harvests,
  },
  {
    path: "/projects",
    Component: Projects,
  },
  {
    path: "/planning",
    Component: Planning,
  },
]);
