import type { ReactNode } from "react";

import { WorkspaceProvider } from "../components/WorkspaceContext";
import { AsyncErrorReporter } from "../components/AsyncErrorReporter";
import { ConnectivityStatus } from "../components/ConnectivityStatus";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <AsyncErrorReporter />
      <ConnectivityStatus />
      {children}
    </WorkspaceProvider>
  );
}
