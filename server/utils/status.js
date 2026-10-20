const { parseDateComponents, calculateDelayDays } = require('./date');

const DEFAULT_HIGH_RISK_THRESHOLD_DAYS = 3;

/**
 * Determines task status purely from business rules:
 * 1. If completed (explicit completed date or raw status indicates done) -> 'completed'
 * 2. If deadline is strictly earlier than current date -> 'overdue'
 * 3. Otherwise (deadline is today or future) -> 'in_progress'
 * 
 * CRITICAL: Never preserves an old 'overdue' flag if the deadline is now in the future!
 */
function determineTaskStatus(rawStatus, deadlineVal, completedDateVal = null, baseDate = new Date()) {
  // Check completed first
  if (completedDateVal) return 'completed';
  const norm = String(rawStatus || '').toLowerCase().trim();
  if (
    norm.includes('bajarilgan') || norm.includes('bajarildi') || norm === 'completed' ||
    norm.includes('бажарилган') || norm.includes('бажарилди')
  ) {
    return 'completed';
  }

  // Check deadline relative to today's midnight
  const deadlineDate = parseDateComponents(deadlineVal);
  if (deadlineDate) {
    const today = baseDate || new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (todayMidnight.getTime() > deadlineDate.getTime()) {
      return 'overdue';
    }
    // Future or today's deadline is in_progress, NOT overdue!
    return 'in_progress';
  }

  // If no deadline, check if raw status specifically claimed in_progress
  return 'in_progress';
}

/**
 * Recomputes task status and delay days deterministically from task data.
 */
function computeTaskStatus(task, baseDate = new Date()) {
  const isCompleted = !!task.completedDate ||
    task.status === 'completed' ||
    String(task.rawStatus || '').toLowerCase().includes('bajarilgan') ||
    String(task.rawStatus || '').toLowerCase().includes('бажарилган');

  if (isCompleted) {
    return {
      status: 'completed',
      delayDays: 0,
      isHighRisk: false
    };
  }

  const today = baseDate || new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const deadlineDate = task.deadline ? parseDateComponents(task.deadline) : null;

  if (deadlineDate) {
    if (todayMidnight.getTime() > deadlineDate.getTime()) {
      const delay = calculateDelayDays(task.deadline, null, today);
      return {
        status: 'overdue',
        delayDays: delay > 0 ? delay : 1,
        isHighRisk: false
      };
    }

    // Future or today deadline: task is in_progress
    const daysUntilDeadline = Math.floor((deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
    const isHighRisk = daysUntilDeadline >= 0 && daysUntilDeadline <= DEFAULT_HIGH_RISK_THRESHOLD_DAYS;

    return {
      status: 'in_progress',
      delayDays: 0,
      isHighRisk,
      daysRemaining: daysUntilDeadline
    };
  }

  return {
    status: 'in_progress',
    delayDays: 0,
    isHighRisk: false
  };
}

module.exports = {
  determineTaskStatus,
  computeTaskStatus,
  DEFAULT_HIGH_RISK_THRESHOLD_DAYS
};
