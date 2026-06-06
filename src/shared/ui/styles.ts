/** Shared Tailwind class fragments for consistent UI primitives. */

export const transitionBase = "transition-colors duration-150 ease-out";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2";

export const radiusControl = "rounded-lg";
export const radiusSurface = "rounded-lg";
export const radiusModal = "rounded-xl";

export const controlBase = [
  "w-full min-h-10 min-w-0",
  radiusControl,
  "border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none",
  transitionBase,
  "placeholder:text-gray-400",
  "focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
].join(" ");

export const controlError = "border-red-300 focus:border-red-500 focus:ring-red-100";

export const labelBase = "block text-sm font-medium text-gray-700";

export const helperBase = "mt-1 block text-xs";

export const badgeBase =
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium";

export const linkBase =
  "font-medium text-gray-600 underline-offset-2 transition-colors duration-150 ease-out hover:text-blue-700 hover:underline";

export const cardTitleBase = "break-words text-base font-semibold text-gray-950";

export const cardSectionTitleBase = "break-words text-sm font-semibold text-gray-800";
