import { describe, expect, it } from "vitest";

import {
  createProviderAdapterConformanceSuite,
  PROVIDER_ADAPTER_CONFORMANCE_CASE_NAMES,
} from "./conformance-kit";
import {
  providerConformanceFixture,
  providerConformanceFixtureKinds,
} from "./conformance-test-fixtures";
import { listProviderDialects } from "./registry";

const registeredDialects = listProviderDialects();

describe("provider adapter conformance kit", () => {
  it("has an exact offline fixture for every registered dialect", () => {
    expect(providerConformanceFixtureKinds()).toEqual(
      registeredDialects.map(({ kind }) => kind),
    );
  });

  for (const { kind } of registeredDialects) {
    describe(`${kind}`, () => {
      const suite = createProviderAdapterConformanceSuite(
        providerConformanceFixture(kind),
      );

      it("derives the complete contract case list", () => {
        expect(suite.map((testCase) => testCase.name)).toEqual(
          PROVIDER_ADAPTER_CONFORMANCE_CASE_NAMES,
        );
      });

      for (const testCase of suite) {
        it(`${testCase.name}`, async () => {
          await testCase.run();
        });
      }
    });
  }
});
