export function parseManagedSecretRef(secretRef: string): {
  path: string;
  scheme: string;
} {
  const separator = secretRef.indexOf("://");
  if (separator <= 0 || separator === secretRef.length - 3) {
    return { path: "", scheme: "invalid" };
  }
  return {
    scheme: secretRef.slice(0, separator),
    path: secretRef.slice(separator + 3),
  };
}
