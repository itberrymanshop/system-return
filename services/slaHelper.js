'use strict';
const slaService = require('./slaService');

/**
 * SLA Tracking Helper
 * Provides utilities to integrate SLA tracking into process workflows
 */

/**
 * Apply SLA when a return enters a specific stage
 * Usage in controller: await slaHelper.applyStageEntry(returnId, 'sorting', filter1, filter2);
 */
async function applyStageEntry(returnId, stage, filter1 = null, filter2 = null, startedAt = null) {
  try {
    const result = await slaService.applySLAToStage(returnId, stage, filter1, filter2, startedAt);
    return result;
  } catch (err) {
    console.error('Error applying stage entry SLA:', err);
    return null;
  }
}

/**
 * Complete SLA when a return exits a stage
 * Usage in controller: await slaHelper.completeStageExit(returnId, trackingId);
 */
async function completeStageExit(returnId, trackingId) {
  try {
    const result = await slaService.completeSLATracking(trackingId);
    return result;
  } catch (err) {
    console.error('Error completing stage exit SLA:', err);
    return null;
  }
}

/**
 * Get SLA status for a return's current stage
 */
async function getReturnSLAStatus(returnId) {
  try {
    const activeSLAs = await slaService.getActiveSLATracking(returnId);
    const breaches = await slaService.getSLABreaches(returnId);

    return {
      activeSLAs: activeSLAs,
      breaches: breaches,
      isBreach: breaches.length > 0,
      activeCount: activeSLAs.length
    };
  } catch (err) {
    console.error('Error getting return SLA status:', err);
    return { activeSLAs: [], breaches: [], isBreach: false, activeCount: 0 };
  }
}

/**
 * Get SLA info to display in return view
 */
async function getSLADisplayInfo(returnId) {
  try {
    const status = await getReturnSLAStatus(returnId);
    const info = {
      currentSLA: null,
      timeRemaining: null,
      status: 'ok',
      color: 'success',
      breaches: status.breaches
    };

    if (status.activeSLAs.length > 0) {
      const activeSLA = status.activeSLAs[0];
      info.currentSLA = activeSLA;

      const now = new Date();
      const expected = new Date(activeSLA.expected_completion);
      const hoursLeft = Math.round((expected - now) / (1000 * 60 * 60));

      info.timeRemaining = hoursLeft;

      if (hoursLeft < 0) {
        info.status = 'overdue';
        info.color = 'danger';
      } else if (hoursLeft <= 2) {
        info.status = 'critical';
        info.color = 'danger';
      } else if (hoursLeft <= 12) {
        info.status = 'warning';
        info.color = 'warning';
      }
    }

    return info;
  } catch (err) {
    console.error('Error getting SLA display info:', err);
    return { currentSLA: null, timeRemaining: null, status: 'ok', color: 'success', breaches: [] };
  }
}

/**
 * Apply SLA for sorting stage
 * Called from sortingController when a return enters sorting stage
 */
async function applySortingSLA(returnId, startDate = null) {
  return await applyStageEntry(returnId, 'sorting', '[No Code]', null, startDate);
}

/**
 * Apply SLA for process stage (Rekondisi, Refurbish, Write-off)
 * itemType: 'Non Elektronik' | 'Elektronik'
 * processType: 'Rekondisi' | 'Refurbish' | 'Write off'
 */
async function applyProcessSLA(returnId, itemType = '[No Code]', processType, startDate = null) {
  const stageMap = {
    'Rekondisi': 'process_rekondisi',
    'Refurbish': 'process_refurbish',
    'Write off': 'process_write_off'
  };

  const stage = stageMap[processType] || 'process_rekondisi';
  return await applyStageEntry(returnId, stage, itemType, processType, startDate);
}

/**
 * Apply SLA for pricing stage
 */
async function applyPricingSLA(returnId, startDate = null) {
  return await applyStageEntry(returnId, 'pricing', '[No Code]', null, startDate);
}

/**
 * Apply SLA for recovery stage
 * recoveryType: 'Refurbish' | 'Write off'
 */
async function applyRecoverySLA(returnId, recoveryType = '[No Code]', startDate = null) {
  const type = recoveryType || '[No Code]';
  return await applyStageEntry(returnId, 'recovery', 'Column T [checked]', type, startDate);
}

/**
 * Complete an active SLA stage for a return.
 */
async function completeActiveStage(returnId, stage = null) {
  try {
    return await slaService.completeActiveSLATracking(returnId, stage);
  } catch (err) {
    console.error('Error completing active SLA stage:', err);
    return null;
  }
}

/**
 * Get upcoming SLA breaches for dashboard alert
 */
async function getUpcomingBreachesAlert() {
  try {
    const breaches = await slaService.getUpcomingBreaches();
    return {
      count: breaches.length,
      items: breaches,
      urgentCount: breaches.filter(b => Math.round((new Date(b.expected_completion) - new Date()) / (1000 * 60 * 60)) <= 1).length
    };
  } catch (err) {
    console.error('Error getting upcoming breaches alert:', err);
    return { count: 0, items: [], urgentCount: 0 };
  }
}

/**
 * Format time remaining for display
 */
function formatTimeRemaining(hoursLeft) {
  if (hoursLeft < 0) return `Terlambat ${Math.abs(hoursLeft)}j`;
  if (hoursLeft === 0) return 'Jatuh Tempo Sekarang';
  if (hoursLeft < 1) return `${Math.ceil(hoursLeft * 60)}m`;
  if (hoursLeft < 24) return `${Math.floor(hoursLeft)}j`;
  return `${Math.ceil(hoursLeft / 24)}h`;
}

/**
 * Trigger SLA monitoring (for scheduled tasks)
 * This should be called periodically to update SLA tracking status
 */
async function updateSLAMonitoring() {
  try {
    // Get all active SLA trackings that are past deadline
    const [activeTrackings] = await require('../config/database').query(
      `SELECT tracking_id FROM sla_tracking 
       WHERE completed_at IS NULL 
       AND is_breached = 0 
       AND expected_completion < NOW()`
    );

    // Mark them as breached
    for (const tracking of activeTrackings) {
      await slaService.completeSLATracking(tracking.tracking_id);
    }

    console.log(`Updated ${activeTrackings.length} SLA tracking records`);
  } catch (err) {
    console.error('Error in updateSLAMonitoring:', err);
  }
}

module.exports = {
  applyStageEntry,
  completeStageExit,
  getReturnSLAStatus,
  getSLADisplayInfo,
  applySortingSLA,
  applyProcessSLA,
  applyPricingSLA,
  applyRecoverySLA,
  completeActiveStage,
  getUpcomingBreachesAlert,
  formatTimeRemaining,
  updateSLAMonitoring
};
