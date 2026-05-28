// Consistent category → color mapping across all tables and charts.
// Each entry: [bg, text, border] tailwind classes for light + dark.

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  "Dining":              { bg: "bg-orange-500/15", text: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
  "Groceries":           { bg: "bg-green-500/15",  text: "text-green-700 dark:text-green-400",   dot: "bg-green-500" },
  "Shopping":            { bg: "bg-pink-500/15",   text: "text-pink-700 dark:text-pink-400",     dot: "bg-pink-500" },
  "Transportation":      { bg: "bg-blue-500/15",   text: "text-blue-700 dark:text-blue-400",     dot: "bg-blue-500" },
  "Rent / Housing":      { bg: "bg-violet-500/15", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-500" },
  "Utilities":           { bg: "bg-cyan-500/15",   text: "text-cyan-700 dark:text-cyan-400",     dot: "bg-cyan-500" },
  "Subscriptions":       { bg: "bg-indigo-500/15", text: "text-indigo-700 dark:text-indigo-400", dot: "bg-indigo-500" },
  "Entertainment":       { bg: "bg-fuchsia-500/15",text: "text-fuchsia-700 dark:text-fuchsia-400", dot: "bg-fuchsia-500" },
  "Travel":              { bg: "bg-sky-500/15",    text: "text-sky-700 dark:text-sky-400",       dot: "bg-sky-500" },
  "Income":              { bg: "bg-emerald-500/15",text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  "Insurance":           { bg: "bg-amber-500/15",  text: "text-amber-700 dark:text-amber-400",   dot: "bg-amber-500" },
  "Fees":                { bg: "bg-red-500/15",    text: "text-red-700 dark:text-red-400",       dot: "bg-red-500" },
  "Interest":            { bg: "bg-teal-500/15",   text: "text-teal-700 dark:text-teal-400",     dot: "bg-teal-500" },
  "Transfers":           { bg: "bg-slate-500/15",  text: "text-slate-600 dark:text-slate-400",   dot: "bg-slate-500" },
  "Credit Card Payment": { bg: "bg-slate-500/15",  text: "text-slate-600 dark:text-slate-400",   dot: "bg-slate-500" },
  "Medical":             { bg: "bg-rose-500/15",   text: "text-rose-700 dark:text-rose-400",     dot: "bg-rose-500" },
  "Education":           { bg: "bg-purple-500/15", text: "text-purple-700 dark:text-purple-400", dot: "bg-purple-500" },
  "Personal Care":       { bg: "bg-lime-500/15",   text: "text-lime-700 dark:text-lime-400",     dot: "bg-lime-500" },
  "Coffee":              { bg: "bg-yellow-600/15", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-600" },
  "ATM / Cash Withdrawal": { bg: "bg-stone-500/15", text: "text-stone-600 dark:text-stone-400", dot: "bg-stone-500" },
  "Check":               { bg: "bg-zinc-500/15",   text: "text-zinc-600 dark:text-zinc-400",     dot: "bg-zinc-500" },
};

const FALLBACK = { bg: "bg-gray-500/15", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-500" };

export function getCategoryColor(category: string | null | undefined) {
  if (!category) return FALLBACK;
  return CATEGORY_COLORS[category] ?? FALLBACK;
}
