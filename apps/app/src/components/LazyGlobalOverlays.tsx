import { Button } from "@romeo/ui";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import {
  COMMAND_PALETTE_INTENT_EVENT,
  COMMAND_PALETTE_OPEN_EVENT,
} from "../lib/command-palette-events";
import { useLocale } from "../lib/i18n";

const loadCommandPalette = () => import("./CommandPalette");
const loadShortcutsModal = () => import("./ShortcutsModal");
const LazyShortcutsModal = lazy(async () => ({
  default: (await loadShortcutsModal()).ShortcutsModal,
}));

/**
 * Keeps global overlay implementations out of the initial route shell while a
 * tiny launcher retains first-keystroke behavior and is the sole owner of
 * global keyboard/event listeners.
 */
export function LazyGlobalOverlays() {
  const { t } = useLocale();
  const [commandRequested, setCommandRequested] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandLoadAttempt, setCommandLoadAttempt] = useState(0);
  const [commandModuleReady, setCommandModuleReady] = useState(false);
  const [shortcutsRequested, setShortcutsRequested] = useState(false);
  const LazyCommandPalette = useMemo(() => {
    void commandLoadAttempt;
    void commandModuleReady;
    return lazy(async () => ({
      default: (await loadCommandPalette()).CommandPalette,
    }));
  }, [commandLoadAttempt, commandModuleReady]);

  useEffect(() => {
    const preloadCommand = () => {
      void loadCommandPalette()
        .then(() => setCommandModuleReady(true))
        .catch(() => undefined);
    };
    const requestCommand = () => {
      preloadCommand();
      setCommandRequested(true);
      setCommandOpen(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        preloadCommand();
        setCommandRequested(true);
        setCommandOpen((current) => !current);
        return;
      }
      if (event.key !== "?") return;
      const element = document.activeElement as HTMLElement | null;
      const typing =
        element?.tagName === "INPUT" ||
        element?.tagName === "TEXTAREA" ||
        element?.isContentEditable === true;
      if (!typing) {
        event.preventDefault();
        setShortcutsRequested(true);
      }
    };
    const onIntent = preloadCommand;
    const onShortcuts = () => setShortcutsRequested(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, requestCommand);
    window.addEventListener(COMMAND_PALETTE_INTENT_EVENT, onIntent);
    window.addEventListener("rm-shortcuts", onShortcuts);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, requestCommand);
      window.removeEventListener(COMMAND_PALETTE_INTENT_EVENT, onIntent);
      window.removeEventListener("rm-shortcuts", onShortcuts);
    };
  }, []);

  return (
    <Suspense fallback={null}>
      {commandRequested ? (
        <LazyOverlayErrorBoundary
          fallback={
            <div className="rm-table-empty" role="alert">
              <p>{t("tableError")}</p>
              <Button
                onClick={() => setCommandLoadAttempt((attempt) => attempt + 1)}
                variant="secondary"
              >
                {t("tableRetry")}
              </Button>
            </div>
          }
          key={commandLoadAttempt}
        >
          <LazyCommandPalette
            onOpenChange={setCommandOpen}
            open={commandOpen}
          />
        </LazyOverlayErrorBoundary>
      ) : null}
      {shortcutsRequested ? <LazyShortcutsModal initialOpen /> : null}
    </Suspense>
  );
}

class LazyOverlayErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo): void {}

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
