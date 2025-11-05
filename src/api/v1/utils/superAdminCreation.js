const bcrypt = require("bcrypt");
const User = require("../models/user.model");

const seedDatabaseAndCreateSuperAdmin = async () => {
  try {
    console.log("Checking for existing users...");

    const users = await User.find({ role: "SUPER_ADMIN" });

    console.log("Users found:", users.length);
    if (users.length === 0) {
      console.log("No users found. Creating default Admin...");

      const hashedPassword = await bcrypt.hash("Admin@123", 12);

      await User.create({
        email: "luke@inov8ive.com.au",
        password: hashedPassword,
        role: "SUPER_ADMIN",
        userName: "Transporter super_admin",
        fullName: "Transporter super_admin",
        status: "ACTIVE",
        approvalStatus: "APPROVED",
      });

      console.log("Default Admin created successfully.");
    } else {
      console.log(
        "Users already exist in the database. Skipping Admin creation."
      );
    }
  } catch (error) {
    console.error("Error during admin creation:", error);
    throw error;
  }
};

module.exports = seedDatabaseAndCreateSuperAdmin;
