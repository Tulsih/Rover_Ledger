const userRepository = require('../repositories/user.repository');
const documentRepository = require('../repositories/document.repository');
const refreshTokenRepository = require('../repositories/refreshToken.repository');
const onedriveService = require('./onedrive.service');
const { db } = require('../db');
const { Role, ROLES, isValidRole } = require('../enums');

/**
 * User Service
 * 
 * Handles business logic for retrieving and updating user profiles.
 */
class UserService {
  /**
   * Get user profile by UserId
   * @param {number} userId - Authenticated user's ID
   * @returns {Promise<object>} User profile object
   */
  async getProfile(userId) {
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new Error('User not found or account has been deleted');
    }

    if (!user.isActive) {
      throw new Error('Account is inactive. Please contact support.');
    }

    return userRepository.sanitizeUser(user);
  }

  /**
   * Update user profile by UserId
   * Allows updating editable fields:
   * - FirstName
   * - LastName
   * - FullName
   * - Gender
   * - Designation
   * 
   * @param {number} userId - Authenticated user's ID
   * @param {object} updateData - Key-values of fields to update
   * @returns {Promise<object>} Updated user profile object
   */
  async updateProfile(userId, updateData) {
    const existingUser = await userRepository.findById(userId);

    if (!existingUser) {
      throw new Error('User not found or account has been deleted');
    }

    if (!existingUser.isActive) {
      throw new Error('Account is inactive. Cannot update profile.');
    }

    // Whitelist only editable profile fields
    const allowedFields = ['FirstName', 'LastName', 'Gender', 'Designation', 'FullName'];
    const fieldsToUpdate = {};

    for (const key of allowedFields) {
      if (updateData[key] !== undefined) {
        fieldsToUpdate[key] = typeof updateData[key] === 'string' ? updateData[key].trim() : updateData[key];
      }
    }

    // If FirstName or LastName is changed and FullName was not explicitly passed, re-calculate FullName
    const newFirstName = fieldsToUpdate.FirstName !== undefined ? fieldsToUpdate.FirstName : existingUser.FirstName;
    const newLastName = fieldsToUpdate.LastName !== undefined ? fieldsToUpdate.LastName : existingUser.LastName;

    if (fieldsToUpdate.FullName === undefined && (fieldsToUpdate.FirstName !== undefined || fieldsToUpdate.LastName !== undefined)) {
      fieldsToUpdate.FullName = `${newFirstName || ''} ${newLastName || ''}`.trim() || null;
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      throw new Error('No valid profile fields provided for update');
    }

    const updatedUser = await userRepository.updateUser(userId, fieldsToUpdate);
    return userRepository.sanitizeUser(updatedUser);
  }

  /**
   * Permanently delete user account, all uploaded OneDrive files, and all associated database records (Option A)
   * 
   * @param {string} userId - User's unique ID
   * @returns {Promise<object>} Summary of deleted resources
   */
  async deleteUserAccount(userId) {
    const existingUser = await userRepository.findById(userId);

    if (!existingUser) {
      const err = new Error('User not found or account has already been deleted');
      err.statusCode = 404;
      throw err;
    }

    // 1. Fetch all documents uploaded by this user (including soft-deleted)
    const userDocs = await documentRepository.findAllByUploadedBy(userId);
    console.log(`🗑️ Initiating permanent cascading deletion for User ${userId} (${existingUser.Email}). Found ${userDocs.length} documents.`);

    // 2. Delete physical files from Microsoft OneDrive
    let oneDriveDeletedCount = 0;
    let oneDriveErrorCount = 0;

    for (const doc of userDocs) {
      if (doc.oneDriveItemId) {
        try {
          await onedriveService.deleteFileFromOneDrive(doc.oneDriveItemId);
          oneDriveDeletedCount++;
          console.log(`   Deleted OneDrive file ${doc.oneDriveItemId} (${doc.originalFileName || doc.documentName})`);
        } catch (oneDriveErr) {
          oneDriveErrorCount++;
          console.warn(`   Warning: Could not delete OneDrive item ${doc.oneDriveItemId}:`, oneDriveErr.message);
        }
      }
    }

    // 3. Delete database records atomically within a transaction
    let deletedDocsCount = 0;
    let deletedTokensCount = 0;

    await db.transaction(async (tx) => {
      // a. Delete all document details records
      deletedDocsCount = await documentRepository.deleteByUploadedBy(userId, tx);

      // b. Delete all refresh tokens / sessions
      deletedTokensCount = await refreshTokenRepository.deleteByUserId(userId, tx);

      // c. Delete the user record from Rover_ledgers
      await userRepository.deleteById(userId, tx);
    });

    console.log(`✅ User ${userId} and all associated data permanently deleted.`);

    return {
      userId,
      email: existingUser.Email,
      deletedDocumentsCount: deletedDocsCount,
      oneDriveFilesDeleted: oneDriveDeletedCount,
      oneDriveFilesFailed: oneDriveErrorCount,
      deletedRefreshTokensCount: deletedTokensCount,
    };
  }
}

module.exports = new UserService();
