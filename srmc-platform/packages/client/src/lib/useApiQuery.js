/**
 * useApiQuery / useApiMutation — Thin wrappers around @tanstack/react-query
 * that use the app's fetch-based api client. Provides a consistent pattern
 * across all pages and eliminates boilerplate.
 *
 * Usage:
 *   const { data, isLoading } = useApiQuery('campaigns', '/campaigns')
 *   const createMut = useApiMutation('/campaigns', { onRefetch: 'campaigns' })
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api.js'

/**
 * Fetch a list/object from the API with automatic caching.
 *
 * @param {string}         key        - Unique cache key (e.g. 'campaigns', ['agents', page])
 * @param {string}         endpoint   - API path (e.g. '/campaigns')
 * @param {object}         [opts]     - Additional react-query options
 * @param {number}         [opts.staleTime=Infinity] - How long data is considered fresh (ms)
 * @returns {{ data, isLoading, error, refetch }}
 */
export function useApiQuery(key, endpoint, opts = {}) {
  const queryKey = Array.isArray(key) ? key : [key]
  const { staleTime = Infinity, ...rest } = opts

  return useQuery({
    queryKey,
    queryFn: () => api.get(endpoint),
    staleTime,
    ...rest,
  })
}

/**
 * Mutate data (POST/PUT/DELETE) and optionally refetch related queries.
 *
 * @param {string|Function} endpoint   - API path or function that receives (body) => api.post(...)
 * @param {object}          [opts]
 * @param {string|string[]} [opts.onRefetch] - Query key(s) to invalidate on success
 * @param {Function}        [opts.onSuccess] - Extra success callback
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useApiMutation(endpoint, opts = {}) {
  const queryClient = useQueryClient()
  const { onRefetch, onSuccess, method = 'post', ...rest } = opts

  const mutationFn = typeof endpoint === 'function'
    ? endpoint
    : (body) => {
        const m = method.toLowerCase()
        if (m === 'put') return api.put(endpoint, body)
        if (m === 'del') return api.del(endpoint)
        if (m === 'post') return api.post(endpoint, body)
        return api.post(endpoint, body)
      }

  return useMutation({
    mutationFn,
    ...rest,
    onSuccess: (result, variables, ctx) => {
      // Invalidate related queries so the list auto-refreshes
      if (onRefetch) {
        const keys = Array.isArray(onRefetch) ? onRefetch : [onRefetch]
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: [key] })
        }
      }
      if (onSuccess) onSuccess(result, variables, ctx)
    },
  })
}
