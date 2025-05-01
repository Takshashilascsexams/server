// src/services/examAccessService.js
import Payment from "../models/payment.models.js";
import { paymentService } from "./redisService.js";
import { BUNDLE_DEFINITIONS } from "../utils/bundleDefinitions.js";

/**
 * Service to handle exam access verification
 * - Uses Redis caching for high-performance access checks
 * - Handles both direct exam access and bundle-based access
 * - Optimized for concurrent requests
 */

/**
 * Check if user has access to an exam
 * @param {String} userId - User's ID
 * @param {String} examId - Exam ID to check access for
 * @returns {Promise<Boolean>} - Whether user has access to the exam
 */
export const checkExamAccess = async (userId, examId) => {
  if (!userId || !examId) {
    throw new Error("User ID and Exam ID are required");
  }

  try {
    // Try to get access info from cache first
    const accessMap = await paymentService.getUserExamAccess(userId);

    // If we have cached access info, use it
    if (accessMap && accessMap[examId] !== undefined) {
      return accessMap[examId];
    }

    // Cache miss or no cached access for this exam, check database

    // Check if the examId is a bundle ID
    const isBundle = BUNDLE_DEFINITIONS.some((def) => def.id === examId);

    if (isBundle) {
      // For bundles, we check if the user has access to the bundle itself
      const validBundlePayment = await Payment.findOne({
        userId,
        examId,
        status: "completed",
        validUntil: { $gt: new Date() },
        "paymentDetails.isBundle": true,
      }).lean();

      const hasAccess = !!validBundlePayment;

      // Update cache with this result
      await updateAccessCache(userId, examId, hasAccess);

      return hasAccess;
    }

    // Check direct access first (user purchased this exam specifically)
    const directPayment = await Payment.findOne({
      userId,
      examId,
      status: "completed",
      validUntil: { $gt: new Date() },
    }).lean();

    if (directPayment) {
      // Update cache with this result
      await updateAccessCache(userId, examId, true);
      return true;
    }

    // If no direct access, check bundle access (exam is part of a bundle user purchased)
    const bundlePayment = await Payment.findOne({
      userId,
      status: "completed",
      validUntil: { $gt: new Date() },
      "paymentDetails.partOfBundle": true,
      "paymentDetails.bundledExams": examId,
    }).lean();

    const hasAccess = !!bundlePayment;

    // Update cache with this result
    await updateAccessCache(userId, examId, hasAccess);

    return hasAccess;
  } catch (error) {
    console.error(
      `Error checking exam access for user ${userId}, exam ${examId}:`,
      error
    );
    // On error, default to requiring database check - don't grant free access
    return false;
  }
};

/**
 * Helper to update the access cache with new information
 * @param {String} userId - User's ID
 * @param {String} examId - Exam ID
 * @param {Boolean} hasAccess - Access status
 */
async function updateAccessCache(userId, examId, hasAccess) {
  try {
    // Get current access map
    let accessMap = (await paymentService.getUserExamAccess(userId)) || {};

    // Update with new access info
    accessMap[examId] = hasAccess;

    // Save back to cache with TTL
    await paymentService.setUserExamAccess(userId, accessMap, 15 * 60); // 15 minutes
  } catch (error) {
    // Just log errors but don't throw - caching issues shouldn't block access
    console.error(
      `Failed to update access cache for user ${userId}, exam ${examId}:`,
      error
    );
  }
}

/**
 * Invalidate access cache for a user (after payment changes)
 * @param {String} userId - User's ID
 */
export const invalidateAccessCache = async (userId) => {
  try {
    await paymentService.clearUserExamAccess(userId);
  } catch (error) {
    console.error(
      `Failed to invalidate access cache for user ${userId}:`,
      error
    );
  }
};

/**
 * Check if multiple users have access to multiple exams (batch processing)
 * @param {Array} accessRequests - Array of {userId, examId} objects
 * @returns {Promise<Object>} - Map of userId:examId to access status
 */
export const batchCheckExamAccess = async (accessRequests) => {
  const results = {};
  const promises = [];

  for (const { userId, examId } of accessRequests) {
    const key = `${userId}:${examId}`;
    promises.push(
      checkExamAccess(userId, examId)
        .then((hasAccess) => {
          results[key] = hasAccess;
        })
        .catch((error) => {
          console.error(`Error checking access for ${key}:`, error);
          results[key] = false;
        })
    );
  }

  await Promise.all(promises);
  return results;
};

export default {
  checkExamAccess,
  invalidateAccessCache,
  batchCheckExamAccess,
};
