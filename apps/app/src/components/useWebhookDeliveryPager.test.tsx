// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useWebhookDeliveryPager } from "./useWebhookDeliveryPager";

let container: HTMLDivElement;
let root: Root;
let pager: ReturnType<typeof useWebhookDeliveryPager>;
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

function Harness() {
  pager = useWebhookDeliveryPager();
  return null;
}

describe("useWebhookDeliveryPager", () => {
  it("owns cursor history and resets it when page size changes", () => {
    act(() => root.render(<Harness />));
    expect(pager.cursor).toBeUndefined();
    expect(pager.isFirstPage).toBe(true);

    act(() =>
      pager
        .tableState({
          isFetching: false,
          nextCursor: "cursor_2",
          webhookId: "webhook_1",
        })
        .onNextPage(),
    );
    expect(pager.cursor).toBe("cursor_2");
    expect(pager.isFirstPage).toBe(false);
    act(() =>
      pager
        .tableState({ isFetching: false, nextCursor: "cursor_2" })
        .onNextPage(),
    );
    expect(pager.tableState({ isFetching: false }).pageIndex).toBe(1);

    act(() => pager.tableState({ isFetching: false }).onPageSizeChange(50));
    expect(pager.pageSize).toBe(50);
    expect(pager.cursor).toBeUndefined();
    expect(pager.isFirstPage).toBe(true);
  });
});
