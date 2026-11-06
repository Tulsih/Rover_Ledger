const userService = require('../services/user.service');
const { sendSuccess, sendError } = require('../utils/response.util');

/**
 * User Controller
 * 
 * Handles HTTP requests for user profile management.
 */
class UserController {
  /**
   * API 2: Profile Fetch
   * 
   * Endpoint: GET /users/profile (or GET /profile)
   * Headers: Authorization: Bearer <JWT_TOKEN>
   * 
   * Retrieves profile details for the currently authenticated user.
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.UserId;

      const profile = await userService.getProfile(userId);

      return sendSuccess(res, 200, 'User profile fetched successfully', profile);
    } catch (error) {
      console.error('[UserController.getProfile Error]:', error.message);
      return sendError(res, 404, error.message);
    }
  }

  /**
   * API 3: Profile Update
   * 
   * Endpoint: PUT /users/profile (or PATCH /users/profile, /profile)
   * Headers: Authorization: Bearer <JWT_TOKEN>
   * 
   * Body parameters:
   * - FirstName (string)
   * - LastName (string)
   * - FullName (string, optional)
   * - Gender (string, optional - e.g. Male/Female/Other)
   * - Designation (string, optional - e.g. Senior Accountant, Software Engineer)
   */
  async updateProfile(req, res, next) {
    try {
      const userId = req.user.UserId;
      const updateData = req.body;

      if (!updateData || Object.keys(updateData).length === 0) {
        return sendError(res, 400, 'Validation Error: Request body cannot be empty.');
      }

      const updatedProfile = await userService.updateProfile(userId, updateData);

      return sendSuccess(res, 200, 'User profile updated successfully', updatedProfile);
    } catch (error) {
      console.error('[UserController.updateProfile Error]:', error.message);
      return sendError(res, 400, error.message);
    }
  }

  /**
   * API: Permanent Account Deletion (Option A)
   * 
   * Endpoint: DELETE /users/profile (or DELETE /profile)
   * Headers: Authorization: Bearer <JWT_TOKEN>
   * 
   * Permanently deletes user account, all associated OneDrive files, and database records.
   */
  async deleteProfile(req, res, next) {
    try {
      const userId = req.user.UserId;

      const result = await userService.deleteUserAccount(userId);

      return sendSuccess(
        res,
        200,
        'User account, all uploaded documents from OneDrive, and associated database records deleted successfully',
        result
      );
    } catch (error) {
      console.error('[UserController.deleteProfile Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }
}

module.exports = new UserController();
