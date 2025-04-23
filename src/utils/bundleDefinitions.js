/**
 * Bundle definitions for automatic bundling of exams based on tags
 * Each bundle has:
 * - id: Unique identifier for the bundle (used as bundle ID)
 * - tag: The tag that should be present on exams to be included in this bundle
 * - title: Display title for the bundle
 * - description: Short description of the bundle
 * - discountPercentage: Percentage discount applied to bundle total price
 * - accessPeriod: Number of days the bundle is accessible after purchase
 * - minExams: Minimum number of exams required to create this bundle (default: 2)
 * - priority: Display priority (higher numbers appear first, default: 1)
 * - featured: Whether this bundle should be featured (default: true)
 */
export const BUNDLE_DEFINITIONS = [
  {
    id: "full-length-csat-bundle",
    tag: "full-length-csat",
    title: "Full Length + CSAT Bundle",
    description:
      "Complete preparation with full-length tests and CSAT practice papers",
    discountPercentage: 30,
    accessPeriod: 15,
    minExams: 2,
    priority: 10,
    featured: true,
  },
  {
    id: "prelims-bundle",
    tag: "apsc-prelims",
    title: "APSC Prelims Master Bundle",
    description: "Comprehensive preparation package for APSC Prelims",
    discountPercentage: 15,
    accessPeriod: 30,
    minExams: 2,
    priority: 8,
    featured: true,
  },
  {
    id: "mains-bundle",
    tag: "apsc-mains",
    title: "APSC Mains Practice Bundle",
    description: "Extensive practice for APSC Mains examination",
    discountPercentage: 15,
    accessPeriod: 30,
    priority: 7,
    featured: true,
  },
  {
    id: "interview-bundle",
    tag: "interview",
    title: "Interview Preparation Bundle",
    description: "Mock interviews and preparation materials for UPSC Interview",
    discountPercentage: 10,
    accessPeriod: 30,
    minExams: 2,
    priority: 6,
    featured: true,
  },
  {
    id: "state-psc-bundle",
    tag: "state-psc",
    title: "State PSC Preparation Bundle",
    description: "Comprehensive preparation for State PSC examinations",
    discountPercentage: 15,
    accessPeriod: 30,
    minExams: 3,
    priority: 5,
    featured: true,
  },
];

/**
 * Helper function to create a bundle object from a list of exams and a bundle definition
 * @param {Array} exams - List of exams that belong to this bundle
 * @param {Object} bundleDef - Bundle definition from BUNDLE_DEFINITIONS
 * @param {Object} userAccessMap - Map of examIds to access status
 * @returns {Object} - Bundle object ready for frontend consumption
 */
export const createBundleFromExams = (exams, bundleDef, userAccessMap = {}) => {
  // Calculate total original price
  let bundleTotalPrice = 100;

  // Apply bundle discount
  const bundlePrice = Math.round(
    bundleTotalPrice * (1 - bundleDef.discountPercentage / 100)
  );

  // Check if user has access to all exams in the bundle
  const hasCompleteAccess = exams.every(
    (exam) => userAccessMap[exam._id.toString()] === true
  );

  // Create the bundle object
  return {
    _id: bundleDef.id,
    title: bundleDef.title,
    description: bundleDef.description,
    category: "BUNDLE",
    duration: exams.reduce((sum, e) => sum + e.duration, 0),
    totalMarks: exams.reduce((sum, e) => sum + e.totalMarks, 0),
    difficultyLevel: "MEDIUM",
    passMarkPercentage: 35,
    isFeatured: bundleDef.featured !== false,
    isPremium: true,
    price: bundleTotalPrice,
    discountPrice: bundlePrice,
    accessPeriod: bundleDef.accessPeriod || 30,
    hasAccess: hasCompleteAccess,
    isBundle: true,
    bundleTag: bundleDef.tag,
    priority: bundleDef.priority || 1,
    bundledExams: exams.map((exam) => ({
      _id: exam._id,
      title: exam.title,
      hasAccess: userAccessMap[exam._id.toString()] || false,
    })),
  };
};

export default {
  BUNDLE_DEFINITIONS,
  createBundleFromExams,
};
