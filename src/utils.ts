import path from "node:path";

export function toPosix(input: string) {
  return input.split(path.sep).join("/");
}

export function resolveInside(root: string, ...segments: string[]) {
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved path escapes root: ${resolved}`);
  }
  return resolved;
}

export function docpupFetch(
  url: string,
  options?: { accept?: string }
): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": "docpup/0.1",
      ...(options?.accept ? { Accept: options.accept } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
}
