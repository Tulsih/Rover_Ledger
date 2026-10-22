const userRepository = require('../repositories/user.repository');

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

    // Return sanitized profile details
    return {
      UserId: user.UserId,
      FirstName: user.FirstName,
      LastName: user.LastName,
      FullName: user.FullName,
      Email: user.Email,
      Gender: user.Gender,
      Role: user.Role,
      Designation: user.Designation,
      isActive: user.isActive,
      CreatedAt: user.CreatedAt,
      UpdatedAt: user.UpdatedAt,
    };
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

    return {
      UserId: updatedUser.UserId,
      FirstName: updatedUser.FirstName,
      LastName: updatedUser.LastName,
      FullName: updatedUser.FullName,
      Email: updatedUser.Email,
      Gender: updatedUser.Gender,
      Role: updatedUser.Role,
      Designation: updatedUser.Designation,
      isActive: updatedUser.isActive,
      CreatedAt: updatedUser.CreatedAt,
      UpdatedAt: updatedUser.UpdatedAt,
    };
  }
}

module.exports = new UserService();
