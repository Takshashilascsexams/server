import User from "../../../models/user.models.js";
import { catchAsync } from "../../../utils/errorHandler.js";
import { userService } from "../../../services/redisService.js";

const getAllUsers = catchAsync(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Sorting - ensure it's a valid field to prevent injection
  const validSortFields = [
    "createdAt",
    "fullName",
    "email",
    "phoneNumber",
    "category",
    "role",
  ];
  const sortBy = validSortFields.includes(req.query.sortBy)
    ? req.query.sortBy
    : "createdAt";
  const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  // Filtering
  const filterOptions = {};

  // Handle role filter
  if (req.query.role) filterOptions.role = req.query.role;

  // Handle category filter
  if (req.query.category) filterOptions.category = req.query.category;

  // Handle district filter
  if (req.query.district) filterOptions.district = req.query.district;

  // Handle search query
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, "i");
    filterOptions.$or = [{ fullName: searchRegex }, { email: searchRegex }];
  }

  // Create cache key based on query parameters
  const cacheKey = `admin:dashboard:users:${JSON.stringify({
    page,
    limit,
    sort: { by: sortBy, order: sortOrder },
    filterOptions,
  })}`;

  // Try to get from cache first
  try {
    const cachedData = await userService.getDashboardUsers(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getAllUsers:", error);
    // Continue to database query on cache error
  }

  // Fetch users with filters
  const users = await User.find(filterOptions)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .select(
      "_id clerkId email phoneNumber fullName category gender district role createdAt"
    );

  // Get total count for pagination
  const total = await User.countDocuments(filterOptions);

  if (total === 0) {
    // Return empty results if no users found
    return res.status(200).json({
      status: "success",
      data: {
        users: [],
        pagination: {
          total: 0,
          page,
          pages: 0,
          limit,
        },
      },
    });
  }

  // Prepare response
  const responseData = {
    users: users.map((user) => user.toJSON()),
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };

  // Cache the result for 5 minutes
  try {
    await userService.setDashboardUsers(cacheKey, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to cache user dashboard:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getAllUsers;
