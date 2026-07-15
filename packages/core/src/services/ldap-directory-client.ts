import { Client, type Entry, type SearchOptions } from "ldapts";

import type { ResolvedLdapProviderConnection } from "./auth-provider-ldap-config";

export type LdapDirectoryEntry = Entry;

export interface LdapDirectorySearchOptions {
  attributes: string[];
  filter: string;
  scope: "base" | "sub";
  sizeLimit: number;
  timeLimit: number;
}

export interface LdapDirectoryClient {
  bind(dn: string, password: string): Promise<void>;
  search(
    baseDn: string,
    options: LdapDirectorySearchOptions,
  ): Promise<LdapDirectoryEntry[]>;
  startTls(): Promise<void>;
  unbind(): Promise<void>;
}

export type LdapClientFactory = (
  config: ResolvedLdapProviderConnection,
) => LdapDirectoryClient;

export const defaultLdapClientFactory: LdapClientFactory = (config) => {
  const client = new Client({
    url: config.url,
    timeout: 10_000,
    connectTimeout: 5_000,
  });
  return {
    async bind(dn, password) {
      await client.bind(dn, password);
    },
    async search(baseDn, options) {
      const search = await client.search(baseDn, toLdaptsSearchOptions(options));
      return search.searchEntries;
    },
    async startTls() {
      await client.startTLS();
    },
    async unbind() {
      await client.unbind();
    },
  };
};

function toLdaptsSearchOptions(
  options: LdapDirectorySearchOptions,
): SearchOptions {
  return {
    attributes: options.attributes,
    filter: options.filter,
    scope: options.scope,
    sizeLimit: options.sizeLimit,
    timeLimit: options.timeLimit,
  };
}
