const { eq, and } = require('drizzle-orm');
const { db } = require('../db');
const { RoverLedgers } = require('../models');

/**
 * User Repository
 * 
 * Handles all database operations for the `Rover_ledgers` table using Drizzle ORM.
 * Keeps raw database queries isolated from business logic.
 */
class UserRepository {
  /**
   * Find an active, non-soft-deleted user by email address
   * @param {string} email - User's email
   * @returns {Promise<object|null>} User record or null
   */
  async findByEmail(email) {
    const result = await db
      .select()
      .from(RoverLedgers)
      .where(
        and(
          eq(RoverLedgers.Email, email),
          eq(RoverLedgers.SoftDelete, false)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find any user by email regardless of SoftDelete status
   * Useful for handling account re-activation
   * @param {string} email - User's email
   * @returns {Promise<object|null>} User record or null
   */
  async findAnyByEmail(email) {
    const result = await db
      .select()
      .from(RoverLedgers)
      .where(eq(RoverLedgers.Email, email))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find an active, non-soft-deleted user by primary key (UserId)
   * @param {number} userId - User's unique ID
   * @returns {Promise<object|null>} User record or null
   */
  async findById(userId) {
    const result = await db
      .select()
      .from(RoverLedgers)
      .where(
        and(
          eq(RoverLedgers.UserId, userId),
          eq(RoverLedgers.SoftDelete, false)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Create and insert a new user into Rover_ledgers table
   * @param {object} userData - User record fields
   * @returns {Promise<object>} Created user record
   */
  async createUser(userData) {
    const result = await db
      .insert(RoverLedgers)
      .values({
        FirstName: userData.FirstName || null,
        LastName: userData.LastName || null,
        Email: userData.Email,
        Gender: userData.Gender || null,
        Role: userData.Role || 'User',
        Designation: userData.Designation || null,
        FullName: userData.FullName || null,
        isActive: userData.isActive !== undefined ? userData.isActive : true,
        SoftDelete: false,
        CreatedAt: new Date(),
        UpdatedAt: new Date(),
      })
      .returning();

    return result[0];
  }

  /**
   * Update an existing user in Rover_ledgers table by UserId
   * @param {number} userId - User ID to update
   * @param {object} updateData - Fields to update
   * @returns {Promise<object|null>} Updated user record or null if not found
   */
  async updateUser(userId, updateData) {
    const dataToUpdate = {
      ...updateData,
      UpdatedAt: new Date(),
    };

    const result = await db
      .update(RoverLedgers)
      .set(dataToUpdate)
      .where(
        and(
          eq(RoverLedgers.UserId, userId),
          eq(RoverLedgers.SoftDelete, false)
        )
      )
      .returning();

    return result[0] || null;
  }
}

module.exports = new UserRepository();
