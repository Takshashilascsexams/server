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
 * - isPremium: Whether the bundle requires payment
 * - price: Base price of the bundle (0 for free bundles)
 */
export const BUNDLE_DEFINITIONS = [
  {
    id: "apsc-2025-prelims-test-series",
    tag: "apsc-2025-prelims-full-length-test-series-bundle",
    title: "APSC CCE 2025 Prelims Full Length Test Series Bundle",
    description:
      "Complete preparation with full-length tests and CSAT practice papers for APSC CCE 2025 Prelims",
    accessPeriod: 10,
    minExams: 1,
    priority: 10,
    isPremium: false,
    price: 0,
    discountPercentage: 0,
    featured: true,
  },
  {
    id: "apsc-2025-mains-test-series",
    tag: "apsc-2025-mains-full-length-test-series-bundle",
    title: "APSC CCE 2025 Mains Full Length Test Series Bundle",
    description:
      "Comprehensive mains preparation with full-length test series for APSC CCE 2025",
    accessPeriod: 10,
    minExams: 1,
    priority: 9,
    isPremium: true,
    price: 130,
    discountPercentage: 30,
    featured: true,
  },
];

/**
 * Helper function to create a bundle object from a list of exams and a bundle definition
 * Updated to work with explicit pricing in bundle definitions
 */
export const createBundleFromExams = (exams, bundleDef, userAccessMap = {}) => {
  // Use explicit pricing from bundle definition
  const bundleTotalPrice = bundleDef.price || 0;

  // Apply bundle discount if specified and bundle is premium
  const bundlePrice = bundleDef.isPremium
    ? Math.round(bundleTotalPrice * (1 - bundleDef.discountPercentage / 100))
    : 0;

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
    isPremium: bundleDef.isPremium || false,
    price: bundleTotalPrice,
    discountPrice: bundlePrice,
    accessPeriod: bundleDef.accessPeriod || 30,
    hasAccess: bundleDef.isPremium ? hasCompleteAccess : true,
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
