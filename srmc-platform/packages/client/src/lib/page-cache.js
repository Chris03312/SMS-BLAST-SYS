/**
 * page-cache — Module-level cache for manual API fetches.
 *
 * Pages that use useState + useEffect (instead of useApiQuery) lose their
 * data when the component unmounts on navigation. This cache keeps the last
 * successful response in memory so the page can immediately render it on
 * re-visit while fetching fresh data in the background.
 *
 * Usage:
 *   const cached = PageCache.get('my-key')
 *   const [data, setData] = useState(cached?.rows ?? [])
 *   const [loading, setLoading] = useState(!cached)
 *
 *   // After successful fetch:
 *   PageCache.set('my-key', res)
 */

const store = {}

export const PageCache = {
  /** Retrieve cached value for `key`, or `undefined`. */
  get(key) {
    return store[key]
  },

  /** Store `value` at `key`. Returns `value` for chaining. */
  set(key, value) {
    store[key] = value
    return value
  },

  /** Returns `true` if `key` exists in the cache. */
  has(key) {
    return key in store
  },

  /** Delete a single entry (e.g. after a mutation that invalidates it). */
  delete(key) {
    delete store[key]
  },

  /** Clear the entire cache (e.g. on logout). */
  clear() {
    for (const key of Object.keys(store)) delete store[key]
  },
}
