const Role = require("../../v3/Models/Role");
const AppError = require("../../v1/utils/AppError"); 

class RoleService {
  async findAll() {
    const roles = await Role.find();
    if (!roles || roles.length === 0) {
      throw new AppError("No roles found", 200);
    }
    return roles;
  }

  async findOne(id) {
    const role = await Role.findById(id);
    if (!role) {
      throw new AppError("Role not found", 200);
    }
    return role;
  }

  async create(data) {
    const role = new Role(data);
    return await role.save();
  }

  async update(id, data) {
    const updatedRole = await Role.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true } 
    );
    if (!updatedRole) {
      throw new AppError("Role not found", 200);
    }
    return updatedRole;
  }

  async delete(id) {
    const deletedRole = await Role.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true, runValidators: true }
    );
    if (!deletedRole) {
      throw new AppError("Role not found", 200);
    }
    return deletedRole;
  }
}

module.exports = RoleService;
