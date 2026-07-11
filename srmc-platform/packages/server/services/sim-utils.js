/**
 * sim-utils.js — Shared SIM mode computation.
 *
 * Eliminates the SIM mode switching logic that was duplicated across
 * broadcast-engine.js (turbo + normal paths) and gateway-outbound.js.
 *
 * Supports four modes:
 *   'sim1'         — always use SIM 1
 *   'sim2'         — always use SIM 2
 *   'round-robin'  — alternate between SIM 1 and SIM 2 per message
 *   'parallel'     — first half of messages on start SIM, second half on the other
 *
 * In the engine, 'round-robin' also supports combined gateway×SIM alternation
 * when multiple gateways are used in round-robin distribution mode.
 */

/**
 * Compute which SIM slot ('sim1' or 'sim2') to use for a message.
 *
 * This is the full version used by the broadcast engine, supporting
 * combined gateway×SIM round-robin across multiple gateways.
 *
 * @param {object}   broadcastRecord   - The broadcast row (sim_mode, sim_round_start, distribution)
 * @param {string}   gatewayId         - ID of the gateway handling this message
 * @param {number}   msgIndex          - Sequential index of this message within its gateway's batch
 * @param {object}   gatewayMsgCounts  - Map of gatewayId → total message count for this broadcast
 * @param {number}   totalRecipients   - Total recipient count for this broadcast
 * @param {number}   numGateways       - Number of active gateways
 * @param {string}   distMode          - 'round-robin' or 'linear'
 * @param {number|null} [combinedPos]  - Global position for combined gateway×SIM round-robin
 *                                        (should increment for ALL messages, not just push)
 * @returns {string} 'sim1' or 'sim2'
 */
export function computeSimMode(
  broadcastRecord,
  gatewayId,
  msgIndex,
  gatewayMsgCounts,
  totalRecipients,
  numGateways,
  distMode,
  combinedPos = null,
) {
  const simMode = broadcastRecord.sim_mode || 'sim1';
  const startSim = broadcastRecord.sim_round_start || 'sim1';
  const isStartSim2 = startSim === 'sim2';

  if (simMode === 'round-robin') {
    // Combined gateway×SIM round-robin: GW1→SIM1 → GW1→SIM2 → GW2→SIM1 → GW2→SIM2
    // SIM switches every N messages (N = number of gateways) so each gateway sends
    // N messages on the same SIM before switching.
    if (distMode === 'round-robin' && numGateways > 1 && combinedPos !== null) {
      const simCycleIdx = numGateways > 0 ? Math.floor(combinedPos / numGateways) % 2 : 0;
      return isStartSim2
        ? (simCycleIdx === 0 ? 'sim2' : 'sim1')
        : (simCycleIdx === 0 ? 'sim1' : 'sim2');
    }
    // Per-gateway round-robin
    return isStartSim2
      ? (msgIndex % 2 === 0 ? 'sim2' : 'sim1')
      : (msgIndex % 2 === 0 ? 'sim1' : 'sim2');
  }

  if (simMode === 'parallel') {
    const mid = Math.floor((gatewayMsgCounts[gatewayId] || totalRecipients) / 2);
    return msgIndex < mid
      ? startSim
      : (isStartSim2 ? 'sim1' : 'sim2');
  }

  // 'sim1' or 'sim2' — use directly
  return simMode;
}

/**
 * Compute SIM slot for a pull-claimed message (used by gateway-outbound.js).
 *
 * Simpler variant — no combined gateway×SIM. Decisions are based on the
 * message's position (idx) in the claimed batch.
 *
 * @param {object}   row   - Message row with sim_mode, sim_round_start, broadcast_total
 * @param {number}   idx   - Index within the claimed messages array (0-based)
 * @returns {string} 'sim1' or 'sim2'
 */
export function resolvePullSimMode(row, idx) {
  const simMode = row.sim_mode || 'sim1';
  const startSim = row.sim_round_start || 'sim1';
  const isStartSim2 = startSim === 'sim2';

  if (simMode === 'round-robin') {
    return isStartSim2
      ? (idx % 2 === 0 ? 'sim2' : 'sim1')
      : (idx % 2 === 1 ? 'sim2' : 'sim1');
  }

  if (simMode === 'parallel') {
    const total = row.broadcast_total || (idx + 1);
    const mid = Math.floor(total / 2);
    return idx < mid ? startSim : (isStartSim2 ? 'sim1' : 'sim2');
  }

  return simMode;
}
