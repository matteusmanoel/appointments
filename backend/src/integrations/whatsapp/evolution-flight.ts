const tails = new Map<string, Promise<void>>();

/** One Evolution socket operation per instance. A second caller waits instead of opening another login. */
export function withEvolutionInstance<T>(instanceName: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(instanceName) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(instanceName, tail);
  void tail.finally(() => {
    if (tails.get(instanceName) === tail) tails.delete(instanceName);
  });
  return run;
}
