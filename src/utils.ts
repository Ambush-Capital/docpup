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

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function interpolateEnvVars(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (_match, name: string) => {
    const envValue = process.env[name];
    if (envValue === undefined) {
      throw new Error(
        `Environment variable "${name}" is not set (referenced in config value)`
      );
    }
    return envValue;
  });
}

export function docpupFetch(
  url: string,
  options?: { accept?: string; headers?: Record<string, string> }
): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": "docpup/0.1",
      ...(options?.accept ? { Accept: options.accept } : {}),
      ...options?.headers,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
}

export async function authenticateWithPassword(
  baseUrl: string,
  password: string
): Promise<Record<string, string>> {
  const url = new URL("/password", baseUrl);
  const body = new URLSearchParams({ password, redirect: "/" });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": "docpup/0.1",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });

  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) {
    throw new Error(
      `Password authentication failed for ${baseUrl} — no cookies returned (wrong password?)`
    );
  }

  const cookieValues = setCookies.map((c) => c.split(";")[0]).join("; ");
  return { Cookie: cookieValues };
}
