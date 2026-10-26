// The return shape of every Resolve Hub server action. Deliberately NOT a
// "use server" file: a type re-exported from one crashes at runtime with
// "X is not defined" while tsc passes (memory: use-server type re-export).

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export function ok(): Result<undefined>;
export function ok<T>(data: T): Result<T>;
export function ok<T>(data?: T): Result<T | undefined> {
  return { ok: true, data };
}

export function fail<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
