/**
 * Format date for dashboard display with relative time
 * @param {Date|string} date - The date to format
 * @returns {string} - Formatted relative time string
 */
export const formatDashboardDate = (date) => {
  try {
    const now = new Date();
    const targetDate = new Date(date);
    const diffInMs = now - targetDate;
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    // Handle future dates
    if (diffInMs < 0) {
      return "in the future";
    }

    // Less than 1 minute
    if (diffInMinutes < 1) {
      return "just now";
    }

    // Less than 1 hour
    if (diffInMinutes < 60) {
      return `${diffInMinutes} minute${diffInMinutes === 1 ? "" : "s"} ago`;
    }

    // Less than 24 hours
    if (diffInHours < 24) {
      return `${diffInHours} hour${diffInHours === 1 ? "" : "s"} ago`;
    }

    // Less than 7 days
    if (diffInDays < 7) {
      return `${diffInDays} day${diffInDays === 1 ? "" : "s"} ago`;
    }

    // Less than 30 days
    if (diffInDays < 30) {
      const weeks = Math.floor(diffInDays / 7);
      return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
    }

    // Less than 365 days
    if (diffInDays < 365) {
      const months = Math.floor(diffInDays / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }

    // More than 365 days
    const years = Math.floor(diffInDays / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  } catch (error) {
    console.error("Error formatting dashboard date:", error);
    return "unknown time";
  }
};

/**
 * Format absolute date for dashboard display
 * @param {Date|string} date - The date to format
 * @param {string} format - Format type: 'short', 'medium', 'long'
 * @returns {string} - Formatted date string
 */
export const formatAbsoluteDate = (date, format = "medium") => {
  try {
    const targetDate = new Date(date);

    const options = {
      short: {
        year: "numeric",
        month: "short",
        day: "numeric",
      },
      medium: {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
      long: {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
    };

    return targetDate.toLocaleDateString(
      "en-US",
      options[format] || options.medium
    );
  } catch (error) {
    console.error("Error formatting absolute date:", error);
    return "Invalid date";
  }
};

/**
 * Format date range for dashboard display
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @returns {string} - Formatted date range string
 */
export const formatDateRange = (startDate, endDate) => {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const startStr = start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    const endStr = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    return `${startStr} - ${endStr}`;
  } catch (error) {
    console.error("Error formatting date range:", error);
    return "Invalid date range";
  }
};
