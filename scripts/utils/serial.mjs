/** Per-key promise queue: GM-side writes that read-modify-write the same state run one after another. */
const queues = new Map();
export function serialize(key, fn) {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}
